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
  const { registerCreditNoteTools } = await import('../../tools/credit-notes.js');
  return registerAndCapture(registerCreditNoteTools as (s: unknown) => void);
}

describe('credit-notes tool registry', () => {
  beforeEach(() => {
    mockLexwareRequest.mockReset();
    mockLexwareDownload.mockReset();
  });

  it('registers exactly the expected 5 credit-note tools', async () => {
    const tools = await loadAndRegister();
    expect([...tools.keys()].sort()).toEqual([
      'lexware_create_credit_note',
      'lexware_deeplink_credit_note',
      'lexware_download_credit_note_file',
      'lexware_get_credit_note',
      'lexware_pursue_credit_note',
    ]);
  });

  describe('lexware_create_credit_note', () => {
    it('POSTs /credit-notes with the body payload', async () => {
      mockLexwareRequest.mockResolvedValue({ id: 'cn-1', version: 1 });
      const tools = await loadAndRegister();
      const create = getTool(tools, 'lexware_create_credit_note');
      const body = { voucherDate: '2026-01-01', lineItems: [] };
      await create.handler({ body });
      expect(mockLexwareRequest).toHaveBeenCalledExactlyOnceWith(
        'POST',
        '/credit-notes',
        body,
      );
    });
  });

  describe('lexware_get_credit_note', () => {
    it('GETs /credit-notes/{id}', async () => {
      mockLexwareRequest.mockResolvedValue({ id: 'cn-1' });
      const tools = await loadAndRegister();
      const get = getTool(tools, 'lexware_get_credit_note');
      await get.handler({ id: '745f3319-f473-4d55-9943-fecd942fd76d' });
      expect(mockLexwareRequest).toHaveBeenCalledExactlyOnceWith(
        'GET',
        '/credit-notes/745f3319-f473-4d55-9943-fecd942fd76d',
      );
    });
  });

  describe('lexware_download_credit_note_file', () => {
    it('calls lexwareDownload with the file path and returns base64 payload', async () => {
      mockLexwareDownload.mockResolvedValue({
        fileName: 'mycn.pdf',
        contentType: 'application/pdf',
        data: Buffer.from('PDFBYTES'),
      });
      const tools = await loadAndRegister();
      const dl = getTool(tools, 'lexware_download_credit_note_file');
      const result = (await dl.handler({ id: 'cn-1' })) as {
        structuredContent: { fileName: string; contentType: string; contentBase64: string };
      };
      expect(mockLexwareDownload).toHaveBeenCalledExactlyOnceWith('/credit-notes/cn-1/file');
      expect(mockLexwareRequest).not.toHaveBeenCalled();
      expect(result.structuredContent.fileName).toBe('mycn.pdf');
      expect(result.structuredContent.contentType).toBe('application/pdf');
      expect(result.structuredContent.contentBase64).toBe(
        Buffer.from('PDFBYTES').toString('base64'),
      );
    });

    it('falls back to "credit-note.pdf" when the service omits fileName', async () => {
      mockLexwareDownload.mockResolvedValue({
        fileName: undefined,
        contentType: 'application/pdf',
        data: Buffer.from('X'),
      });
      const tools = await loadAndRegister();
      const dl = getTool(tools, 'lexware_download_credit_note_file');
      const result = (await dl.handler({ id: 'cn-2' })) as {
        structuredContent: { fileName: string };
      };
      expect(result.structuredContent.fileName).toBe('credit-note.pdf');
    });
  });

  describe('lexware_pursue_credit_note', () => {
    it('POSTs /credit-notes/{id}/actions/pursue with version query param', async () => {
      mockLexwareRequest.mockResolvedValue({ id: 'cn-1', version: 2 });
      const tools = await loadAndRegister();
      const pursue = getTool(tools, 'lexware_pursue_credit_note');
      await pursue.handler({ id: 'cn-1', version: 1 });
      expect(mockLexwareRequest).toHaveBeenCalledExactlyOnceWith(
        'POST',
        '/credit-notes/cn-1/actions/pursue',
        undefined,
        { version: 1 },
      );
    });
  });

  describe('lexware_deeplink_credit_note', () => {
    it('returns a /permalink/credit-notes/edit URL without hitting the API', async () => {
      const tools = await loadAndRegister();
      const deeplink = getTool(tools, 'lexware_deeplink_credit_note');
      const result = (await deeplink.handler({ id: 'cn-7' })) as {
        structuredContent: { deeplink: string };
      };
      // Sales-document deeplinks use `edit/` (only contacts use `view/`).
      expect(result.structuredContent.deeplink).toBe(
        'https://app.lexware.io/permalink/credit-notes/edit/cn-7',
      );
      expect(mockLexwareRequest).not.toHaveBeenCalled();
    });
  });
});
