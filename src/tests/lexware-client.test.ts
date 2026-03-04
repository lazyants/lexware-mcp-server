import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AxiosError } from 'axios';

// GOTCHA: vi.mock is hoisted above top-level const declarations. Use vi.hoisted()
// to create mock fns that are accessible inside the vi.mock factory.
const { mockRequest, mockCreate } = vi.hoisted(() => ({
  mockRequest: vi.fn(),
  mockCreate: vi.fn(),
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

  beforeEach(() => {
    vi.resetModules();
    process.env.LEXWARE_API_TOKEN = 'test-token';
    mockRequest.mockReset();
    mockCreate.mockClear();
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
  });

  it('throws when LEXWARE_API_TOKEN is missing', async () => {
    delete process.env.LEXWARE_API_TOKEN;
    const { lexwareRequest } = await import('../services/lexware.js');
    await expect(lexwareRequest('GET', '/profile')).rejects.toThrow('LEXWARE_API_TOKEN');
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
});
