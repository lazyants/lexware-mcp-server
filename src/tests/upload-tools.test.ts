import { describe, it, expect, vi, beforeEach } from 'vitest';
import { z } from 'zod';
import { createServer } from '../server.js';
import { registerFileTools } from '../tools/files.js';
import { registerVoucherTools } from '../tools/vouchers.js';

// Cross-tool coverage for the shared `_upload.ts` source resolution, exercised
// through BOTH upload tools — the point of the shared module is that the two
// cannot drift, so each behaviour is asserted at each call site.
//
// GOTCHA: vi.hoisted() must be called before vi.mock() factories reference the mocks,
// because vi.mock is hoisted above top-level imports.
const mocks = vi.hoisted(() => ({
  realpathSync: vi.fn(),
  accessSync: vi.fn(),
  readFileSync: vi.fn(),
  lexwareUpload: vi.fn(),
  lexwareRequest: vi.fn(),
}));

vi.mock('node:fs', () => ({
  realpathSync: mocks.realpathSync,
  accessSync: mocks.accessSync,
  readFileSync: mocks.readFileSync,
  constants: { R_OK: 4 },
}));

vi.mock('../services/lexware.js', () => ({
  lexwareRequest: mocks.lexwareRequest,
  lexwareUpload: mocks.lexwareUpload,
  lexwareDownload: vi.fn(),
}));

type ToolCapture = { schema: z.ZodTypeAny; handler: (params: unknown) => Promise<unknown> };

// GOTCHA: McpServer.registerTool has overloaded signatures — use `any` + `.apply()` like smoke.test.ts.
// Unlike tests/tools/_helpers.ts this captures the whole schema, not just its shape:
// the cross-field refinements are exactly what needs asserting here.
function captureTools(registerFn: (server: ReturnType<typeof createServer>) => void): Map<string, ToolCapture> {
  const server = createServer('test');
  const captured = new Map<string, ToolCapture>();
  const orig = server.registerTool;
  server.registerTool = ((...args: any[]) => {
    const [name, config, handler] = args;
    captured.set(name, { schema: config.inputSchema, handler });
    return (orig as any).apply(server, args);
  }) as typeof server.registerTool;
  registerFn(server);
  return captured;
}

const VALID_UUID ='550e8400-e29b-41d4-a716-446655440000';

// ─── lexware_upload_file ──────────────────────────────────────────────────────

