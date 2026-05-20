import { describe, it, expect, vi, beforeEach } from 'vitest';
import { registerAndCapture, getTool } from './_helpers.js';

const { mockLexwareRequest, mockLexwareDownload, mockLexwareUpload } = vi.hoisted(() => ({
  mockLexwareRequest: vi.fn(),
  mockLexwareDownload: vi.fn(),
  mockLexwareUpload: vi.fn(),
}));

vi.mock('../../services/lexware.js', () => ({
  lexwareRequest: mockLexwareRequest,
  lexwareDownload: mockLexwareDownload,
  lexwareUpload: mockLexwareUpload,
}));

async function loadAndRegister() {
  const { registerFileTools } = await import('../../tools/files.js');
  return registerAndCapture(registerFileTools as (s: unknown) => void);
}

describe('files tool registry', () => {
  beforeEach(() => {
    mockLexwareRequest.mockReset();
    mockLexwareDownload.mockReset();
    mockLexwareUpload.mockReset();
  });

  it('registers exactly the expected 3 file tools', async () => {
    const tools = await loadAndRegister();
    expect([...tools.keys()].sort()).toEqual([
      'lexware_download_file',
      'lexware_get_file_status',
      'lexware_upload_file',
    ]);
  });

  describe('lexware_upload_file', () => {
    it('POSTs the base64-decoded buffer with the supplied content type', async () => {
      mockLexwareUpload.mockResolvedValue({ id: 'f-1' });
      const tools = await loadAndRegister();
      const upload = getTool(tools, 'lexware_upload_file');
      const original = 'hello-pdf-bytes';
      const contentBase64 = Buffer.from(original).toString('base64');
      await upload.handler({
        fileName: 'mydoc.pdf',
        contentBase64,
        contentType: 'application/pdf',
      });
      expect(mockLexwareUpload).toHaveBeenCalledOnce();
      const [path, buffer, fileName, contentType] = mockLexwareUpload.mock.calls[0];
      expect(path).toBe('/files');
      expect(Buffer.isBuffer(buffer)).toBe(true);
      // Asserts the base64 → Buffer decode survives the round-trip — the
      // upload boundary is the only place we transform base64 back to bytes,
      // so getting this wrong silently corrupts uploaded documents.
      expect((buffer as Buffer).toString('utf8')).toBe(original);
      expect(fileName).toBe('mydoc.pdf');
      expect(contentType).toBe('application/pdf');
    });

    it('defaults contentType to application/pdf when omitted', async () => {
      mockLexwareUpload.mockResolvedValue({ id: 'f-2' });
      const tools = await loadAndRegister();
      const upload = getTool(tools, 'lexware_upload_file');
      await upload.handler({
        fileName: 'mydoc.pdf',
        contentBase64: Buffer.from('x').toString('base64'),
      });
      const [, , , contentType] = mockLexwareUpload.mock.calls[0];
      expect(contentType).toBe('application/pdf');
    });
  });

  describe('lexware_download_file', () => {
    it('calls lexwareDownload with /files/{id} and base64-encodes the bytes', async () => {
      mockLexwareDownload.mockResolvedValue({
        fileName: 'remote.pdf',
        contentType: 'application/pdf',
        data: Buffer.from('REMOTE'),
      });
      const tools = await loadAndRegister();
      const dl = getTool(tools, 'lexware_download_file');
      const result = (await dl.handler({ id: 'f-7' })) as {
        structuredContent: { fileName: string; contentType: string; contentBase64: string };
      };
      expect(mockLexwareDownload).toHaveBeenCalledExactlyOnceWith('/files/f-7');
      expect(result.structuredContent.fileName).toBe('remote.pdf');
      expect(result.structuredContent.contentBase64).toBe(
        Buffer.from('REMOTE').toString('base64'),
      );
    });

    it('falls back to "file" when the service omits fileName', async () => {
      mockLexwareDownload.mockResolvedValue({
        fileName: undefined,
        contentType: 'application/pdf',
        data: Buffer.from('X'),
      });
      const tools = await loadAndRegister();
      const dl = getTool(tools, 'lexware_download_file');
      const result = (await dl.handler({ id: 'f-8' })) as {
        structuredContent: { fileName: string };
      };
      expect(result.structuredContent.fileName).toBe('file');
    });
  });

  describe('lexware_get_file_status', () => {
    it('GETs /files/{id}', async () => {
      mockLexwareRequest.mockResolvedValue({ id: 'f-1', status: 'processed' });
      const tools = await loadAndRegister();
      const get = getTool(tools, 'lexware_get_file_status');
      await get.handler({ id: '745f3319-f473-4d55-9943-fecd942fd76d' });
      expect(mockLexwareRequest).toHaveBeenCalledExactlyOnceWith(
        'GET',
        '/files/745f3319-f473-4d55-9943-fecd942fd76d',
      );
    });
  });
});
