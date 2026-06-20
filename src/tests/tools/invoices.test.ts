import { describe, it, expect, vi, beforeEach } from 'vitest';

// GOTCHA: vi.mock is hoisted above top-level const declarations.
// Use vi.hoisted() to share mock fns between test bodies and the factory.
const { mockLexwareRequest, mockLexwareDownload } = vi.hoisted(() => ({
  mockLexwareRequest: vi.fn(),
  mockLexwareDownload: vi.fn(),
}));

vi.mock('../../services/lexware.js', () => ({
  lexwareRequest: mockLexwareRequest,
  lexwareDownload: mockLexwareDownload,
}));

type ToolHandler = (params: Record<string, unknown>) => Promise<unknown>;

interface CapturedTool {
  name: string;
  schemaShape: Record<string, unknown>;
  handler: ToolHandler;
}

async function registerAndCapture(): Promise<Map<string, CapturedTool>> {
  const captured = new Map<string, CapturedTool>();
  // McpServer.registerTool has overloaded signatures; the runtime contract is
  // (name, definition, handler). We only inspect what registerInvoiceTools passes in.
  const fakeServer = {
    registerTool(name: string, def: { inputSchema?: { shape?: Record<string, unknown> } }, handler: ToolHandler) {
      captured.set(name, {
        name,
        schemaShape: def.inputSchema?.shape ?? {},
        handler,
      });
    },
  };
  const { registerInvoiceTools } = await import('../../tools/invoices.js');
  registerInvoiceTools(fakeServer as unknown as Parameters<typeof registerInvoiceTools>[0]);
  return captured;
}

function getTool(tools: Map<string, CapturedTool>, name: string): CapturedTool {
  const tool = tools.get(name);
  if (!tool) throw new Error(`${name} not registered`);
  return tool;
}

