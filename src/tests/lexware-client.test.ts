import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import util from 'node:util';
import { AxiosError, AxiosHeaders } from 'axios';

// GOTCHA: vi.mock is hoisted above top-level const declarations. Use vi.hoisted()
// to create mock fns that are accessible inside the vi.mock factory.
const { mockRequest, mockCreate, mockGetPassword } = vi.hoisted(() => ({
  mockRequest: vi.fn(),
  mockCreate: vi.fn(),
  mockGetPassword: vi.fn<() => string | null>().mockReturnValue(null),
}));

// GOTCHA: Entry is called with `new`, so the implementation must be a regular
// function (not an arrow function), otherwise JS throws "not a constructor".
vi.mock('@napi-rs/keyring', () => ({
  Entry: vi.fn(function () { return { getPassword: mockGetPassword }; } as any),
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
    mockGetPassword.mockReturnValue(null);
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

  it('missing-token error links to the lexware.de token page, never lexware.io', async () => {
    delete process.env.LEXWARE_API_TOKEN;
    const { lexwareRequest } = await import('../services/lexware.js');
    const message = await lexwareRequest('GET', '/profile').then(
      () => '',
      (err: unknown) => (err as Error).message,
    );
    expect(message).toContain('https://app.lexware.de/addons/public-api');
    expect(message).not.toContain('lexware.io');
  });

  it('uses keyring token when available, ignoring env var', async () => {
    mockGetPassword.mockReturnValue('keyring-token');
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
    const { Entry } = await import('@napi-rs/keyring');
    process.env.LEXWARE_KEYRING_SERVICE = 'my-company';
    mockGetPassword.mockReturnValue('company-token');
    mockRequest.mockResolvedValue({ data: {} });
    const { lexwareRequest } = await import('../services/lexware.js');
    await lexwareRequest('GET', '/profile');
    expect(Entry).toHaveBeenCalledWith('my-company', 'api-token');
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
    it('sends POST with FormData body and returns response data', async () => {
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
      // Verify FormData was sent as data
      const callArgs = mockRequest.mock.calls[0][0];
      expect(callArgs.data).toBeDefined();
      expect(typeof callArgs.data.getHeaders).toBe('function');
      expect(result).toEqual({ id: 'file-123' });
    });

    it('includes correct headers from FormData', async () => {
      mockRequest.mockResolvedValue({ data: { id: 'file-456' } });
      const { lexwareUpload } = await import('../services/lexware.js');
      await lexwareUpload('/files', Buffer.from('data'), 'doc.pdf', 'application/pdf');
      const callArgs = mockRequest.mock.calls[0][0];
      expect(callArgs.headers).toEqual(
        expect.objectContaining({
          Authorization: 'Bearer test-token',
        })
      );
      // FormData headers include content-type with boundary
      expect(callArgs.headers['content-type']).toMatch(/multipart\/form-data/);
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
  });
});
