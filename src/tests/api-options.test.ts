import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer } from '../server.js';
import { registerQuotationTools } from '../tools/quotations.js';
import { registerCreditNoteTools } from '../tools/credit-notes.js';
import { registerOrderConfirmationTools } from '../tools/order-confirmations.js';
import { registerDeliveryNoteTools } from '../tools/delivery-notes.js';
import { registerVoucherlistTools } from '../tools/voucherlist.js';
import { registerFileTools } from '../tools/files.js';

const mocks = vi.hoisted(() => ({
  lexwareRequest: vi.fn(),
  lexwareDownload: vi.fn(),
  lexwareUpload: vi.fn(),
}));

vi.mock('../services/lexware.js', () => mocks);

const FILE_ID = '745f3319-f473-4d55-9943-fecd942fd76d';
const createTools = [
  ['lexware_create_quotation', '/quotations'],
  ['lexware_create_credit_note', '/credit-notes'],
  ['lexware_create_order_confirmation', '/order-confirmations'],
  ['lexware_create_delivery_note', '/delivery-notes'],
] as const;

// Exercise SDK input validation and transport serialization, rather than calling
// captured handlers directly: the new fields must survive the MCP boundary.
async function withClient(run: (client: Client) => Promise<void>): Promise<void> {
  const server = createServer('api-options-test');
  for (const register of [
    registerQuotationTools, registerCreditNoteTools, registerOrderConfirmationTools,
    registerDeliveryNoteTools, registerVoucherlistTools, registerFileTools,
  ]) {
    register(server);
  }
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'api-options-test', version: '0.0.0' });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  try {
    await run(client);
  } finally {
    await client.close();
    await server.close();
  }
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.lexwareRequest.mockResolvedValue({ id: FILE_ID });
});

describe('creation-time finalization through MCP', () => {
  describe.each(createTools)('%s', (name, path) => {
    it.each([
      { label: 'omitted', args: {}, query: undefined },
      { label: 'false', args: { finalize: false }, query: undefined },
      { label: 'true', args: { finalize: true }, query: { finalize: true } },
    ])('forwards finalize only when true ($label)', async ({ args, query }) => {
      await withClient(async (client) => {
        const body = { voucherDate: '2026-10-02', lineItems: [{ name: 'Service' }] };
        const result = await client.callTool({ name, arguments: { body, ...args } });
        expect(result.isError).not.toBe(true);
        expect(mocks.lexwareRequest).toHaveBeenCalledExactlyOnceWith('POST', path, body, query);
      });
    });

    it('rejects a string boolean before any creation request', async () => {
      await withClient(async (client) => {
        const result = await client.callTool({ name, arguments: { body: {}, finalize: 'false' } });
        expect(result.isError).toBe(true);
        expect(mocks.lexwareRequest).not.toHaveBeenCalled();
      });
    });
  });
});

describe('voucherlist sync options through MCP', () => {
  const filters = {
    updatedDateFrom: '2026-10-01',
    updatedDateTo: '2026-10-02',
    sort: 'updatedDate,DESC',
    voucherStatus: 'transferred,sepadebit',
  };

  it('forwards modified-date bounds and sorting with the existing defaults', async () => {
    await withClient(async (client) => {
      await client.callTool({ name: 'lexware_list_voucherlist', arguments: filters });
      expect(mocks.lexwareRequest).toHaveBeenCalledExactlyOnceWith(
        'GET', '/voucherlist', undefined, { voucherType: 'any', ...filters },
      );
    });
  });

  it('keeps the new optional filters absent from a parameterless query', async () => {
    await withClient(async (client) => {
      await client.callTool({ name: 'lexware_list_voucherlist', arguments: {} });
      expect(mocks.lexwareRequest).toHaveBeenCalledExactlyOnceWith(
        'GET', '/voucherlist', undefined, { voucherType: 'any', voucherStatus: 'any' },
      );
    });
  });

  it('retains the same modified-date filters and sort on every aggregated page', async () => {
    mocks.lexwareRequest
      .mockResolvedValueOnce({ content: [{ id: 'first' }], totalPages: 2 })
      .mockResolvedValueOnce({ content: [{ id: 'second' }], totalPages: 2 });
    await withClient(async (client) => {
      const result = await client.callTool({
        name: 'lexware_list_voucherlist', arguments: { ...filters, fetchAllPages: true },
      });
      expect(result.structuredContent).toMatchObject({
        content: [{ id: 'first' }, { id: 'second' }], fetchedPages: 2, truncated: false,
      });
      expect(mocks.lexwareRequest).toHaveBeenCalledTimes(2);
      for (const page of [0, 1]) {
        expect(mocks.lexwareRequest).toHaveBeenNthCalledWith(
          page + 1, 'GET', '/voucherlist', undefined,
          { voucherType: 'any', ...filters, page, size: 250 },
        );
      }
    });
  });
});

