import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MIME_TYPE_RE, MimeTypeSchema } from '../schemas/common.js';

// GOTCHA: vi.mock is hoisted above top-level const declarations. Use vi.hoisted()
// to create mock fns that are accessible inside the vi.mock factory.
const { mockRequest, mockCreate, mockGetPassword } = vi.hoisted(() => ({
  mockRequest: vi.fn(),
  mockCreate: vi.fn(),
  mockGetPassword: vi.fn<(signal?: AbortSignal) => Promise<string | undefined>>().mockResolvedValue(undefined),
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

// lexwareUpload resolves the client and token BEFORE the MIME guard runs
// (`Promise.all([getClient(), getToken()])` ahead of `assertValidMimeType` —
// src/services/lexware.ts), so every sink-side case below would otherwise hit a
// real OS keyring read (5s timeout on a locked store). Mirror the established
// hermeticity pattern at lexware-client.test.ts:13-19.
vi.mock('@napi-rs/keyring', () => ({
  AsyncEntry: vi.fn(function () { return { getPassword: mockGetPassword }; } as any),
}));

// Hermetic setup shared by BOTH describe blocks below. These hooks are at FILE
// scope deliberately: hooks nested inside the first describe would not apply to
// the D2 sibling block, which would then pass only as a side effect of the first
// block having left services/lexware.ts's module-level token single-flight cache
// warm — green as a whole file, red under `-t` filtering, a describe reorder, or
// a split into two files.
const originalEnv = process.env.LEXWARE_API_TOKEN;

beforeEach(() => {
  vi.resetModules();
  process.env.LEXWARE_API_TOKEN = 'test-token';
  mockRequest.mockReset();
  mockCreate.mockClear();
  mockGetPassword.mockResolvedValue(undefined);
});

afterEach(() => {
  if (originalEnv !== undefined) {
    process.env.LEXWARE_API_TOKEN = originalEnv;
  } else {
    delete process.env.LEXWARE_API_TOKEN;
  }
});

// Focused on the #67 MIME guard and the #74.1 native-FormData body shape in
// lexwareUpload — lexware-client.test.ts covers the rest of its request plumbing
// (headers, the `type` part, error redaction).
describe('lexwareUpload MIME guard and body shape', () => {
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

// D1/D2 (#88): MimeTypeSchema (the MCP input boundary) and assertValidMimeType
// (the sink guard, exercised here via lexwareUpload) are built on ONE exported
// regex (MIME_TYPE_RE). This is the actual anti-drift mechanism — a single
// (value, shouldPass) table driven through both layers in one test, so adding a
// row automatically exercises both without separate per-layer lists.
describe('D2: cross-layer agreement — boundary MimeTypeSchema vs sink assertValidMimeType', () => {
  const CROSS_LAYER_CORPUS: Array<[value: string, shouldPass: boolean]> = [
    ['application/pdf', true], // every current call site
    ['application/pdf; charset=utf-8', true], // §1.3(b) — Blob preserves it
    ['application/pdf\r\nX-Injected: evil', false], // the original #67 injection
    ['application/pdf;\tcharset=utf-8', false], // tab is outside 0x20-0x7E
    ['not-a-mime-type', false], // no '/'
    ['application/pdf\x00', false], // NUL — non-CR/LF control byte
    ['application/pdf; x=ü', false], // non-ASCII in the parameter tail
    ['text/plain', true], // second plain type — guards an accidental application/-only anchor
    ['', false], // D3: '' is rejected at both layers, not silently defaulted
  ];

  it.each(CROSS_LAYER_CORPUS)(
    '%s -> shouldPass=%s agrees at the boundary and the sink',
    async (value, shouldPass) => {
      expect(MimeTypeSchema.safeParse(value).success).toBe(shouldPass);

      mockRequest.mockResolvedValue({ data: { id: 'ok' } });
      const { lexwareUpload } = await import('../services/lexware.js');
      const sink = lexwareUpload('/files', Buffer.from('x'), 'a.pdf', value);

      if (shouldPass) {
        await expect(sink).resolves.toEqual({ id: 'ok' });
      } else {
        // Assert the MIME guard rejected it, not merely that SOMETHING threw.
        // A bare `.then(() => true, () => false)` would also swallow a missing
        // API token or a downstream TypeError and report them as a correct
        // rejection — which is exactly what once masked a hermeticity defect here.
        await expect(sink).rejects.toThrow(`Invalid contentType for upload: ${JSON.stringify(value)}`);
      }
    },
  );

  it('MIME_TYPE_RE is stateless (no g/y flags) — a shared regex object cannot leak match state between layers', () => {
    expect(MIME_TYPE_RE.global).toBe(false);
    expect(MIME_TYPE_RE.sticky).toBe(false);
    MIME_TYPE_RE.test('application/pdf');
    expect(MIME_TYPE_RE.lastIndex).toBe(0);
    MIME_TYPE_RE.test('not-a-mime-type');
    expect(MIME_TYPE_RE.lastIndex).toBe(0);
  });

  // The agreement invariant above holds for PRIMITIVE STRINGS ONLY. z.string()
  // rejects a non-primitive-string input outright, while RegExp.test coerces its
  // argument to a string first — assertValidMimeType is a thin `MIME_TYPE_RE.test`
  // wrapper (src/services/lexware.ts), so this coercion is the same one the sink
  // would perform. The boundary is therefore strictly STRICTER than the sink here,
  // never looser — the fail-safe direction — so do not generalize the corpus above
  // into an unqualified "the two layers always agree".
  it('rejects an array at the boundary, even though String(["application/pdf"]) coerces to a value the sink regex would accept', () => {
    const arrayValue = ['application/pdf'] as unknown as string;
    expect(MimeTypeSchema.safeParse(arrayValue).success).toBe(false);
    expect(MIME_TYPE_RE.test(arrayValue)).toBe(true);
  });

  it('rejects a boxed String at the boundary, even though the sink regex coerces and accepts it', () => {
    // Deliberately a boxed String, not a primitive — see the invariant comment above.
    const boxed = new String('application/pdf') as unknown as string;
    expect(MimeTypeSchema.safeParse(boxed).success).toBe(false);
    expect(MIME_TYPE_RE.test(boxed)).toBe(true);
  });
});
