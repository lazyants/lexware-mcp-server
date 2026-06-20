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
      expect(mockLexwareDownload).toHaveBeenCalledExactlyOnceWith(
        '/dunnings/d-1/file',
        'application/pdf',
      );
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

    it('threads format="xml" to the application/xml Accept and yields dunning.xml on XML contentType', async () => {
      mockLexwareDownload.mockResolvedValue({
        fileName: undefined,
        contentType: 'application/xml',
        data: Buffer.from('<xml/>'),
      });
      const tools = await loadAndRegister();
      const dl = getTool(tools, 'lexware_download_dunning_file');
      const result = (await dl.handler({ id: 'd-x', format: 'xml' })) as {
        structuredContent: { fileName: string };
      };
      expect(mockLexwareDownload).toHaveBeenCalledExactlyOnceWith(
        '/dunnings/d-x/file',
        'application/xml',
      );
      expect(result.structuredContent.fileName).toBe('dunning.xml');
    });
  });

  describe('lexware_pursue_dunning', () => {
    // Documented endpoint:
    //   POST /v1/dunnings?precedingSalesVoucherId={id}
    // Dunnings require an invoice reference (the precedingSalesVoucherId is
    // a mandatory query parameter per the Lexware docs) and are always created
    // in draft mode (no `finalize` parameter). The prior implementation hit an
    // undocumented `POST /dunnings/{id}/actions/pursue` path that returns 404.
    it('POSTs /dunnings with precedingSalesVoucherId and body', async () => {
      mockLexwareRequest.mockResolvedValue({ id: 'd-1', version: 1 });
      const tools = await loadAndRegister();
      const pursue = getTool(tools, 'lexware_pursue_dunning');
      await pursue.handler({
        precedingSalesVoucherId: '58e512ce-ea13-11eb-bac8-2f511e28942a',
        body: { foo: 'bar' },
      });
      expect(mockLexwareRequest).toHaveBeenCalledExactlyOnceWith(
        'POST',
        '/dunnings',
        { foo: 'bar' },
        { precedingSalesVoucherId: '58e512ce-ea13-11eb-bac8-2f511e28942a' },
      );
    });

    it('declares precedingSalesVoucherId + body in its input schema (no version, no finalize)', async () => {
      const tools = await loadAndRegister();
      const pursue = getTool(tools, 'lexware_pursue_dunning');
      expect(pursue.schemaShape).toHaveProperty('precedingSalesVoucherId');
      expect(pursue.schemaShape).toHaveProperty('body');
      expect(pursue.schemaShape).not.toHaveProperty('version');
      // Dunnings are always created in draft mode per the Lexware docs.
      expect(pursue.schemaShape).not.toHaveProperty('finalize');
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
        'https://app.lexware.de/permalink/dunnings/edit/d-9',
      );
      expect(mockLexwareRequest).not.toHaveBeenCalled();
    });
  });
});
