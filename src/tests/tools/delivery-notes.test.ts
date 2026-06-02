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
  const { registerDeliveryNoteTools } = await import('../../tools/delivery-notes.js');
  return registerAndCapture(registerDeliveryNoteTools as (s: unknown) => void);
}

describe('delivery-notes tool registry', () => {
  beforeEach(() => {
    mockLexwareRequest.mockReset();
    mockLexwareDownload.mockReset();
  });

  it('registers exactly the expected 5 delivery-note tools', async () => {
    const tools = await loadAndRegister();
    expect([...tools.keys()].sort()).toEqual([
      'lexware_create_delivery_note',
      'lexware_deeplink_delivery_note',
      'lexware_download_delivery_note_file',
      'lexware_get_delivery_note',
      'lexware_pursue_delivery_note',
    ]);
  });

  describe('lexware_create_delivery_note', () => {
    it('POSTs /delivery-notes with the body payload', async () => {
      mockLexwareRequest.mockResolvedValue({ id: 'dn-1', version: 1 });
      const tools = await loadAndRegister();
      const create = getTool(tools, 'lexware_create_delivery_note');
      const body = { voucherDate: '2026-01-01', lineItems: [] };
      await create.handler({ body });
      expect(mockLexwareRequest).toHaveBeenCalledExactlyOnceWith(
        'POST',
        '/delivery-notes',
        body,
      );
    });
  });

  describe('lexware_get_delivery_note', () => {
    it('GETs /delivery-notes/{id}', async () => {
      mockLexwareRequest.mockResolvedValue({ id: 'dn-1' });
      const tools = await loadAndRegister();
      const get = getTool(tools, 'lexware_get_delivery_note');
      await get.handler({ id: '745f3319-f473-4d55-9943-fecd942fd76d' });
      expect(mockLexwareRequest).toHaveBeenCalledExactlyOnceWith(
        'GET',
        '/delivery-notes/745f3319-f473-4d55-9943-fecd942fd76d',
      );
    });
  });

  describe('lexware_download_delivery_note_file', () => {
    it('calls lexwareDownload with the file path and base64-encodes the bytes', async () => {
      mockLexwareDownload.mockResolvedValue({
        fileName: 'd.pdf',
        contentType: 'application/pdf',
        data: Buffer.from('ABC'),
      });
      const tools = await loadAndRegister();
      const dl = getTool(tools, 'lexware_download_delivery_note_file');
      const result = (await dl.handler({ id: 'dn-1' })) as {
        structuredContent: { fileName: string; contentType: string; contentBase64: string };
      };
      expect(mockLexwareDownload).toHaveBeenCalledExactlyOnceWith('/delivery-notes/dn-1/file');
      expect(result.structuredContent.fileName).toBe('d.pdf');
      expect(result.structuredContent.contentBase64).toBe(Buffer.from('ABC').toString('base64'));
    });

    it('falls back to "delivery-note.pdf" when the service omits fileName', async () => {
      mockLexwareDownload.mockResolvedValue({
        fileName: undefined,
        contentType: 'application/pdf',
        data: Buffer.from('X'),
      });
      const tools = await loadAndRegister();
      const dl = getTool(tools, 'lexware_download_delivery_note_file');
      const result = (await dl.handler({ id: 'dn-2' })) as {
        structuredContent: { fileName: string };
      };
      expect(result.structuredContent.fileName).toBe('delivery-note.pdf');
    });
  });

  describe('lexware_pursue_delivery_note', () => {
    // Documented endpoint:
    //   POST /v1/delivery-notes?precedingSalesVoucherId={id}
    // The prior implementation hit an undocumented
    // `POST /delivery-notes/{id}/actions/pursue` path that returns HTTP 404 on the live API.
    it('POSTs /delivery-notes with precedingSalesVoucherId and body', async () => {
      mockLexwareRequest.mockResolvedValue({ id: 'dn-1', version: 1 });
      const tools = await loadAndRegister();
      const pursue = getTool(tools, 'lexware_pursue_delivery_note');
      await pursue.handler({
        precedingSalesVoucherId: '58e512ce-ea13-11eb-bac8-2f511e28942a',
        body: { foo: 'bar' },
      });
      expect(mockLexwareRequest).toHaveBeenCalledExactlyOnceWith(
        'POST',
        '/delivery-notes',
        { foo: 'bar' },
        { precedingSalesVoucherId: '58e512ce-ea13-11eb-bac8-2f511e28942a' },
      );
    });

    it('declares precedingSalesVoucherId + body in its input schema (no version, no finalize)', async () => {
      const tools = await loadAndRegister();
      const pursue = getTool(tools, 'lexware_pursue_delivery_note');
      expect(pursue.schemaShape).toHaveProperty('precedingSalesVoucherId');
      expect(pursue.schemaShape).toHaveProperty('body');
      expect(pursue.schemaShape).not.toHaveProperty('version');
      // The Lexware docs do not document `[&finalize=true]` on the delivery-notes
      // pursue endpoint, so the tool does not expose it.
      expect(pursue.schemaShape).not.toHaveProperty('finalize');
    });
  });

  describe('lexware_deeplink_delivery_note', () => {
    it('returns a /permalink/delivery-notes/edit URL without hitting the API', async () => {
      const tools = await loadAndRegister();
      const deeplink = getTool(tools, 'lexware_deeplink_delivery_note');
      const result = (await deeplink.handler({ id: 'dn-7' })) as {
        structuredContent: { deeplink: string };
      };
      expect(result.structuredContent.deeplink).toBe(
        'https://app.lexware.de/permalink/delivery-notes/edit/dn-7',
      );
      expect(mockLexwareRequest).not.toHaveBeenCalled();
    });
  });
});
