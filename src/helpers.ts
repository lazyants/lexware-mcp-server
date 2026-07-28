import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

/**
 * Whether a thrown error is an HTTP 404 from the Lexware client.
 *
 * `lexwareRequest` wraps AxiosErrors as `new Error(msg, { cause: axiosError })`,
 * so the status is on `err.cause.response.status` — that's the reliable signal.
 *
 * The message fallback exists for errors that lost their cause, and is anchored to
 * the two shapes `formatError` emits. It deliberately does NOT scan for a bare
 * "404" anywhere in the message: that text also appears in error bodies and in
 * voucher/invoice numbers, and a false positive here turns a real failure into a
 * silent retry loop.
 */
export function isNotFound(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const cause = err.cause as { response?: { status?: number } } | undefined;
  if (cause?.response?.status === 404) return true;
  return /^Lexware API (?:\[404\]|error: 404\b)/.test(err.message);
}

/**
 * Retry `fn` while Lexware reports the resource as not-yet-there: a 404, or an
 * empty body (`null` / `""`). Both are what the API returns for the window between
 * a file upload and the OCR voucher draft becoming readable.
 *
 * Anything else is re-thrown immediately and un-retried — a 401 or a 500 is not
 * going to resolve itself, and retrying would only delay a real error by 7 seconds.
 *
 * `delayMs` is injectable so tests run without fake timers; it is indexed by
 * attempt and falls back to its last entry.
 */
export async function withProcessingRetry<T>(
  fn: () => Promise<T>,
  retries = 3,
  delayMs = [1_000, 2_000, 4_000],
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt < retries; attempt++) {
    const isLast = attempt === retries - 1;
    try {
      const result = await fn();
      // An empty body on the final attempt is returned as-is rather than thrown:
      // it is a legitimate response shape, just not a useful one.
      if ((result === null || result === '') && !isLast) {
        await delay(delayMs[attempt] ?? delayMs[delayMs.length - 1]);
        continue;
      }
      return result;
    } catch (err) {
      if (!isNotFound(err)) throw err;
      lastError = err;
      if (isLast) break;
      await delay(delayMs[attempt] ?? delayMs[delayMs.length - 1]);
    }
  }

  throw lastError;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function toolError(err: unknown): CallToolResult {
  const message = err instanceof Error ? err.message : String(err);
  return {
    content: [{ type: 'text', text: `Error: ${message}` }],
    isError: true,
  };
}

export function formatResponse(data: unknown): CallToolResult {
  const result: CallToolResult = {
    content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
  };
  // GOTCHA: DELETE responses return empty strings (204), arrays are rejected by the MCP
  // SDK in structuredContent. Only set it for plain objects.
  if (data !== null && typeof data === 'object' && !Array.isArray(data)) {
    result.structuredContent = data as Record<string, unknown>;
  }
  return result;
}

// GOTCHA: Must use `any` — Record<string,unknown> makes destructured props `unknown`,
// breaking template literals like `/invoices/${id}`. Zod validates at runtime anyway.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function handleToolRequest(fn: (params: any) => Promise<unknown>) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return async (params: any) => {
    try {
      const data = await fn(params);
      return formatResponse(data);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[lexware-mcp] Tool error: ${message}`);
      return toolError(err);
    }
  };
}
