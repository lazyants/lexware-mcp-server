import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import util from 'node:util';
import { AxiosError, AxiosHeaders } from 'axios';

// GOTCHA: vi.mock is hoisted above top-level const declarations. Use vi.hoisted()
// to create mock fns that are accessible inside the vi.mock factory.
const { mockRequest, mockCreate, mockGetPassword } = vi.hoisted(() => ({
  mockRequest: vi.fn(),
  mockCreate: vi.fn(),
  mockGetPassword: vi.fn<(signal?: AbortSignal) => Promise<string | undefined>>().mockResolvedValue(undefined),
}));

// GOTCHA: AsyncEntry is called with `new`, so the implementation must be a
// regular function (not an arrow function), otherwise JS throws "not a
// constructor". getPassword() is async (real AsyncEntry.getPassword returns
// Promise<string | undefined>) so it can be bounded by an AbortSignal timeout.
vi.mock('@napi-rs/keyring', () => ({
  AsyncEntry: vi.fn(function () { return { getPassword: mockGetPassword }; } as any),
}));

// GOTCHA: Must use importOriginal to preserve AxiosError class — a plain mock
// factory that only returns { default: ... } drops all named exports.
vi.mock('axios', async (importOriginal) => {
  const actual = await importOriginal<typeof import('axios')>();
  const mockInstance = {
    request: mockRequest,
    interceptors: {
      response: { use: vi.fn() },
    },
  };
  mockCreate.mockReturnValue(mockInstance);
  return {
    ...actual,
    default: {
      ...actual.default,
      create: mockCreate,
    },
  };
});

