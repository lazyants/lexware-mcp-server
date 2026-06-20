import axios, { AxiosInstance, AxiosError, Method } from 'axios';
import { get as httpsGet } from 'node:https';
import { createPublicKey } from 'node:crypto';
import { LEXWARE_API_BASE, MAX_RETRIES, REQUEST_TIMEOUT } from '../constants.js';
import { LexwareLegacyError, LexwareStandardError } from '../types/common.js';

function getToken(): string {
  const token = process.env.LEXWARE_API_TOKEN;
  if (!token) {
    throw new Error(
      'LEXWARE_API_TOKEN environment variable is required. ' +
      'Get your token from https://app.lexware.de/addons/public-api'
    );
  }
  return token;
}

// setTimeout coerces its delay to a 32-bit signed int, so a value above this
// ceiling silently wraps and can fire immediately. Clamp every computed delay.
const MAX_RETRY_DELAY_MS = 2_147_483_647;

// RFC 7231 §7.1.1.1 IMF-fixdate, e.g. "Wed, 21 Oct 2015 07:28:00 GMT" — the only
// HTTP-date form a server is permitted to SEND. We parse its fields explicitly
// rather than via Date.parse: Date.parse is a permissive PARSER, not a validator,
// so it silently mishandles the obsolete forms (RFC 850 two-digit years → 19xx,
// asctime → local time) AND normalizes invalid IMF-fixdate values ("31 Feb" →
// Mar 3, hour "25" → next day), any of which would yield a WRONG delay instead of
// a clean reject. Capturing the fields and round-tripping through Date.UTC rejects
// every such value so the caller can fall back to exponential backoff.
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const IMF_FIXDATE = /^([A-Za-z]{3}), (\d{2}) ([A-Za-z]{3}) (\d{4}) (\d{2}):(\d{2}):(\d{2}) GMT$/;

// Parse a strict IMF-fixdate to a UTC epoch-ms, or null if any field is invalid or
// the value was normalized (Date.UTC silently rolls over out-of-range fields and
// maps a 0-99 year to 19xx, so the exact round-trip below is the real validation).
// The day-name is redundant with the date but a conforming sender always sets it
// correctly, so a mismatch means a corrupt header → reject (→ exponential backoff).
function parseImfFixdate(value: string): number | null {
  const m = IMF_FIXDATE.exec(value);
  if (!m) return null;
  const month = MONTHS.indexOf(m[3]);
  if (month < 0) return null;
  const day = Number(m[2]);
  const year = Number(m[4]);
  const hour = Number(m[5]);
  const minute = Number(m[6]);
  const second = Number(m[7]);
  const ms = Date.UTC(year, month, day, hour, minute, second);
  const d = new Date(ms);
  if (
    d.getUTCFullYear() !== year ||
    d.getUTCMonth() !== month ||
    d.getUTCDate() !== day ||
    d.getUTCHours() !== hour ||
    d.getUTCMinutes() !== minute ||
    d.getUTCSeconds() !== second ||
    DAYS[d.getUTCDay()] !== m[1]
  ) {
    return null;
  }
  return ms;
}

/**
 * Parse an RFC 7231 `Retry-After` header into a non-negative millisecond delay.
 * The header is either delta-seconds (a bare integer) OR an HTTP-date — a bare
 * `parseInt` turned a date into `NaN`, so `setTimeout(NaN)` fired immediately and
 * defeated the 429 backoff. Returns null when absent or unparseable (including the
 * obsolete non-IMF-fixdate forms) so the caller falls back to exponential backoff;
 * clamps to a finite, non-negative delay.
 */
export function parseRetryAfterMs(
  retryAfter: string | undefined,
  now: number = Date.now()
): number | null {
  if (!retryAfter) return null;
  const trimmed = retryAfter.trim();

  // delta-seconds: a bare non-negative integer count of seconds.
  if (/^\d+$/.test(trimmed)) {
    return Math.min(Number(trimmed) * 1000, MAX_RETRY_DELAY_MS);
  }

  // HTTP-date (strict IMF-fixdate): delay until that instant, never into the past.
  const dateMs = parseImfFixdate(trimmed);
  if (dateMs === null) return null;
  return Math.min(Math.max(dateMs - now, 0), MAX_RETRY_DELAY_MS);
}