describe('invoices tool registry', () => {
  beforeEach(() => {
    mockLexwareRequest.mockReset();
    mockLexwareDownload.mockReset();
  });

  it('registers exactly the expected 5 invoice tools (no finalize_invoice)', async () => {
    const tools = await registerAndCapture();
    expect([...tools.keys()].sort()).toEqual([
      'lexware_create_invoice',
      'lexware_deeplink_invoice',
      'lexware_download_invoice_file',
      'lexware_get_invoice',
      'lexware_pursue_invoice',
    ]);
    // Regression guard against re-introducing the broken undocumented endpoint
    // (POST /invoices/{id}/actions/finalize returns 404 on the live API).
    expect(tools.has('lexware_finalize_invoice')).toBe(false);
  });

  describe('lexware_create_invoice', () => {
    it('POSTs to /invoices without finalize when the flag is omitted', async () => {
      mockLexwareRequest.mockResolvedValue({ id: 'inv-1', version: 1 });
      const tools = await registerAndCapture();
      const create = getTool(tools, 'lexware_create_invoice');

      const result = await create.handler({ body: { foo: 'bar' } });

      expect(mockLexwareRequest).toHaveBeenCalledExactlyOnceWith(
        'POST',
        '/invoices',
        { foo: 'bar' },
        undefined,
      );
      // Successful object response sets structuredContent
      expect(result).toMatchObject({
        structuredContent: { id: 'inv-1', version: 1 },
      });
    });

    it('passes finalize=true through to the documented ?finalize query parameter', async () => {
      mockLexwareRequest.mockResolvedValue({ id: 'inv-2', version: 1 });
      const tools = await registerAndCapture();
      const create = getTool(tools, 'lexware_create_invoice');

      await create.handler({ body: { foo: 'bar' }, finalize: true });

      expect(mockLexwareRequest).toHaveBeenCalledExactlyOnceWith(
        'POST',
        '/invoices',
        { foo: 'bar' },
        { finalize: true },
      );
    });

    it('treats finalize=false as draft (no ?finalize query param)', async () => {
      mockLexwareRequest.mockResolvedValue({ id: 'inv-3', version: 1 });
      const tools = await registerAndCapture();
      const create = getTool(tools, 'lexware_create_invoice');

      await create.handler({ body: { foo: 'bar' }, finalize: false });

      // Some HTTP parsers treat any non-empty query value (including the
      // literal "false") as truthy. The docs only define `[&finalize=true]`,
      // so the safe contract is: only emit the query param when the caller
      // explicitly asks to finalize. finalize=false must NOT reach the wire.
      expect(mockLexwareRequest).toHaveBeenCalledExactlyOnceWith(
        'POST',
        '/invoices',
        { foo: 'bar' },
        undefined,
      );
    });

    it('declares a finalize boolean param in its input schema', async () => {
      const tools = await registerAndCapture();
      const create = getTool(tools, 'lexware_create_invoice');
      expect(create.schemaShape).toHaveProperty('finalize');
      expect(create.schemaShape).toHaveProperty('body');
    });
  });

  describe('lexware_get_invoice', () => {
    it('GETs /invoices/{id}', async () => {
      mockLexwareRequest.mockResolvedValue({ id: 'abc' });
      const tools = await registerAndCapture();
      const get = getTool(tools, 'lexware_get_invoice');

      await get.handler({ id: '745f3319-f473-4d55-9943-fecd942fd76d' });

      expect(mockLexwareRequest).toHaveBeenCalledExactlyOnceWith(
        'GET',
        '/invoices/745f3319-f473-4d55-9943-fecd942fd76d',
      );
    });
  });

  describe('lexware_download_invoice_file', () => {
    it('declares an optional format param in its input schema', async () => {
      const tools = await registerAndCapture();
      const dl = getTool(tools, 'lexware_download_invoice_file');
      expect(dl.schemaShape).toHaveProperty('format');
      expect(dl.schemaShape).toHaveProperty('id');
    });

    it('requests PDF (no format) and keeps the invoice.pdf fallback name', async () => {
      // Regression catcher for the original bug: the default/omitted path must
      // still ask for application/pdf and keep the historical fallback name.
      mockLexwareDownload.mockResolvedValue({
        fileName: undefined,
        contentType: 'application/pdf',
        data: Buffer.from('PDF'),
      });
      const tools = await registerAndCapture();
      const dl = getTool(tools, 'lexware_download_invoice_file');
      const result = (await dl.handler({ id: 'inv-d' })) as {
        structuredContent: { fileName: string; contentType: string };
      };
      expect(mockLexwareDownload).toHaveBeenCalledExactlyOnceWith(
        '/invoices/inv-d/file',
        'application/pdf',
      );
      expect(result.structuredContent.fileName).toBe('invoice.pdf');
    });

    it('threads format="xml" to the application/xml Accept and yields invoice.xml on XML contentType', async () => {
      mockLexwareDownload.mockResolvedValue({
        fileName: undefined,
        contentType: 'application/xml',
        data: Buffer.from('<xml/>'),
      });
      const tools = await registerAndCapture();
      const dl = getTool(tools, 'lexware_download_invoice_file');
      const result = (await dl.handler({ id: 'inv-x', format: 'xml' })) as {
        structuredContent: { fileName: string; contentType: string };
      };
      expect(mockLexwareDownload).toHaveBeenCalledExactlyOnceWith(
        '/invoices/inv-x/file',
        'application/xml',
      );
      // Extension swaps to .xml ONLY because the returned contentType is XML.
      expect(result.structuredContent.fileName).toBe('invoice.xml');
      expect(result.structuredContent.contentType).toBe('application/xml');
    });

    it('keeps invoice.pdf even with format="xml" when the API still returns a PDF', async () => {
      // The filename follows the RETURNED contentType, not the requested format —
      // so an xml request that the API answers with a PDF keeps the .pdf name.
      mockLexwareDownload.mockResolvedValue({
        fileName: undefined,
        contentType: 'application/pdf',
        data: Buffer.from('PDF'),
      });
      const tools = await registerAndCapture();
      const dl = getTool(tools, 'lexware_download_invoice_file');
      const result = (await dl.handler({ id: 'inv-p', format: 'xml' })) as {
        structuredContent: { fileName: string };
      };
      expect(result.structuredContent.fileName).toBe('invoice.pdf');
    });

    it('honors a server-provided content-disposition filename over the fallback', async () => {
      mockLexwareDownload.mockResolvedValue({
        fileName: 'RE-2026-001.xml',
        contentType: 'application/xml',
        data: Buffer.from('<xml/>'),
      });
      const tools = await registerAndCapture();
      const dl = getTool(tools, 'lexware_download_invoice_file');
      const result = (await dl.handler({ id: 'inv-srv', format: 'xml' })) as {
        structuredContent: { fileName: string };
      };
      expect(result.structuredContent.fileName).toBe('RE-2026-001.xml');
    });
  });

  describe('lexware_pursue_invoice', () => {
    // Documented endpoint:
    //   POST /v1/invoices?precedingSalesVoucherId={id}[&finalize=true]
    // The pursue action is a CREATE on /invoices with a chaining query param.
    // The prior implementation hit an undocumented
    // `POST /invoices/{id}/actions/pursue` path that returns HTTP 404 on the live API.
    it('POSTs to /invoices with precedingSalesVoucherId and body, no finalize when omitted', async () => {
      mockLexwareRequest.mockResolvedValue({ id: 'p-1', version: 1 });
      const tools = await registerAndCapture();
      const pursue = getTool(tools, 'lexware_pursue_invoice');

      await pursue.handler({
        precedingSalesVoucherId: '58e512ce-ea13-11eb-bac8-2f511e28942a',
        body: { foo: 'bar' },
      });

      expect(mockLexwareRequest).toHaveBeenCalledExactlyOnceWith(
        'POST',
        '/invoices',
        { foo: 'bar' },
        { precedingSalesVoucherId: '58e512ce-ea13-11eb-bac8-2f511e28942a' },
      );
    });

    it('passes finalize=true through to the documented ?finalize query parameter', async () => {
      mockLexwareRequest.mockResolvedValue({ id: 'p-2', version: 1 });
      const tools = await registerAndCapture();
      const pursue = getTool(tools, 'lexware_pursue_invoice');

      await pursue.handler({
        precedingSalesVoucherId: '58e512ce-ea13-11eb-bac8-2f511e28942a',
        body: { foo: 'bar' },
        finalize: true,
      });

      expect(mockLexwareRequest).toHaveBeenCalledExactlyOnceWith(
        'POST',
        '/invoices',
        { foo: 'bar' },
        {
          precedingSalesVoucherId: '58e512ce-ea13-11eb-bac8-2f511e28942a',
          finalize: true,
        },
      );
    });

    it('treats finalize=false as draft (no ?finalize on the wire)', async () => {
      mockLexwareRequest.mockResolvedValue({ id: 'p-3', version: 1 });
      const tools = await registerAndCapture();
      const pursue = getTool(tools, 'lexware_pursue_invoice');

      await pursue.handler({
        precedingSalesVoucherId: '58e512ce-ea13-11eb-bac8-2f511e28942a',
        body: { foo: 'bar' },
        finalize: false,
      });

      // The docs only define `[&finalize=true]`. Some HTTP parsers treat any
      // non-empty query value (including the literal "false") as truthy, so
      // finalize=false must NOT reach the wire.
      expect(mockLexwareRequest).toHaveBeenCalledExactlyOnceWith(
        'POST',
        '/invoices',
        { foo: 'bar' },
        { precedingSalesVoucherId: '58e512ce-ea13-11eb-bac8-2f511e28942a' },
      );
    });

    it('declares precedingSalesVoucherId + body + finalize in its input schema', async () => {
      const tools = await registerAndCapture();
      const pursue = getTool(tools, 'lexware_pursue_invoice');
      expect(pursue.schemaShape).toHaveProperty('precedingSalesVoucherId');
      expect(pursue.schemaShape).toHaveProperty('body');
      expect(pursue.schemaShape).toHaveProperty('finalize');
      // The old broken contract used a `version` param for the imagined
      // status-transition; the documented pursue is a create-with-chain, so
      // version no longer applies.
      expect(pursue.schemaShape).not.toHaveProperty('version');
    });
  });

  describe('lexware_deeplink_invoice', () => {
    it('returns a permalink edit URL without hitting the API', async () => {
      const tools = await registerAndCapture();
      const deeplink = getTool(tools, 'lexware_deeplink_invoice');

      const result = await deeplink.handler({ id: 'abc-uuid' });

      expect(mockLexwareRequest).not.toHaveBeenCalled();
      expect(result).toMatchObject({
        structuredContent: {
          deeplink: 'https://app.lexware.de/permalink/invoices/edit/abc-uuid',
        },
      });
    });
  });
});
