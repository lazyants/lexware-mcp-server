import { describe, it, expect, vi, beforeEach } from 'vitest';
import { registerAndCapture, getTool } from './_helpers.js';

const { mockLexwareRequest, mockLexwareDownload } = vi.hoisted(() => ({
  mockLexwareRequest: vi.fn(),
  mockLexwareDownload: vi.fn(),
}));

vi.mock('../../services/lexware.js', () => ({
  lexwareRequest: mockLexwareRequest,
  lexwareDownload: mockLexwareDownload,
}));

async function loadAndRegister() {
  const { registerQuotationTools } = await import('../../tools/quotations.js');
  return registerAndCapture(registerQuotationTools as (s: unknown) => void);
}

describe('quotations tool registry', () => {
  beforeEach(() => {
    mockLexwareRequest.mockReset();
    mockLexwareDownload.mockReset();
  });

  it('registers exactly the expected 5 quotation tools', async () => {
    const tools = await loadAndRegister();
    expect([...tools.keys()].sort()).toEqual([
      'lexware_create_quotation',
      'lexware_deeplink_quotation',
      'lexware_download_quotation_file',
      'lexware_get_quotation',
      'lexware_pursue_quotation',
    ]);
  });

  describe('lexware_create_quotation', () => {
    it('POSTs /quotations with the body payload', async () => {
      mockLexwareRequest.mockResolvedValue({ id: 'q-1', version: 1 });
      const tools = await loadAndRegister();
      const create = getTool(tools, 'lexware_create_quotation');
      const body = { voucherDate: '2026-01-01', expirationDate: '2026-02-01', lineItems: [] };
      await create.handler({ body });
      expect(mockLexwareRequest).toHaveBeenCalledExactlyOnceWith(
        'POST',
        '/quotations',
        body,
      );
    });
  });

  describe('lexware_get_quotation', () => {
    it('GETs /quotations/{id}', async () => {
      mockLexwareRequest.mockResolvedValue({ id: 'q-1' });
      const tools = await loadAndRegister();
      const get = getTool(tools, 'lexware_get_quotation');
      await get.handler({ id: '745f3319-f473-4d55-9943-fecd942fd76d' });
      expect(mockLexwareRequest).toHaveBeenCalledExactlyOnceWith(
        'GET',
        '/quotations/745f3319-f473-4d55-9943-fecd942fd76d',
      );
    });
  });

  describe('lexware_download_quotation_file', () => {
    it('calls lexwareDownload with the file path and base64-encodes the bytes', async () => {
      mockLexwareDownload.mockResolvedValue({
        fileName: 'q.pdf',
        contentType: 'application/pdf',
        data: Buffer.from('QQ'),
      });
      const tools = await loadAndRegister();
      const dl = getTool(tools, 'lexware_download_quotation_file');
      const result = (await dl.handler({ id: 'q-1' })) as {
        structuredContent: { fileName: string; contentType: string; contentBase64: string };
      };
      expect(mockLexwareDownload).toHaveBeenCalledExactlyOnceWith('/quotations/q-1/file');
      expect(result.structuredContent.fileName).toBe('q.pdf');
      expect(result.structuredContent.contentBase64).toBe(Buffer.from('QQ').toString('base64'));
    });

    it('falls back to "quotation.pdf" when the service omits fileName', async () => {
      mockLexwareDownload.mockResolvedValue({
        fileName: undefined,
        contentType: 'application/pdf',
        data: Buffer.from('X'),
      });
      const tools = await loadAndRegister();
      const dl = getTool(tools, 'lexware_download_quotation_file');
      const result = (await dl.handler({ id: 'q-2' })) as {
        structuredContent: { fileName: string };
      };
      expect(result.structuredContent.fileName).toBe('quotation.pdf');
    });
  });

  describe('lexware_pursue_quotation', () => {
    it('POSTs /quotations/{id}/actions/pursue with version query param', async () => {
      mockLexwareRequest.mockResolvedValue({ id: 'q-1', version: 2 });
      const tools = await loadAndRegister();
      const pursue = getTool(tools, 'lexware_pursue_quotation');
      await pursue.handler({ id: 'q-1', version: 2 });
      expect(mockLexwareRequest).toHaveBeenCalledExactlyOnceWith(
        'POST',
        '/quotations/q-1/actions/pursue',
        undefined,
        { version: 2 },
      );
    });
  });

  describe('lexware_deeplink_quotation', () => {
    it('returns a /permalink/quotations/edit URL without hitting the API', async () => {
      const tools = await loadAndRegister();
      const deeplink = getTool(tools, 'lexware_deeplink_quotation');
      const result = (await deeplink.handler({ id: 'q-9' })) as {
        structuredContent: { deeplink: string };
      };
      expect(result.structuredContent.deeplink).toBe(
        'https://app.lexware.io/permalink/quotations/edit/q-9',
      );
      expect(mockLexwareRequest).not.toHaveBeenCalled();
    });
  });
});
