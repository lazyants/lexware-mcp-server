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
  const { registerDunningTools } = await import('../../tools/dunnings.js');
  return registerAndCapture(registerDunningTools as (s: unknown) => void);
}

describe('dunnings tool registry', () => {
  beforeEach(() => {
    mockLexwareRequest.mockReset();
    mockLexwareDownload.mockReset();
  });

  it('registers exactly the expected 5 dunning tools', async () => {
    const tools = await loadAndRegister();
    expect([...tools.keys()].sort()).toEqual([
      'lexware_create_dunning',
      'lexware_deeplink_dunning',
      'lexware_download_dunning_file',
      'lexware_get_dunning',
      'lexware_pursue_dunning',
    ]);
  });

  describe('lexware_create_dunning', () => {
    it('POSTs /dunnings with the body payload', async () => {
      mockLexwareRequest.mockResolvedValue({ id: 'd-1', version: 1 });
      const tools = await loadAndRegister();
      const create = getTool(tools, 'lexware_create_dunning');
      const body = { voucherDate: '2026-01-01', lineItems: [] };
      await create.handler({ body });
      expect(mockLexwareRequest).toHaveBeenCalledExactlyOnceWith(
        'POST',
        '/dunnings',
        body,
      );
    });
  });

  describe('lexware_get_dunning', () => {
    it('GETs /dunnings/{id}', async () => {
      mockLexwareRequest.mockResolvedValue({ id: 'd-1' });
      const tools = await loadAndRegister();
      const get = getTool(tools, 'lexware_get_dunning');
      await get.handler({ id: '745f3319-f473-4d55-9943-fecd942fd76d' });
      expect(mockLexwareRequest).toHaveBeenCalledExactlyOnceWith(
        'GET',
        '/dunnings/745f3319-f473-4d55-9943-fecd942fd76d',
      );
    });
  });

  describe('lexware_download_dunning_file', () => {
    it('calls lexwareDownload with the file path and base64-encodes the bytes', async () => {
      mockLexwareDownload.mockResolvedValue({
        fileName: 'd.pdf',
        contentType: 'application/pdf',
        data: Buffer.from('DUN'),
      });
      const tools = await loadAndRegister();
      const dl = getTool(tools, 'lexware_download_dunning_file');
      const result = (await dl.handler({ id: 'd-1' })) as {
        structuredContent: { fileName: string; contentType: string; contentBase64: string };
      };
      expect(mockLexwareDownload).toHaveBeenCalledExactlyOnceWith('/dunnings/d-1/file');
      expect(result.structuredContent.fileName).toBe('d.pdf');
      expect(result.structuredContent.contentBase64).toBe(Buffer.from('DUN').toString('base64'));
    });

    it('falls back to "dunning.pdf" when the service omits fileName', async () => {
      mockLexwareDownload.mockResolvedValue({
        fileName: undefined,
        contentType: 'application/pdf',
        data: Buffer.from('X'),
      });
      const tools = await loadAndRegister();
      const dl = getTool(tools, 'lexware_download_dunning_file');
      const result = (await dl.handler({ id: 'd-2' })) as {
        structuredContent: { fileName: string };
      };
      expect(result.structuredContent.fileName).toBe('dunning.pdf');
    });
  });

  describe('lexware_pursue_dunning', () => {
    it('POSTs /dunnings/{id}/actions/pursue with version query param', async () => {
      mockLexwareRequest.mockResolvedValue({ id: 'd-1', version: 2 });
      const tools = await loadAndRegister();
      const pursue = getTool(tools, 'lexware_pursue_dunning');
      await pursue.handler({ id: 'd-1', version: 4 });
      expect(mockLexwareRequest).toHaveBeenCalledExactlyOnceWith(
        'POST',
        '/dunnings/d-1/actions/pursue',
        undefined,
        { version: 4 },
      );
    });
  });

  describe('lexware_deeplink_dunning', () => {
    it('returns a /permalink/dunnings/edit URL without hitting the API', async () => {
      const tools = await loadAndRegister();
      const deeplink = getTool(tools, 'lexware_deeplink_dunning');
      const result = (await deeplink.handler({ id: 'd-9' })) as {
        structuredContent: { deeplink: string };
      };
      expect(result.structuredContent.deeplink).toBe(
        'https://app.lexware.io/permalink/dunnings/edit/d-9',
      );
      expect(mockLexwareRequest).not.toHaveBeenCalled();
    });
  });
});