describe('lexware client', () => {
  const originalEnv = process.env.LEXWARE_API_TOKEN;
  const originalKeyringService = process.env.LEXWARE_KEYRING_SERVICE;

  beforeEach(() => {
    vi.resetModules();
    process.env.LEXWARE_API_TOKEN = 'test-token';
    delete process.env.LEXWARE_KEYRING_SERVICE;
    mockRequest.mockReset();
    mockCreate.mockClear();
    mockGetPassword.mockResolvedValue(undefined);
    const mockInstance = {
      request: mockRequest,
      interceptors: { response: { use: vi.fn() } },
    };
    mockCreate.mockReturnValue(mockInstance);
  });

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.LEXWARE_API_TOKEN = originalEnv;
    } else {
      delete process.env.LEXWARE_API_TOKEN;
    }
    if (originalKeyringService !== undefined) {
      process.env.LEXWARE_KEYRING_SERVICE = originalKeyringService;
    } else {
      delete process.env.LEXWARE_KEYRING_SERVICE;
    }
  });

  it('throws when LEXWARE_API_TOKEN is missing and keyring returns null', async () => {
    delete process.env.LEXWARE_API_TOKEN;
    const { lexwareRequest } = await import('../services/lexware.js');
    await expect(lexwareRequest('GET', '/profile')).rejects.toThrow('LEXWARE_API_TOKEN');
  });

  it('recovers after a fixable token miss without restarting (no cached rejection)', async () => {
    delete process.env.LEXWARE_API_TOKEN;
    const { lexwareRequest } = await import('../services/lexware.js');
    // First call: token missing everywhere → rejects.
    await expect(lexwareRequest('GET', '/profile')).rejects.toThrow('LEXWARE_API_TOKEN');
    // User stores the token after the first failure; a later call must succeed
    // rather than replay the cached rejection.
    process.env.LEXWARE_API_TOKEN = 'recovered-token';
    mockRequest.mockResolvedValue({ data: { ok: true } });
    await expect(lexwareRequest('GET', '/profile')).resolves.toEqual({ ok: true });
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer recovered-token' }),
      })
    );
  });

  it('uses keyring token when available, ignoring env var', async () => {
    mockGetPassword.mockResolvedValue('keyring-token');
    mockRequest.mockResolvedValue({ data: { ok: true } });
    const { lexwareRequest } = await import('../services/lexware.js');
    await lexwareRequest('GET', '/profile');
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer keyring-token' }),
      })
    );
  });

  it('uses LEXWARE_KEYRING_SERVICE as keyring service name', async () => {
    const { AsyncEntry } = await import('@napi-rs/keyring');
    process.env.LEXWARE_KEYRING_SERVICE = 'my-company';
    mockGetPassword.mockResolvedValue('company-token');
    mockRequest.mockResolvedValue({ data: {} });
    const { lexwareRequest } = await import('../services/lexware.js');
    await lexwareRequest('GET', '/profile');
    expect(AsyncEntry).toHaveBeenCalledWith('my-company', 'api-token');
  });

  it('passes an AbortSignal timeout to the keyring getPassword call', async () => {
    mockGetPassword.mockResolvedValue('keyring-token');
    mockRequest.mockResolvedValue({ data: { ok: true } });
    const { lexwareRequest } = await import('../services/lexware.js');
    await lexwareRequest('GET', '/profile');
    expect(mockGetPassword).toHaveBeenCalledWith(expect.any(AbortSignal));
  });

  it('falls back to LEXWARE_API_TOKEN when the keyring getPassword call times out', async () => {
    // Simulate AsyncEntry rejecting once its AbortSignal fires, without
    // waiting out the real KEYRING_TIMEOUT_MS in this test.
    mockGetPassword.mockRejectedValue(new Error('The operation was aborted'));
    process.env.LEXWARE_API_TOKEN = 'env-fallback-token';
    mockRequest.mockResolvedValue({ data: { ok: true } });
    const { lexwareRequest } = await import('../services/lexware.js');
    await lexwareRequest('GET', '/profile');
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer env-fallback-token' }),
      })
    );
  });

  it('falls back to LEXWARE_API_TOKEN when the keyring module throws (headless)', async () => {
    const { AsyncEntry } = await import('@napi-rs/keyring');
    (AsyncEntry as unknown as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
      throw new Error('keyring unavailable: no libsecret');
    });
    process.env.LEXWARE_API_TOKEN = 'env-fallback-token';
    mockRequest.mockResolvedValue({ data: { ok: true } });
    const { lexwareRequest } = await import('../services/lexware.js');
    await lexwareRequest('GET', '/profile');
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer env-fallback-token' }),
      })
    );
  });

  it('missing-token error links to the lexware.de token page, never lexware.io, and leaks no secret', async () => {
    delete process.env.LEXWARE_API_TOKEN;
    const { lexwareRequest } = await import('../services/lexware.js');
    const message = await lexwareRequest('GET', '/profile').then(
      () => '',
      (err: unknown) => (err as Error).message,
    );
    expect(message).toContain('https://app.lexware.de/addons/public-api');
    expect(message).not.toContain('lexware.io');
    // The env token is deleted above and the message never echoes envValue
    // regardless — assert defensively that no token-shaped value leaks.
    expect(message).not.toContain('test-token');
  });

  it('redacts the Authorization header from a failed request error cause (no token leak when the error is logged)', async () => {
    mockRequest.mockImplementation(() => {
      const err = new AxiosError('boom');
      // Real axios shares one config object between err.config and err.response.config.
      const config = {
        headers: { Authorization: 'Bearer test-token', authorization: 'Bearer test-token' },
      } as never;
      err.config = config;
      err.response = {
        status: 500,
        statusText: 'Server Error',
        data: {},
        headers: {},
        config,
      } as never;
      return Promise.reject(err);
    });
    const { lexwareRequest } = await import('../services/lexware.js');
    const caught = await lexwareRequest('GET', '/profile').then(
      () => null,
      (e: unknown) => e as Error & { cause?: unknown },
    );
    expect(caught).toBeInstanceOf(Error);
    const causeHeaders = (caught?.cause as AxiosError | undefined)?.config?.headers as
      | Record<string, unknown>
      | undefined;
    expect(causeHeaders?.Authorization).toBeUndefined();
    expect(causeHeaders?.authorization).toBeUndefined();
    // The real leak vector: a logger walking the whole error object (util.inspect /
    // JSON.stringify / a structured logger) must not surface the bearer token.
    const { inspect } = await import('node:util');
    expect(inspect(caught, { depth: null })).not.toContain('test-token');
  });

  it('drops the Node ClientRequest so the token cannot leak via request._header when the error is logged', async () => {
    // Node's ClientRequest keeps the raw header block verbatim, including the
    // bearer token, on err.request._header and err.response.request._header.
    // Scrubbing config.headers alone misses it; a structured logger walking the
    // whole error (util.inspect/JSON) would otherwise surface the token.
    const rawHeaderBlock =
      'GET /profile HTTP/1.1\r\nAuthorization: Bearer test-token\r\nAccept: application/json\r\n\r\n';
    mockRequest.mockImplementation(() => {
      const err = new AxiosError('boom');
      const config = {
        headers: { Authorization: 'Bearer test-token', authorization: 'Bearer test-token' },
      } as never;
      const request = { _header: rawHeaderBlock } as never;
      err.config = config;
      err.request = request;
      err.response = {
        status: 500,
        statusText: 'Server Error',
        data: {},
        headers: {},
        config,
        request,
      } as never;
      return Promise.reject(err);
    });
    const { lexwareRequest } = await import('../services/lexware.js');
    const caught = await lexwareRequest('GET', '/profile').then(
      () => null,
      (e: unknown) => e as Error & { cause?: AxiosError },
    );
    expect(caught).toBeInstanceOf(Error);
    const { inspect } = await import('node:util');
    // No vector may surface the token: config.headers, err.request._header, or
    // err.response.request._header.
    expect(inspect(caught, { depth: null })).not.toContain('test-token');
    // The ClientRequest references are gone entirely.
    expect(caught?.cause?.request).toBeUndefined();
    expect(caught?.cause?.response?.request).toBeUndefined();
  });

  it('sanitizes upload errors so the bearer token never leaks when logged', async () => {
    const rawHeaderBlock =
      'POST /files HTTP/1.1\r\nAuthorization: Bearer test-token\r\n\r\n';
    mockRequest.mockImplementation(() => {
      const err = new AxiosError('upload boom');
      const config = { headers: { Authorization: 'Bearer test-token' } } as never;
      const request = { _header: rawHeaderBlock } as never;
      err.config = config;
      err.request = request;
      err.response = { status: 500, statusText: 'Server Error', data: {}, headers: {}, config, request } as never;
      return Promise.reject(err);
    });
    const { lexwareUpload } = await import('../services/lexware.js');
    const caught = await lexwareUpload('/files', Buffer.from('x'), 'x.pdf', 'application/pdf').then(
      () => null,
      (e: unknown) => e as Error,
    );
    expect(caught).toBeInstanceOf(Error);
    const { inspect } = await import('node:util');
    expect(inspect(caught, { depth: null })).not.toContain('test-token');
  });

  it('sanitizes download errors so the bearer token never leaks when logged', async () => {
    const rawHeaderBlock =
      'GET /files/abc HTTP/1.1\r\nAuthorization: Bearer test-token\r\n\r\n';
    mockRequest.mockImplementation(() => {
      const err = new AxiosError('download boom');
      const config = { headers: { Authorization: 'Bearer test-token' } } as never;
      const request = { _header: rawHeaderBlock } as never;
      err.config = config;
      err.request = request;
      err.response = { status: 500, statusText: 'Server Error', data: {}, headers: {}, config, request } as never;
      return Promise.reject(err);
    });
    const { lexwareDownload } = await import('../services/lexware.js');
    const caught = await lexwareDownload('/files/abc').then(
      () => null,
      (e: unknown) => e as Error,
    );
    expect(caught).toBeInstanceOf(Error);
    const { inspect } = await import('node:util');
    expect(inspect(caught, { depth: null })).not.toContain('test-token');
  });

  it('creates client with correct base URL and auth header', async () => {
    mockRequest.mockResolvedValue({ data: { ok: true } });
    const { lexwareRequest } = await import('../services/lexware.js');
    await lexwareRequest('GET', '/profile');
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        baseURL: 'https://api.lexware.io/v1',
        headers: expect.objectContaining({
          Authorization: 'Bearer test-token',
        }),
      })
    );
  });

  it('makes GET request with correct path', async () => {
    mockRequest.mockResolvedValue({ data: { id: '123' } });
    const { lexwareRequest } = await import('../services/lexware.js');
    const result = await lexwareRequest('GET', '/contacts/abc-123');
    expect(mockRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'GET',
        url: '/contacts/abc-123',
      })
    );
    expect(result).toEqual({ id: '123' });
  });

  it('makes POST request with data', async () => {
    mockRequest.mockResolvedValue({ data: { id: 'new-id' } });
    const { lexwareRequest } = await import('../services/lexware.js');
    const body = { name: 'Test Article' };
    await lexwareRequest('POST', '/articles', body);
    expect(mockRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'POST',
        url: '/articles',
        data: body,
      })
    );
  });

  it('strips undefined params', async () => {
    mockRequest.mockResolvedValue({ data: [] });
    const { lexwareRequest } = await import('../services/lexware.js');
    await lexwareRequest('GET', '/contacts', undefined, { page: 0, size: undefined, name: 'test' });
    expect(mockRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        params: { page: 0, name: 'test' },
      })
    );
  });

  it('handles standard error format', async () => {
    const axiosError = new AxiosError('Bad Request');
    axiosError.response = {
      status: 400,
      statusText: 'Bad Request',
      data: { status: 400, error: 'Bad Request', message: 'Invalid invoice data', path: '/invoices', timestamp: '', traceId: '' },
      headers: {},
      config: {} as never,
    };
    mockRequest.mockRejectedValue(axiosError);
    const { lexwareRequest } = await import('../services/lexware.js');
    await expect(lexwareRequest('POST', '/invoices', {})).rejects.toThrow('Lexware API [400]: Invalid invoice data');
  });

  it('handles legacy IssueList error format', async () => {
    const axiosError = new AxiosError('Unprocessable');
    axiosError.response = {
      status: 422,
      statusText: 'Unprocessable Entity',
      data: { IssueList: [{ i18nKey: 'missing_field', source: 'company.name', type: 'validation_failure' }] },
      headers: {},
      config: {} as never,
    };
    mockRequest.mockRejectedValue(axiosError);
    const { lexwareRequest } = await import('../services/lexware.js');
    await expect(lexwareRequest('POST', '/contacts', {})).rejects.toThrow('Lexware API validation error');
  });

  it('handles network errors', async () => {
    const axiosError = new AxiosError('timeout');
    axiosError.code = 'ECONNABORTED';
    mockRequest.mockRejectedValue(axiosError);
    const { lexwareRequest } = await import('../services/lexware.js');
    await expect(lexwareRequest('GET', '/profile')).rejects.toThrow('Network error');
  });

  describe('lexwareDownload', () => {
    it('returns Buffer data with contentType and parsed fileName', async () => {
      mockRequest.mockResolvedValue({
        data: new ArrayBuffer(4),
        headers: {
          'content-type': 'application/pdf',
          'content-disposition': 'attachment; filename="invoice.pdf"',
        },
      });
      const { lexwareDownload } = await import('../services/lexware.js');
      const result = await lexwareDownload('/invoices/abc/file');
      expect(mockRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'GET',
          url: '/invoices/abc/file',
          responseType: 'arraybuffer',
          headers: { Accept: 'application/pdf' },
        })
      );
      expect(Buffer.isBuffer(result.data)).toBe(true);
      expect(result.contentType).toBe('application/pdf');
      expect(result.fileName).toBe('invoice.pdf');
    });

    it('falls back to undefined fileName when content-disposition is missing', async () => {
      mockRequest.mockResolvedValue({
        data: new ArrayBuffer(4),
        headers: {
          'content-type': 'application/pdf',
        },
      });
      const { lexwareDownload } = await import('../services/lexware.js');
      const result = await lexwareDownload('/dunnings/xyz/file');
      expect(result.fileName).toBeUndefined();
      expect(result.contentType).toBe('application/pdf');
    });

    it('defaults contentType to application/octet-stream when missing', async () => {
      mockRequest.mockResolvedValue({
        data: new ArrayBuffer(4),
        headers: {},
      });
      const { lexwareDownload } = await import('../services/lexware.js');
      const result = await lexwareDownload('/files/abc');
      expect(result.contentType).toBe('application/octet-stream');
    });

    it('sends Accept: application/pdf by default (byte-for-byte legacy behaviour)', async () => {
      mockRequest.mockResolvedValue({ data: new ArrayBuffer(4), headers: {} });
      const { lexwareDownload } = await import('../services/lexware.js');
      await lexwareDownload('/invoices/abc/file');
      expect(mockRequest).toHaveBeenCalledWith(
        expect.objectContaining({ headers: { Accept: 'application/pdf' } }),
      );
    });

    it('sends Accept: application/xml when explicitly passed', async () => {
      mockRequest.mockResolvedValue({ data: new ArrayBuffer(4), headers: {} });
      const { lexwareDownload } = await import('../services/lexware.js');
      await lexwareDownload('/invoices/abc/file', 'application/xml');
      expect(mockRequest).toHaveBeenCalledWith(
        expect.objectContaining({ headers: { Accept: 'application/xml' } }),
      );
    });
  });

  describe('lexwareUpload', () => {
    it('sends POST with a spec-compliant (replayable) FormData body and returns response data', async () => {
      mockRequest.mockResolvedValue({ data: { id: 'file-123' } });
      const { lexwareUpload } = await import('../services/lexware.js');
      const fileBuffer = Buffer.from('test-content');
      const result = await lexwareUpload('/files', fileBuffer, 'test.pdf', 'application/pdf');
      expect(mockRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'POST',
          url: '/files',
        })
      );
      // Verify a native (not `form-data`-package) FormData was sent as data.
      const callArgs = mockRequest.mock.calls[0][0];
      expect(callArgs.data).toBeInstanceOf(FormData);
      const filePart = callArgs.data.get('file') as File;
      expect(filePart.name).toBe('test.pdf');
      expect(filePart.type).toBe('application/pdf');
      expect(await filePart.text()).toBe('test-content');
      expect(result).toEqual({ id: 'file-123' });
    });

    it('sets Content-Type: multipart/form-data explicitly and keeps the body a replayable FormData', async () => {
      mockRequest.mockResolvedValue({ data: { id: 'file-456' } });
      const { lexwareUpload } = await import('../services/lexware.js');
      await lexwareUpload('/files', Buffer.from('data'), 'doc.pdf', 'application/pdf');
      const callArgs = mockRequest.mock.calls[0][0];
      expect(callArgs.headers).toEqual(
        expect.objectContaining({
          Authorization: 'Bearer test-token',
        })
      );
      // The client default is `application/json`; without this explicit override
      // axios's transformRequest would JSON-stringify the form and drop the file bytes.
      expect(callArgs.headers['Content-Type']).toBe('multipart/form-data');
      // Native FormData has no .pipe — the one-shot-stream retry guard (isStreamBody)
      // must not match it.
      expect(callArgs.data).toBeInstanceOf(FormData);
      expect(typeof (callArgs.data as { pipe?: unknown }).pipe).toBe('undefined');
    });

    // Regression-catcher for #58: POST /v1/files 400s without a `type` form part.
    it('adds a `type` form part when uploadType is passed', async () => {
      mockRequest.mockResolvedValue({ data: { id: 'file-789' } });
      const { lexwareUpload } = await import('../services/lexware.js');
      await lexwareUpload('/files', Buffer.from('data'), 'doc.pdf', 'application/pdf', 'voucher');
      const callArgs = mockRequest.mock.calls[0][0];
      expect(callArgs.data.get('type')).toBe('voucher');
    });

    // Narrowness guard: /vouchers/{id}/files must NOT get a `type` part.
    it('omits the `type` form part when uploadType is not passed', async () => {
      mockRequest.mockResolvedValue({ data: { id: 'file-999' } });
      const { lexwareUpload } = await import('../services/lexware.js');
      await lexwareUpload('/vouchers/abc/files', Buffer.from('data'), 'doc.pdf', 'application/pdf');
      const callArgs = mockRequest.mock.calls[0][0];
      expect(callArgs.data.get('type')).toBeNull();
    });
  });

  // Locks the intentional behaviour change from #51: lexwareUpload/lexwareDownload
  // used to throw the raw AxiosError (token-bearing). They now route through
  // wrapLexwareError, so they throw a formatted, token-free Error.
  describe('upload/download error redaction (#51)', () => {
    const TOKEN = 'sk-leaky-bearer-DO-NOT-LEAK-9f3a';

    function tokenBearingError(data: unknown, statusText = 'Bad Request'): AxiosError {
      const err = new AxiosError('Request failed with status code 400');
      const config = {
        headers: new AxiosHeaders({ Authorization: `Bearer ${TOKEN}` }),
        auth: { username: 'u', password: TOKEN },
      } as unknown as AxiosError['config'];
      err.config = config;
      (err as { request?: unknown }).request = {
        _header: `POST /v1/files HTTP/1.1\r\nAuthorization: Bearer ${TOKEN}\r\n\r\n`,
      };
      err.response = {
        status: 400,
        statusText,
        data,
        headers: {},
        config,
        request: {
          _header: `POST /v1/files HTTP/1.1\r\nAuthorization: Bearer ${TOKEN}\r\n\r\n`,
        },
      } as unknown as AxiosError['response'];
      return err;
    }

    it('lexwareUpload routes a token-bearing AxiosError through the sanitizer', async () => {
      mockRequest.mockRejectedValue(
        tokenBearingError({ message: 'Bad upload', status: 400 }),
      );
      const { lexwareUpload } = await import('../services/lexware.js');
      const thrown = await lexwareUpload('/files', Buffer.from('x'), 'a.pdf', 'application/pdf').then(
        () => { throw new Error('expected rejection'); },
        (err: unknown) => err,
      );
      expect((thrown as Error).message).toContain('Lexware API [400]');
      expect(util.inspect(thrown, { depth: null })).not.toContain(TOKEN);
    });

    it('lexwareDownload routes a non-JSON error body through the generic formatter', async () => {
      // arraybuffer response → body is not a JSON object with message/IssueList,
      // so formatError falls through to the generic "Lexware API error:" branch.
      mockRequest.mockRejectedValue(
        tokenBearingError(new ArrayBuffer(8), 'Bad Request'),
      );
      const { lexwareDownload } = await import('../services/lexware.js');
      const thrown = await lexwareDownload('/invoices/abc/file').then(
        () => { throw new Error('expected rejection'); },
        (err: unknown) => err,
      );
      expect((thrown as Error).message).toMatch(/Lexware API error:/);
      expect(util.inspect(thrown, { depth: null })).not.toContain(TOKEN);
    });

    // An all-zero arraybuffer decodes to NUL runs, which trim() does not strip.
    it('lexwareDownload does not splice control bytes from a binary body into the message', async () => {
      mockRequest.mockRejectedValue(tokenBearingError(new ArrayBuffer(8), 'Bad Request'));
      const { lexwareDownload } = await import('../services/lexware.js');
      const thrown = await lexwareDownload('/invoices/abc/file').then(
        () => { throw new Error('expected rejection'); },
        (err: unknown) => err,
      );
      expect((thrown as Error).message).toBe('Lexware API error: 400 Bad Request');
    });

    it('appends an unrecognized error body so the cause is not silently dropped', async () => {
      // The real shape behind this: POST /files without the multipart `type` part
      // returns 400 with neither `message` nor `IssueList`, and `source` is the only
      // field naming the problem.
      const body = {
        i18nKey: 'bad_request_error',
        source: "Required request parameter 'type' for method parameter type String is not present",
      };
      mockRequest.mockRejectedValue(tokenBearingError(body, 'Bad Request'));
      const { lexwareUpload } = await import('../services/lexware.js');
      const thrown = await lexwareUpload('/files', Buffer.from('x'), 'a.pdf', 'application/pdf').then(
        () => { throw new Error('expected rejection'); },
        (err: unknown) => err,
      );
      expect((thrown as Error).message).toContain('Lexware API error: 400 Bad Request');
      expect((thrown as Error).message).toContain("Required request parameter 'type'");
      // The body is the RESPONSE payload — appending it must not reintroduce the
      // bearer token that sanitizeAxiosError strips from the chained cause.
      expect(util.inspect(thrown, { depth: null })).not.toContain(TOKEN);
    });

    it('truncates an oversized error body instead of inlining the whole payload', async () => {
      mockRequest.mockRejectedValue(tokenBearingError('x'.repeat(5000), 'Bad Gateway'));
      const { lexwareRequest } = await import('../services/lexware.js');
      const thrown = await lexwareRequest('GET', '/invoices').then(
        () => { throw new Error('expected rejection'); },
        (err: unknown) => err,
      );
      const { message } = thrown as Error;
      expect(message).toContain('…');
      expect(message.length).toBeLessThan(700);
    });
  });
});
