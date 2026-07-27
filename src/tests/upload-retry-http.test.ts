import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import http from 'node:http';

// Real-socket counterpart to retry-interceptor.test.ts. That file mocks
// axios.create() and invokes the captured rejection handler directly, so it
// tests the interceptor's *decisions* (retry vs. reject, delay, retry count)
// and never serializes anything — its FormData case ends at
// `expect(mockRequest).toHaveBeenCalledExactlyOnceWith(axiosError.config)`.
// This file drives lexwareUpload() through createClient(), the real 429
// interceptor, and the real axios http adapter over an actual TCP socket, to
// prove the retried request is well-formed multipart ON THE WIRE — exactly
// what the mocked-axios test cannot see, and what issue #89 asks for.

// GOTCHA: vi.mock is hoisted above top-level const declarations. Use vi.hoisted()
// to create mock fns/state that are accessible inside the vi.mock factories.
const { holder, mockGetPassword } = vi.hoisted(() => ({
  // LEXWARE_API_BASE has no env override (src/constants.ts:1), so the only way
  // to redirect createClient() at a real socket is a mocked getter the test
  // fills in once the ephemeral server port is known.
  holder: { base: '' },
  mockGetPassword: vi.fn<(signal?: AbortSignal) => Promise<string | undefined>>().mockResolvedValue(undefined),
}));

// A getter, not a snapshotted value, so it is read fresh on every createClient()
// call regardless of when this factory itself ran relative to beforeAll below.
vi.mock('../constants.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../constants.js')>();
  return {
    ...actual,
    get LEXWARE_API_BASE() {
      return holder.base;
    },
  };
});

// Without this, resolveToken() reads the real OS keyring first and would either
// send a developer's real token to the local mock server or block for
// KEYRING_TIMEOUT_MS on a locked store. Mirrors lexware-client.test.ts:13-19.
vi.mock('@napi-rs/keyring', () => ({
  AsyncEntry: vi.fn(function () { return { getPassword: mockGetPassword }; } as any),
}));

interface RecordedRequest {
  method: string;
  url: string;
  headers: http.IncomingHttpHeaders;
  body: Buffer;
}

interface ParsedPart {
  name: string;
  filename?: string;
  contentType?: string;
  body: Buffer;
}

// Extracts the `boundary` parameter from a `multipart/form-data; boundary=…`
// Content-Type header. Never hardcode the boundary value itself — axios mints a
// fresh one per attempt (§0.2 of the plan; node_modules/axios/lib/helpers/
// formDataToStream.js:72-73).
function extractBoundary(contentType: string): string {
  const match = /boundary=([^;]+)/i.exec(contentType);
  if (!match) throw new Error(`content-type carries no boundary: ${contentType}`);
  return match[1];
}

// The named comparison D5 assertion 6 requires in place of a wholesale header
// comparison: the media type with the (legitimately per-attempt-different)
// boundary parameter stripped.
function stripBoundaryParam(contentType: string): string {
  return contentType.split(';')[0].trim();
}

// Minimal RFC 2046 multipart/form-data parser, scoped to exactly what axios's
// formDataToStream emits: `--{boundary}\r\n` + per-part headers ending in a
// blank line + raw content bytes + `\r\n`, repeated per part, then a
// terminating `--{boundary}--\r\n` (node_modules/axios/lib/helpers/
// formDataToStream.js:83-114). Not a general-purpose parser — just enough to
// prove the wire body is well-formed and to compare it across attempts.
function parseMultipart(body: Buffer, boundary: string): ParsedPart[] {
  const marker = Buffer.from(`--${boundary}`);
  const positions: number[] = [];
  let idx = body.indexOf(marker);
  while (idx !== -1) {
    positions.push(idx);
    idx = body.indexOf(marker, idx + marker.length);
  }
  const parts: ParsedPart[] = [];
  for (let i = 0; i < positions.length - 1; i++) {
    // Between this marker and the next: "\r\n" (boundaryBytes' own CRLF) +
    // headers (ending in a blank line) + content + "\r\n" (the part's trailing
    // CRLF_BYTES), immediately followed by the next marker (or the footer).
    const chunk = body.subarray(positions[i] + marker.length + 2, positions[i + 1] - 2);
    const headerEnd = chunk.indexOf('\r\n\r\n');
    const headerBlock = chunk.subarray(0, headerEnd).toString('latin1');
    const content = chunk.subarray(headerEnd + 4);
    const dispositionMatch = /name="([^"]*)"(?:; filename="([^"]*)")?/.exec(headerBlock);
    const contentTypeMatch = /Content-Type:\s*([^\r\n]*)/i.exec(headerBlock);
    parts.push({
      name: dispositionMatch?.[1] ?? '',
      filename: dispositionMatch?.[2],
      contentType: contentTypeMatch?.[1],
      body: Buffer.from(content),
    });
  }
  return parts;
}