function createClient(): AxiosInstance {
  const client = axios.create({
    baseURL: LEXWARE_API_BASE,
    timeout: REQUEST_TIMEOUT,
    headers: {
      Authorization: `Bearer ${getToken()}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
  });

  client.interceptors.response.use(
    (response) => response,
    async (error: AxiosError) => {
      if (error.response?.status === 429) {
        const config = error.config;
        if (!config) return Promise.reject(error);

        const retryCount = ((config as unknown as Record<string, unknown>).__retryCount as number) || 0;
        if (retryCount >= MAX_RETRIES) {
          return Promise.reject(new Error('Rate limit exceeded after maximum retries'));
        }

        const retryAfterMs = parseRetryAfterMs(error.response.headers['retry-after']);
        const delay = retryAfterMs ?? Math.pow(2, retryCount) * 1000;

        (config as unknown as Record<string, unknown>).__retryCount = retryCount + 1;
        console.error(`[lexware-mcp] Rate limited. Retrying in ${delay}ms (attempt ${retryCount + 1}/${MAX_RETRIES})`);

        await new Promise((resolve) => setTimeout(resolve, delay));
        return client.request(config);
      }

      return Promise.reject(error);
    }
  );

  return client;
}

let clientInstance: AxiosInstance | null = null;

function getClient(): AxiosInstance {
  if (!clientInstance) {
    clientInstance = createClient();
  }
  return clientInstance;
}

function stripUndefined(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined) {
      result[key] = value;
    }
  }
  return result;
}

function formatError(err: AxiosError): Error {
  if (!err.response) {
    return new Error(`Network error: ${err.message}`, { cause: err });
  }

  const body = err.response.data;

  // Legacy error format (contacts, files, vouchers)
  const legacy = body as LexwareLegacyError | undefined;
  if (legacy?.IssueList?.length) {
    const issues = legacy.IssueList.map(
      (i) => `[${i.type}] ${i.source}: ${i.i18nKey}`
    ).join('; ');
    return new Error(`Lexware API validation error: ${issues}`, { cause: err });
  }

  // Standard error format
  const standard = body as LexwareStandardError | undefined;
  if (standard?.message) {
    return new Error(`Lexware API [${standard.status}]: ${standard.message}`, { cause: err });
  }

  return new Error(`Lexware API error: ${err.response.status} ${err.response.statusText}`, { cause: err });
}

// Headers that must never survive on an AxiosError we chain as `{ cause: err }`.
const SENSITIVE_HEADERS = new Set(['authorization', 'proxy-authorization', 'cookie']);

// Remove auth-bearing headers case-insensitively from an AxiosHeaders instance
// (which exposes .delete) OR a plain object. A fixed-case `delete h.Authorization`
// would miss a plain key like `AUTHORIZATION`, so iterate the actual keys.
function scrubAuth(headers: unknown): void {
  if (!headers || typeof headers !== 'object') return;
  const h = headers as Record<string, unknown> & { delete?: unknown };
  // Optional chaining only guards null/undefined; a plain object whose own key is
  // literally "delete" would make `h.delete(key)` throw — so type-guard it.
  const del = typeof h.delete === 'function' ? (h.delete as (k: string) => void) : null;
  for (const key of Object.keys(h)) {
    if (SENSITIVE_HEADERS.has(key.toLowerCase())) {
      del?.call(h, key); // AxiosHeaders removes its normalized entry
      delete h[key]; // plain-object / belt-and-suspenders
    }
  }
}

// Scrub every credential-bearing field on a request/response config: headers plus
// basic-auth `auth` and `proxy.auth`. Lexware sets none of the latter today, but a
// central sanitizer should not depend on that.
function scrubConfig(config: unknown): void {
  if (!config || typeof config !== 'object') return;
  const c = config as { headers?: unknown; auth?: unknown; proxy?: { auth?: unknown } | null };
  scrubAuth(c.headers);
  delete c.auth;
  if (c.proxy && typeof c.proxy === 'object') delete c.proxy.auth;
}

// Void mutator: strip the bearer token (LEXWARE_API_TOKEN) from an AxiosError
// before it is chained via `{ cause: err }`, so a logger walking the cause with
// `util.inspect(err, { depth: null })` or `AxiosError.toJSON()` cannot surface it.
// `config.headers` AND Node's `request._header` raw block both carry the token.
// Mutating up front (rather than building a fresh cause) keeps the literal caught
// binding available for `{ cause: err }`, satisfying eslint preserve-caught-error.
function sanitizeAxiosError(err: AxiosError): void {
  scrubConfig(err.config);
  scrubConfig(err.response?.config); // may be a distinct ref depending on the adapter
  delete (err as { request?: unknown }).request;
  if (err.response) delete (err.response as { request?: unknown }).request;
  // Defensive: an AxiosError that already chained an object cause could carry its
  // own config/request — drop it before we re-chain err.
  const e = err as { cause?: unknown };
  if (e.cause && typeof e.cause === 'object') delete e.cause;
}

// Single sanitized throw path for every axios call site. Mirrors the historical
// lexwareRequest branches exactly so thrown messages don't drift: a response →
// formatted API error; a network code → "Network error"; anything else → the
// (now sanitized) raw error rethrown as before.
export function wrapLexwareError(err: unknown): unknown {
  if (!(err instanceof AxiosError)) return err;
  sanitizeAxiosError(err);
  if (err.response) return formatError(err);
  if (err.code) return new Error(`Network error: ${err.message}`, { cause: err });
  return err;
}

export async function lexwareRequest<T = unknown>(
  method: Method,
  path: string,
  data?: unknown,
  params?: Record<string, unknown>
): Promise<T> {
  try {
    const client = getClient();
    const response = await client.request<T>({
      method,
      url: path,
      data,
      params: params ? stripUndefined(params) : undefined,
    });
    return response.data;
  } catch (err) {
    throw wrapLexwareError(err);
  }
}

export async function lexwareUpload<T = unknown>(
  path: string,
  fileBuffer: Buffer,
  fileName: string,
  contentType: string
): Promise<T> {
  const client = getClient();
  // GOTCHA: Dynamic import — won't fail at compile time if form-data is missing, only at runtime.
  const FormData = (await import('form-data')).default;
  const form = new FormData();
  form.append('file', fileBuffer, { filename: fileName, contentType });

  try {
    const response = await client.request<T>({
      method: 'POST',
      url: path,
      data: form,
      headers: {
        ...form.getHeaders(),
        Authorization: `Bearer ${getToken()}`,
      },
    });
    return response.data;
  } catch (err) {
    throw wrapLexwareError(err);
  }
}

const WEBHOOK_PUBLIC_KEY_URL =
  'https://developers.lexware.io/webhookSignature/public/public_key.pub';

// Cache the in-flight Promise (single-flight) so concurrent first callers
// share one network fetch. Cleared on rejection so the next call retries.
let webhookKeyCache: Promise<string> | null = null;

export function getWebhookPublicKey(): Promise<string> {
  const override = process.env.LEXWARE_WEBHOOK_PUBLIC_KEY;
  if (override) return Promise.resolve(override);
  if (webhookKeyCache) return webhookKeyCache;

  const pending = fetchAndValidatePublicKey().catch((err) => {
    if (webhookKeyCache === pending) webhookKeyCache = null;
    throw err;
  });
  webhookKeyCache = pending;
  return pending;
}

function fetchAndValidatePublicKey(): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const req = httpsGet(WEBHOOK_PUBLIC_KEY_URL, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error(`Public key fetch failed: HTTP ${res.statusCode}`));
        return;
      }
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => {
        const pem = Buffer.concat(chunks).toString('utf8');
        try {
          createPublicKey(pem);
        } catch {
          reject(new Error('Public key fetch returned invalid PEM'));
          return;
        }
        resolve(pem);
      });
      res.on('error', reject);
    });
    req.setTimeout(REQUEST_TIMEOUT, () => req.destroy(new Error('Public key fetch timed out')));
    req.on('error', reject);
  });
}

// Test-only: reset cached webhook key. Underscore-prefixed to signal internal use.
export function __resetWebhookKeyCache(): void {
  webhookKeyCache = null;
}

export async function lexwareDownload(
  path: string,
  accept = 'application/pdf'
): Promise<{ data: Buffer; contentType: string; fileName?: string }> {
  const client = getClient();
  try {
    const response = await client.request({
      method: 'GET',
      url: path,
      responseType: 'arraybuffer',
      headers: {
        Accept: accept,
      },
    });

    const contentDisposition = response.headers['content-disposition'] as string | undefined;
    let fileName: string | undefined;
    if (contentDisposition) {
      const match = contentDisposition.match(/filename="?([^";\s]+)"?/);
      if (match) fileName = match[1];
    }

    return {
      data: Buffer.from(response.data as ArrayBuffer),
      contentType: (response.headers['content-type'] as string) || 'application/octet-stream',
      fileName,
    };
  } catch (err) {
    throw wrapLexwareError(err);
  }
}