describe('lexware_upload_file', () => {
  let schema: z.ZodTypeAny;
  let handler: (params: unknown) => Promise<any>;

  beforeEach(() => {
    mocks.realpathSync.mockReset();
    mocks.accessSync.mockReset();
    mocks.readFileSync.mockReset();
    mocks.lexwareUpload.mockReset();
    mocks.lexwareRequest.mockReset();
    mocks.lexwareUpload.mockResolvedValue({ id: 'file-123' });

    const tools = captureTools(registerFileTools);
    ({ schema, handler } = tools.get('lexware_upload_file')!);
  });

  describe('schema validation', () => {
    it('accepts filePath alone', () => {
      expect(schema.safeParse({ filePath: '/absolute/path.pdf' }).success).toBe(true);
    });

    it('accepts filePath with explicit fileName and contentType', () => {
      expect(schema.safeParse({
        filePath: '/path/to/file.pdf',
        fileName: 'custom.pdf',
        contentType: 'application/pdf',
      }).success).toBe(true);
    });

    it('accepts contentBase64 + fileName', () => {
      expect(schema.safeParse({ contentBase64: 'abc', fileName: 'test.pdf' }).success).toBe(true);
    });

    it('rejects when neither filePath nor contentBase64 is provided', () => {
      expect(schema.safeParse({}).success).toBe(false);
    });

    it('rejects when both filePath and contentBase64 are provided', () => {
      expect(schema.safeParse({
        filePath: '/path.pdf',
        contentBase64: 'abc',
        fileName: 'test.pdf',
      }).success).toBe(false);
    });

    it('rejects contentBase64 without fileName', () => {
      expect(schema.safeParse({ contentBase64: 'abc' }).success).toBe(false);
    });

    // The shared MimeTypeSchema guard (#88) still applies on the new input shape.
    it('rejects a contentType that violates the shared MIME grammar', () => {
      expect(schema.safeParse({
        filePath: '/path.pdf',
        contentType: 'application/pdf\r\nX-Injected: 1',
      }).success).toBe(false);
    });
  });

  describe('handler — filePath branch', () => {
    it('returns error for relative path', async () => {
      const result = await handler({ filePath: 'relative/path.pdf' }) as any;
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('must be absolute');
    });

    it('returns error with path when realpathSync fails', async () => {
      mocks.realpathSync.mockImplementation(() => { throw Object.assign(new Error('no such file or directory'), { code: 'ENOENT' }); });
      const result = await handler({ filePath: '/nonexistent.pdf' }) as any;
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Cannot resolve filePath');
      expect(result.content[0].text).toContain('/nonexistent.pdf');
    });

    it('returns error with resolved path when accessSync fails', async () => {
      mocks.realpathSync.mockReturnValue('/real/path.pdf');
      mocks.accessSync.mockImplementation(() => { throw Object.assign(new Error('permission denied'), { code: 'EACCES' }); });
      const result = await handler({ filePath: '/symlink/path.pdf' }) as any;
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('File not readable');
      expect(result.content[0].text).toContain('/real/path.pdf');
    });

    it('reads the resolved (symlink-resolved) path', async () => {
      mocks.realpathSync.mockReturnValue('/real/invoice.pdf');
      mocks.readFileSync.mockReturnValue(Buffer.from('content'));
      await handler({ filePath: '/symlink/invoice.pdf' });
      expect(mocks.readFileSync).toHaveBeenCalledWith('/real/invoice.pdf');
    });

    it('derives fileName from basename when not provided', async () => {
      mocks.realpathSync.mockReturnValue('/docs/invoice.pdf');
      mocks.readFileSync.mockReturnValue(Buffer.from('pdf-content'));
      await handler({ filePath: '/docs/invoice.pdf' });
      expect(mocks.lexwareUpload).toHaveBeenCalledWith('/files', expect.any(Buffer), 'invoice.pdf', 'application/pdf', 'voucher');
    });

    it('uses explicit fileName when provided', async () => {
      mocks.realpathSync.mockReturnValue('/docs/invoice.pdf');
      mocks.readFileSync.mockReturnValue(Buffer.from('content'));
      await handler({ filePath: '/docs/invoice.pdf', fileName: 'custom-name.pdf' });
      expect(mocks.lexwareUpload).toHaveBeenCalledWith('/files', expect.any(Buffer), 'custom-name.pdf', 'application/pdf', 'voucher');
    });

    it.each([
      ['/img.png',   'image/png'],
      ['/img.PNG',   'image/png'],
      ['/img.jpg',   'image/jpeg'],
      ['/img.jpeg',  'image/jpeg'],
      ['/img.JPEG',  'image/jpeg'],
      ['/img.tiff',  'image/tiff'],
      ['/img.tif',   'image/tiff'],
      ['/doc.pdf',   'application/pdf'],
      ['/doc.xyz',   'application/pdf'],
    ])('auto-detects contentType for %s → %s', async (filePath, expectedType) => {
      mocks.realpathSync.mockReturnValue(filePath);
      mocks.readFileSync.mockReturnValue(Buffer.from('content'));
      await handler({ filePath });
      expect(mocks.lexwareUpload).toHaveBeenCalledWith('/files', expect.any(Buffer), expect.any(String), expectedType, 'voucher');
    });

    it('explicit contentType overrides auto-detection', async () => {
      mocks.realpathSync.mockReturnValue('/docs/receipt.png');
      mocks.readFileSync.mockReturnValue(Buffer.from('content'));
      await handler({ filePath: '/docs/receipt.png', contentType: 'application/pdf' });
      expect(mocks.lexwareUpload).toHaveBeenCalledWith('/files', expect.any(Buffer), 'receipt.png', 'application/pdf', 'voucher');
    });

    it('returns no error on success', async () => {
      mocks.realpathSync.mockReturnValue('/docs/invoice.pdf');
      mocks.readFileSync.mockReturnValue(Buffer.from('content'));
      const result = await handler({ filePath: '/docs/invoice.pdf' }) as any;
      expect(result.isError).toBeUndefined();
    });
  });

  describe('handler — response', () => {
    beforeEach(() => {
      mocks.realpathSync.mockReturnValue('/docs/invoice.pdf');
      mocks.readFileSync.mockReturnValue(Buffer.from('content'));
    });

    it('returns the raw upload result without re-fetching the file', async () => {
      // The upload response carries the file id and the voucherId of the OCR
      // voucher draft. We must NOT re-fetch GET /files/{id} — that path is the
      // binary download endpoint and would bloat the response with the file body.
      mocks.lexwareUpload.mockResolvedValue({ id: 'file-abc', voucherId: 'voucher-xyz' });
      const sc = (await handler({ filePath: '/docs/invoice.pdf' }) as any).structuredContent;
      expect(sc).toEqual({ id: 'file-abc', voucherId: 'voucher-xyz' });
      expect(mocks.lexwareRequest).not.toHaveBeenCalled();
    });
  });

  describe('handler — contentBase64 branch', () => {
    it('decodes base64 and calls lexwareUpload', async () => {
      const content = Buffer.from('file-content').toString('base64');
      await handler({ contentBase64: content, fileName: 'doc.pdf' });
      expect(mocks.lexwareUpload).toHaveBeenCalledWith(
        '/files',
        Buffer.from('file-content'),
        'doc.pdf',
        'application/pdf',
        'voucher',
      );
    });

    it('uses explicit contentType', async () => {
      const content = Buffer.from('png-data').toString('base64');
      await handler({ contentBase64: content, fileName: 'img.png', contentType: 'image/png' });
      expect(mocks.lexwareUpload).toHaveBeenCalledWith('/files', expect.any(Buffer), 'img.png', 'image/png', 'voucher');
    });

    it('does not call any fs methods', async () => {
      await handler({ contentBase64: 'abc', fileName: 'test.pdf' });
      expect(mocks.realpathSync).not.toHaveBeenCalled();
      expect(mocks.accessSync).not.toHaveBeenCalled();
      expect(mocks.readFileSync).not.toHaveBeenCalled();
    });
  });
});