// Byte-exact comparison shape for `toEqual` — avoids relying on the test
// runner's typed-array deep-equality for a Buffer nested inside a plain object,
// and sorted by name so part order is not incidentally asserted.
function normalizeParts(parts: ParsedPart[]) {
  return parts
    .map((p) => ({ name: p.name, filename: p.filename, contentType: p.contentType, body: p.body.toString('latin1') }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

describe('lexware upload 429 retry — real HTTP stack (#89)', () => {
  const TEST_TOKEN = 'retry-http-test-token';
  const originalEnv = process.env.LEXWARE_API_TOKEN;

  let server: http.Server;
  let requestCount = 0;
  const receivedRequests: RecordedRequest[] = [];

  beforeAll(async () => {
    // Mock server contract (D5): first request -> 429 + retry-after: 0, second
    // -> 200 + JSON. parseRetryAfterMs('0') === 0 (src/services/lexware.ts:143-148),
    // so no fake timers and no timing window are needed anywhere in this file.
    server = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', () => {
        receivedRequests.push({
          method: req.method ?? '',
          url: req.url ?? '',
          headers: req.headers,
          body: Buffer.concat(chunks),
        });
        requestCount += 1;
        if (requestCount === 1) {
          res.writeHead(429, { 'retry-after': '0', 'content-type': 'application/json' });
          res.end(JSON.stringify({}));
        } else {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ id: 'file-123' }));
        }
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (address === null || typeof address === 'string') {
      throw new Error('expected server to bind an ephemeral AddressInfo port');
    }
    // D5 point 1: the /v1 suffix is mandatory, not decoration. The real constant
    // is 'https://api.lexware.io/v1'; axios joins baseURL with the '/files' path
    // via combineURLs, so dropping /v1 here would put /files on the wire and
    // assertion 1's url === '/v1/files' would fail against a correct retry
    // implementation. The mock server does no routing, so nothing else would hint
    // at the mistake.
    holder.base = `http://127.0.0.1:${address.port}/v1`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    if (originalEnv !== undefined) {
      process.env.LEXWARE_API_TOKEN = originalEnv;
    } else {
      delete process.env.LEXWARE_API_TOKEN;
    }
  });

  beforeEach(() => {
    // Reset alone is insufficient — Vitest cannot re-evaluate top-level imports,
    // so a static import would retain all three of lexware.ts's module-scoped
    // caches (tokenPromise, clientPromise, webhookKeyCache). Dynamic import
    // after reset, inside the test below, is the existing repo pattern.
    vi.resetModules();
    requestCount = 0;
    receivedRequests.length = 0;
    process.env.LEXWARE_API_TOKEN = TEST_TOKEN;
    mockGetPassword.mockReset().mockResolvedValue(undefined);
  });

  it('retries a 429\'d file upload over a real socket and replays a complete, correctly-framed multipart body', async () => {
    const { lexwareUpload } = await import('../services/lexware.js');
    const fileContent = Buffer.from('%PDF-1.4\n%fixture content for issue #89 retry test\n');

    const result = await lexwareUpload('/files', fileContent, 'report.pdf', 'application/pdf', 'voucher');

    // Assertion 5: exactly 2 requests reach the server. isStreamBody
    // (src/services/lexware.ts:157) is module-private and intentionally not
    // exported for a test's convenience — a second request arriving at all IS
    // the proof the interceptor took the retry branch rather than the
    // isStreamBody bail-out (:185), which rejects without re-requesting.
    expect(receivedRequests).toHaveLength(2);
    const [attempt1, attempt2] = receivedRequests;

    for (const attempt of [attempt1, attempt2]) {
      // Assertion 1: request line and credentials, asserted on BOTH attempts —
      // a retry that replays a perfect body to the wrong path/method, or drops
      // the bearer token, is invisible to every body-level assertion below.
      expect(attempt.method).toBe('POST');
      expect(attempt.url).toBe('/v1/files');
      expect(attempt.headers.authorization).toBe(`Bearer ${TEST_TOKEN}`);

      // Assertion 4: content-length equals that attempt's OWN received bytes.
      expect(Number(attempt.headers['content-length'])).toBe(attempt.body.length);

      // Assertion 2: content-type carries boundary=B, and the body is framed by
      // that same B — starts with "--B\r\n", ends with "--B--\r\n". Catches a
      // stale header boundary and a dropped footer.
      const boundary = extractBoundary(attempt.headers['content-type'] as string);
      const bodyStr = attempt.body.toString('latin1');
      expect(bodyStr.startsWith(`--${boundary}\r\n`)).toBe(true);
      expect(bodyStr.endsWith(`--${boundary}--\r\n`)).toBe(true);
    }

    // Assertion 3: each attempt's body parses into exactly the expected parts.
    const parts1 = parseMultipart(attempt1.body, extractBoundary(attempt1.headers['content-type'] as string));
    const parts2 = parseMultipart(attempt2.body, extractBoundary(attempt2.headers['content-type'] as string));

    for (const parts of [parts1, parts2]) {
      expect(parts).toHaveLength(2);
      const filePart = parts.find((p) => p.name === 'file');
      const typePart = parts.find((p) => p.name === 'type');
      expect(filePart?.filename).toBe('report.pdf');
      expect(filePart?.contentType).toBe('application/pdf');
      expect(filePart?.body.equals(fileContent)).toBe(true);
      expect(typePart?.body.toString('latin1')).toBe('voucher');
    }

    // Assertion 6: across attempts, the parsed structures are equal, and the
    // named headers that must agree do. Deliberately NOT asserted: raw body
    // byte equality, that the boundaries differ, that the bodies have equal
    // length, or a wholesale header-object comparison — §0.2 measured axios
    // minting a fresh boundary (and therefore a different Content-Type) on
    // every attempt, so any of those would either be false or would merely pin
    // today's axios internals rather than correctness.
    expect(normalizeParts(parts1)).toEqual(normalizeParts(parts2));
    expect(attempt1.headers.authorization).toBe(attempt2.headers.authorization);
    expect(stripBoundaryParam(attempt1.headers['content-type'] as string)).toBe(
      stripBoundaryParam(attempt2.headers['content-type'] as string)
    );
    expect(stripBoundaryParam(attempt1.headers['content-type'] as string)).toBe('multipart/form-data');

    // Assertion 7: the call resolves with the 200 payload.
    expect(result).toEqual({ id: 'file-123' });
  });
});