describe('generic file representations through MCP', () => {
  it.each([{}, { format: 'pdf' }])('preserves the PDF default and fallback for %j', async (args) => {
    mocks.lexwareDownload.mockResolvedValue({ data: Buffer.from('PDF'), contentType: 'application/pdf' });
    await withClient(async (client) => {
      const result = await client.callTool({ name: 'lexware_download_file', arguments: { id: FILE_ID, ...args } });
      expect(mocks.lexwareDownload).toHaveBeenCalledExactlyOnceWith(`/files/${FILE_ID}`);
      expect(result.structuredContent).toEqual({
        fileName: 'file', contentType: 'application/pdf', contentBase64: Buffer.from('PDF').toString('base64'),
      });
    });
  });

  it.each([undefined, '', 'received-invoice.xml'])('requests XML and preserves the returned bytes and filename (%s)', async (fileName) => {
    const data = Buffer.from('<Invoice>€</Invoice>');
    mocks.lexwareDownload.mockResolvedValue({ data, contentType: 'application/xml; charset=utf-8', fileName });
    await withClient(async (client) => {
      const result = await client.callTool({
        name: 'lexware_download_file', arguments: { id: FILE_ID, format: 'xml' },
      });
      expect(mocks.lexwareDownload).toHaveBeenCalledExactlyOnceWith(`/files/${FILE_ID}`, 'application/xml');
      expect(result.structuredContent).toEqual({
        fileName: fileName || 'file.xml', contentType: 'application/xml; charset=utf-8', contentBase64: data.toString('base64'),
      });
    });
  });

  it('reports an unavailable XML original as an error', async () => {
    mocks.lexwareDownload.mockRejectedValue(new Error('Lexware API Error (404): XML file not available'));
    await withClient(async (client) => {
      const result = await client.callTool({
        name: 'lexware_download_file', arguments: { id: FILE_ID, format: 'xml' },
      });
      expect(result.isError).toBe(true);
      expect(result.content).toEqual([{ type: 'text', text: expect.stringContaining('XML file not available') }]);
      expect(mocks.lexwareDownload).toHaveBeenCalledExactlyOnceWith(`/files/${FILE_ID}`, 'application/xml');
    });
  });

  it('rejects unsupported formats before a download', async () => {
    await withClient(async (client) => {
      const result = await client.callTool({ name: 'lexware_download_file', arguments: { id: FILE_ID, format: 'html' } });
      expect(result.isError).toBe(true);
      expect(mocks.lexwareDownload).not.toHaveBeenCalled();
    });
  });
});

it('publishes all new options with descriptions and preserves required fields in tools/list', async () => {
  await withClient(async (client) => {
    const { tools } = await client.listTools();
    for (const [name] of createTools) {
      const schema = tools.find((tool) => tool.name === name)!.inputSchema;
      expect(schema.required).toEqual(['body']);
      expect(schema.properties?.finalize).toMatchObject({ type: 'boolean', description: expect.stringContaining('?finalize=true') });
    }
    const list = tools.find((tool) => tool.name === 'lexware_list_voucherlist')!.inputSchema;
    expect(list.required ?? []).toEqual([]);
    for (const field of ['updatedDateFrom', 'updatedDateTo']) {
      expect(list.properties?.[field]).toMatchObject({ type: 'string', description: expect.stringContaining('yyyy-MM-dd') });
    }
    expect(list.properties?.sort).toMatchObject({ type: 'string', description: expect.stringContaining('updatedDate,DESC') });
    expect(list.properties?.voucherStatus).toMatchObject({ description: expect.stringContaining('transferred, sepadebit') });
    const file = tools.find((tool) => tool.name === 'lexware_download_file')!.inputSchema;
    expect(file.required).toEqual(['id']);
    expect(file.properties?.format).toMatchObject({
      enum: ['pdf', 'xml'], default: 'pdf', description: expect.stringContaining('XML'),
    });
  });
});
