import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AxiosError } from 'axios';
import { MAX_RETRIES } from '../constants.js';

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

  function make429Error(data: unknown, headers: Record<string, string> = {}): AxiosError {
    const err = new AxiosError('Too Many Requests');
    err.response = {
      status: 429,
      statusText: 'Too Many Requests',
      data: {},
      headers,
      config: {} as never,
    };
    err.config = { data } as never;
    return err;
  }

  // #74: a spec-compliant FormData body is replayable (axios rebuilds the multipart
  // stream per attempt — §1.3c), so an upload that hits a 429 must now be retried,
  // not rejected outright.
  it('retries a spec-compliant FormData upload body on 429', async () => {
    vi.useFakeTimers();
    const rejectedHandler = await getRejectedHandler();
    mockRequest.mockClear(); // drop the priming call
    mockRequest.mockResolvedValueOnce({ data: { id: 'f-1' } });

    const form = new FormData();
    form.append('file', new Blob([Buffer.from('x')], { type: 'application/pdf' }), 'a.pdf');
    const axiosError = make429Error(form);

    const pending = rejectedHandler(axiosError);
    await vi.advanceTimersByTimeAsync(1000); // no Retry-After header -> 2^0 * 1000ms backoff
    await pending;

    expect(mockRequest).toHaveBeenCalledExactlyOnceWith(axiosError.config);
  });

  // Narrowness guard: the isStreamBody escape hatch still applies to a genuine
  // one-shot stream, should one ever be passed to lexwareRequest/lexwareUpload
  // again. Uses a generic stream-shaped object rather than the `form-data` package
  // (removed by #74.1 — D2) so this test has no dependency on it.
  it('does not retry a one-shot stream body on 429 — rejects the original error', async () => {
    const rejectedHandler = await getRejectedHandler();
    mockRequest.mockClear(); // drop the priming call

    const streamLikeBody = { pipe: () => undefined };
    const axiosError = make429Error(streamLikeBody);

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

  // #69.1(i): the helper used to hardcode `headers: {}`, so the `retryAfterMs ??`
  // left branch (lexware.ts:128-129) never ran in any test. Uses a Retry-After
  // value (5s) that diverges from what the exponential fallback (2^0*1000 = 1s)
  // would give, and asserts nothing fires at the exponential time, to prove the
  // header value — not the fallback — actually drove the delay.
  it('uses the Retry-After header value for the delay, not the exponential fallback', async () => {
    vi.useFakeTimers();
    const rejectedHandler = await getRejectedHandler();
    mockRequest.mockClear();
    mockRequest.mockResolvedValueOnce({ data: { ok: true } });

    const axiosError = make429Error(JSON.stringify({ a: 1 }), { 'retry-after': '5' });
    const pending = rejectedHandler(axiosError);

    await vi.advanceTimersByTimeAsync(1000); // exponential fallback would have fired by here
    expect(mockRequest).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(4000); // now at the full 5000ms Retry-After delay
    await pending;

    expect(mockRequest).toHaveBeenCalledExactlyOnceWith(axiosError.config);
  });

  // #69.1(ii): MAX_RETRIES exhaustion (lexware.ts:124-126).
  it('rejects with a max-retries error once __retryCount has reached MAX_RETRIES', async () => {
    const rejectedHandler = await getRejectedHandler();
    mockRequest.mockClear();

    const axiosError = make429Error(JSON.stringify({ a: 1 }));
    (axiosError.config as unknown as Record<string, unknown>).__retryCount = MAX_RETRIES;

    await expect(rejectedHandler(axiosError)).rejects.toThrow(
      'Rate limit exceeded after maximum retries',
    );
    expect(mockRequest).not.toHaveBeenCalled();
  });

  // #69.1(iii): __retryCount increment / exponential growth (lexware.ts:131). The
  // existing single-retry tests above assert against the SAME object reference this
  // line mutates, so a stale-reference bug (e.g. accidentally cloning `config`
  // before mutating) would be invisible to them. This drives the handler twice
  // against one shared, mutable config — as a real retried request that hits a
  // second 429 would — and checks both the mutation and the doubled delay.
  it('increments __retryCount and doubles the backoff delay across successive 429s on the same config', async () => {
    vi.useFakeTimers();
    const rejectedHandler = await getRejectedHandler();
    mockRequest.mockClear();
    mockRequest.mockResolvedValueOnce({ data: { ok: true } });
    mockRequest.mockResolvedValueOnce({ data: { ok: true } });

    const sharedConfig = { data: JSON.stringify({ a: 1 }) } as unknown as AxiosError['config'];
    function errorAgainstSharedConfig(): AxiosError {
      const err = new AxiosError('Too Many Requests');
      err.response = { status: 429, statusText: 'Too Many Requests', data: {}, headers: {}, config: {} as never };
      err.config = sharedConfig;
      return err;
    }

    // retryCount 0 -> 2^0*1000ms delay; mutates __retryCount to 1 on sharedConfig.
    const first = rejectedHandler(errorAgainstSharedConfig());
    await vi.advanceTimersByTimeAsync(1000);
    await first;
    expect((sharedConfig as unknown as Record<string, unknown>).__retryCount).toBe(1);

    // retryCount 1 (read off the SAME mutated config) -> 2^1*1000 = 2000ms delay.
    const second = rejectedHandler(errorAgainstSharedConfig());
    await vi.advanceTimersByTimeAsync(1999);
    expect(mockRequest).toHaveBeenCalledTimes(1); // must not have fired yet, one ms short
    await vi.advanceTimersByTimeAsync(1);
    await second;

    expect((sharedConfig as unknown as Record<string, unknown>).__retryCount).toBe(2);
    expect(mockRequest).toHaveBeenCalledTimes(2);
  });

  // #69.1(iv): the `if (!config)` guard (lexware.ts:111).
  it('rejects the original error when the 429 error carries no config', async () => {
    const rejectedHandler = await getRejectedHandler();
    mockRequest.mockClear();

    const err = new AxiosError('Too Many Requests');
    err.response = { status: 429, statusText: 'Too Many Requests', data: {}, headers: {}, config: {} as never };
    // err.config intentionally left unset.

    await expect(rejectedHandler(err)).rejects.toBe(err);
    expect(mockRequest).not.toHaveBeenCalled();
  });

  // #69.1(v): non-429 pass-through (lexware.ts:138) — no retry logic should run at all.
  it('passes a non-429 error straight through unchanged', async () => {
    const rejectedHandler = await getRejectedHandler();
    mockRequest.mockClear();

    const err = new AxiosError('Internal Server Error');
    err.response = { status: 500, statusText: 'Internal Server Error', data: {}, headers: {}, config: {} as never };

    await expect(rejectedHandler(err)).rejects.toBe(err);
    expect(mockRequest).not.toHaveBeenCalled();
  });
});
