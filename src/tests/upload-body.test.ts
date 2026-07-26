import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// GOTCHA: vi.mock is hoisted above top-level const declarations. Use vi.hoisted()
// to create mock fns that are accessible inside the vi.mock factory.
const { mockRequest, mockCreate } = vi.hoisted(() => ({
  mockRequest: vi.fn(),
  mockCreate: vi.fn(),
}));

vi.mock('axios', async (importOriginal) => {
  const actual = await importOriginal<typeof import('axios')>();
  const mockInstance = {
    request: mockRequest,
    interceptors: { response: { use: vi.fn() } },
  };
  mockCreate.mockReturnValue(mockInstance);
  return {
    ...actual,
    default: { ...actual.default, create: mockCreate },
  };
});

// Focused on the #67 MIME guard and the #74.1 native-FormData body shape in
// lexwareUpload — lexware-client.test.ts covers the rest of its request plumbing
// (headers, the `type` part, error redaction).
describe('lexwareUpload MIME guard and body shape', () => {
  const originalEnv = process.env.LEXWARE_API_TOKEN;

  beforeEach(() => {
    vi.resetModules();
    process.env.LEXWARE_API_TOKEN = 'test-token';
    mockRequest.mockReset();
    mockCreate.mockClear();
  });

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.LEXWARE_API_TOKEN = originalEnv;
    } else {
      delete process.env.LEXWARE_API_TOKEN;
    }
  });

  // Regression test for #67: `form-data` escapes the field name and filename but
  // NOT contentType — it writes it into the multipart part header verbatim. Reject,
  // never silently strip, so the caller sees its own mistake instead of a mangled
  // upload.
  it('rejects a contentType carrying a CRLF header-injection payload — never reaches client.request', async () => {
    const { lexwareUpload } = await import('../services/lexware.js');
    await expect(
      lexwareUpload(
        '/files',
        Buffer.from('x'),
        'a.pdf',
        'application/pdf\r\nX-Injected: evil\r\n\r\nSMUGGLED',
      ),
    ).rejects.toThrow(/Invalid contentType/);
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('rejects a contentType with no type/subtype slash', async () => {
    const { lexwareUpload } = await import('../services/lexware.js');
    await expect(
      lexwareUpload('/files', Buffer.from('x'), 'a.pdf', 'not-a-mime-type'),
    ).rejects.toThrow(/Invalid contentType/);
    expect(mockRequest).not.toHaveBeenCalled();
  });

  // Exact-message check: the guard reports the offending value (safely, via
  // JSON.stringify rather than embedding raw CR/LF into the message) rather than
  // silently coercing or truncating it.
  it('reports the exact malformed value in the rejection message', async () => {
    const { lexwareUpload } = await import('../services/lexware.js');
    const malformed = 'application/pdf\r\nsneaky';
    await expect(
      lexwareUpload('/files', Buffer.from('x'), 'a.pdf', malformed),
    ).rejects.toThrow(`Invalid contentType for upload: ${JSON.stringify(malformed)}`);
  });

  // §1.3(b): the grammar is deliberately parameter-tolerant. A strict `type/subtype`
  // regex would wrongly reject a value the Blob constructor itself accepts.
  it('accepts a contentType with a parameter tail (charset)', async () => {
    mockRequest.mockResolvedValue({ data: { id: 'file-1' } });
    const { lexwareUpload } = await import('../services/lexware.js');
    await lexwareUpload('/files', Buffer.from('x'), 'a.pdf', 'application/pdf; charset=utf-8');
    const callArgs = mockRequest.mock.calls[0][0];
    const filePart = callArgs.data.get('file') as File;
    expect(filePart.type).toBe('application/pdf; charset=utf-8');
  });

  // Regression: the guard must not accept a value the Blob constructor will itself
  // blank to "" — that recreates the exact silent-degradation failure the guard
  // exists to prevent (§1.3b). Blob's own filter rejects ANY character outside the
  // printable-ASCII range 0x20-0x7E, not merely CR/LF, so a tab (or any other
  // control byte) in the parameter tail must be rejected too.
  it('rejects a contentType with a non-CR/LF control character in the parameter tail', async () => {
    const { lexwareUpload } = await import('../services/lexware.js');
    const withTab = 'application/pdf;\tcharset=utf-8';
    await expect(
      lexwareUpload('/files', Buffer.from('x'), 'a.pdf', withTab),
    ).rejects.toThrow(`Invalid contentType for upload: ${JSON.stringify(withTab)}`);
    expect(mockRequest).not.toHaveBeenCalled();
  });

  // Narrowness guard: every existing upload call site passes a plain type with no
  // parameters — must keep working unchanged.
  it('accepts a plain contentType with no parameters', async () => {
    mockRequest.mockResolvedValue({ data: { id: 'file-2' } });
    const { lexwareUpload } = await import('../services/lexware.js');
    await expect(
      lexwareUpload('/files', Buffer.from('x'), 'a.pdf', 'application/pdf'),
    ).resolves.toEqual({ id: 'file-2' });
  });

  // #74.1: the file part is a real Blob carrying the exact bytes passed in, not a
  // reference to the original Buffer.
  it('wraps the file bytes in a Blob with the declared type', async () => {
    mockRequest.mockResolvedValue({ data: { id: 'file-3' } });
    const { lexwareUpload } = await import('../services/lexware.js');
    await lexwareUpload('/files', Buffer.from('pdf-bytes'), 'report.pdf', 'application/pdf');
    const callArgs = mockRequest.mock.calls[0][0];
    const filePart = callArgs.data.get('file') as File;
    expect(filePart).toBeInstanceOf(Blob);
    expect(filePart.type).toBe('application/pdf');
    expect(await filePart.text()).toBe('pdf-bytes');
  });
});