// ─── lexware_upload_voucher_file ──────────────────────────────────────────────

describe('lexware_upload_voucher_file', () => {
  let schema: z.ZodTypeAny;
  let handler: (params: unknown) => Promise<any>;

  beforeEach(() => {
    mocks.realpathSync.mockReset();
    mocks.accessSync.mockReset();
    mocks.readFileSync.mockReset();
    mocks.lexwareUpload.mockReset();
    mocks.lexwareRequest.mockReset();
    mocks.lexwareUpload.mockResolvedValue({ id: 'vf-456' });

    const tools = captureTools(registerVoucherTools);
    ({ schema, handler } = tools.get('lexware_upload_voucher_file')!);
  });

  describe('schema validation', () => {
    it('accepts id + filePath', () => {
      expect(schema.safeParse({ id: VALID_UUID, filePath: '/path/to/file.pdf' }).success).toBe(true);
    });

    it('accepts id + contentBase64 + fileName', () => {
      expect(schema.safeParse({ id: VALID_UUID, contentBase64: 'abc', fileName: 'file.pdf' }).success).toBe(true);
    });

    it('rejects when both filePath and contentBase64 are provided', () => {
      expect(schema.safeParse({
        id: VALID_UUID,
        filePath: '/path.pdf',
        contentBase64: 'abc',
        fileName: 'file.pdf',
      }).success).toBe(false);
    });

    it('rejects when neither is provided', () => {
      expect(schema.safeParse({ id: VALID_UUID }).success).toBe(false);
    });

    it('rejects contentBase64 without fileName', () => {
      expect(schema.safeParse({ id: VALID_UUID, contentBase64: 'abc' }).success).toBe(false);
    });

    it('rejects invalid voucher id', () => {
      expect(schema.safeParse({ id: 'not-a-uuid', filePath: '/path.pdf' }).success).toBe(false);
    });
  });

  describe('handler', () => {
    it('uploads to correct voucher endpoint with filePath', async () => {
      mocks.realpathSync.mockReturnValue('/docs/receipt.pdf');
      mocks.readFileSync.mockReturnValue(Buffer.from('content'));
      await handler({ id: VALID_UUID, filePath: '/docs/receipt.pdf' });
      // No 5th argument: /vouchers/{id}/files must NOT carry a `type` part.
      expect(mocks.lexwareUpload).toHaveBeenCalledWith(
        `/vouchers/${VALID_UUID}/files`,
        expect.any(Buffer),
        'receipt.pdf',
        'application/pdf',
      );
    });

    it('uploads to correct voucher endpoint with contentBase64', async () => {
      const content = Buffer.from('receipt-data').toString('base64');
      await handler({ id: VALID_UUID, contentBase64: content, fileName: 'receipt.pdf' });
      expect(mocks.lexwareUpload).toHaveBeenCalledWith(
        `/vouchers/${VALID_UUID}/files`,
        Buffer.from('receipt-data'),
        'receipt.pdf',
        'application/pdf',
      );
    });

    it('returns error for relative path', async () => {
      const result = await handler({ id: VALID_UUID, filePath: 'relative.pdf' }) as any;
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('must be absolute');
    });

    it('returns error with resolved path when accessSync fails', async () => {
      mocks.realpathSync.mockReturnValue('/real/voucher-doc.pdf');
      mocks.accessSync.mockImplementation(() => { throw Object.assign(new Error('permission denied'), { code: 'EACCES' }); });
      const result = await handler({ id: VALID_UUID, filePath: '/link/voucher-doc.pdf' }) as any;
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('/real/voucher-doc.pdf');
    });
  });
});
