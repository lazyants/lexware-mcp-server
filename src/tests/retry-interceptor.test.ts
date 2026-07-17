import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AxiosError } from 'axios';

// GOTCHA: vi.mock is hoisted above top-level const declarations. Use vi.hoisted()
// to create mock fns that are accessible inside the vi.mock factory.
const { mockRequest, mockCreate, mockUse } = vi.hoisted(() => ({
  mockRequest: vi.fn(),
  mockCreate: vi.fn(),
  mockUse: vi.fn(),
}));

// Unlike lexware-client.test.ts (which stubs interceptors.response.use as a no-op
// so the 429 handler never runs), this file CAPTURES the rejection handler passed
// to use() and invokes it directly, to exercise the retry-vs-reject branch itself.
vi.mock('axios', async (importOriginal) => {
  const actual = await importOriginal<typeof import('axios')>();
  const mockInstance = {
    request: mockRequest,
    interceptors: {
      response: { use: mockUse },
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

type RejectedHandler = (error: AxiosError) => Promise<unknown>;

describe('lexware client 429 retry interceptor', () => {
  const originalEnv = process.env.LEXWARE_API_TOKEN;

  beforeEach(() => {
    vi.resetModules();
    process.env.LEXWARE_API_TOKEN = 'test-token';
    mockRequest.mockReset();
    mockCreate.mockClear();
    mockUse.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
    if (originalEnv !== undefined) {
      process.env.LEXWARE_API_TOKEN = originalEnv;
    } else {
      delete process.env.LEXWARE_API_TOKEN;
    }
  });

  // Priming call forces getClient() -> createClient() -> interceptors.response.use(...)
  // so we can pull the rejection handler out of mockUse's recorded call args.
  async function getRejectedHandler(): Promise<RejectedHandler> {
    const { lexwareRequest } = await import('../services/lexware.js');
    mockRequest.mockResolvedValueOnce({ data: {} });
    await lexwareRequest('GET', '/profile');
    const [, rejectedHandler] = mockUse.mock.calls[0] as [unknown, RejectedHandler];
    return rejectedHandler;
  }

  function make429Error(data: unknown): AxiosError {
    const err = new AxiosError('Too Many Requests');
    err.response = {
      status: 429,
      statusText: 'Too Many Requests',
      data: {},
      headers: {},
      config: {} as never,
    };
    err.config = { data } as never;
    return err;
  }

  // Regression-catcher for #62: must FAIL before the isStreamBody guard is added
  // (the old code would call client.request(config) and hang until timeout).
  it('does not retry a one-shot stream body (form-data upload) on 429 — rejects the original error', async () => {
    const rejectedHandler = await getRejectedHandler();
    mockRequest.mockClear(); // drop the priming call

    const FormData = (await import('form-data')).default;
    const form = new FormData();
    form.append('file', Buffer.from('x'), { filename: 'a.pdf', contentType: 'application/pdf' });

    const axiosError = make429Error(form);

    await expect(rejectedHandler(axiosError)).rejects.toBe(axiosError);
    expect(mockRequest).not.toHaveBeenCalled();
  });

  // Narrowness guard: proves the fix doesn't disable retry for the other 65 tools,
  // which send plain (non-stream) JSON bodies.
  it('still retries a non-stream (JSON) body on 429', async () => {
    vi.useFakeTimers();
    const rejectedHandler = await getRejectedHandler();
    mockRequest.mockClear();
    mockRequest.mockResolvedValueOnce({ data: { ok: true } });

    const axiosError = make429Error(JSON.stringify({ a: 1 }));

    const pending = rejectedHandler(axiosError);
    await vi.advanceTimersByTimeAsync(1000); // no Retry-After header -> 2^0 * 1000ms backoff
    await pending;

    expect(mockRequest).toHaveBeenCalledExactlyOnceWith(axiosError.config);
  });
});
