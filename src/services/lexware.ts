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

function isStreamBody(data: unknown): boolean {
  return typeof (data as { pipe?: unknown } | null | undefined)?.pipe === 'function';
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

        // Retrying a one-shot stream body (form-data upload) re-pipes an already-drained
        // form: it emits nothing and never ends, so the request hangs until REQUEST_TIMEOUT
        // and surfaces a bogus "Network error: timeout" masking the real 429. Reject the
        // original error so the caller gets an honest, formatted rate-limit error. Native/spec
        // FormData has no .pipe (axios rebuilds its stream per request), so it is not matched.
        if (isStreamBody(config.data)) {
          console.error('[lexware-mcp] Rate limited on a one-shot stream body (upload); not retrying — the body cannot be replayed.');
          return Promise.reject(error);
        }

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

// Scrub every credential-bearing field on a request/response config: headers,
// basic-auth `auth` and `proxy.auth`, the request body (#75 — it's what the caller
// already sent, so dropping it from a chained error costs nothing diagnostically),
// and any query string (params object + the `?...` tail of `url`, which can carry
// PII/search terms across every one of this server's ~66 tools, not just auth).
function scrubConfig(config: unknown): void {
  if (!config || typeof config !== 'object') return;
  const c = config as {
    headers?: unknown;
    auth?: unknown;
    proxy?: { auth?: unknown } | null;
    data?: unknown;
    params?: unknown;
    url?: unknown;
  };
  scrubAuth(c.headers);
  delete c.auth;
  if (c.proxy && typeof c.proxy === 'object') delete c.proxy.auth;
  delete c.data;
  delete c.params;
  if (typeof c.url === 'string') {
    const qIndex = c.url.indexOf('?');
    if (qIndex !== -1) c.url = c.url.slice(0, qIndex) + '?[REDACTED]';
  }
}

// Strip the bearer token (LEXWARE_API_TOKEN) and every other credential-bearing
// field from an AxiosError before it is chained via `{ cause: err }`, so a logger
// walking the cause with `util.inspect(err, { depth: null })` or
// `AxiosError.toJSON()` cannot surface it. `config.headers` AND Node's
// `request._header` raw block both carry the token. Mutating up front (rather
// than building a fresh cause) keeps the literal caught binding available for
// `{ cause: err }`, satisfying eslint preserve-caught-error.
//
// Fail-closed by design (#75): the whole body runs inside one try/catch and
// returns whether the redaction can be trusted as COMPLETE. A frozen config (or
// a frozen `AxiosHeaders` whose `.delete()` throws) can make any one of these
// mutations throw partway through — rather than chase every possible mutation
// site, a single catch here reports `false` and lets the caller (wrapLexwareError)
// decide not to expose `err` at all, instead of risking a half-scrubbed error
// that still carries `err.request`'s raw `_header` block with the bearer token.
export function sanitizeAxiosError(err: AxiosError): boolean {
  try {
    scrubConfig(err.config);
    scrubConfig(err.response?.config); // may be a distinct ref depending on the adapter
    delete (err as { request?: unknown }).request;
    if (err.response) delete (err.response as { request?: unknown }).request;
    // Defensive: an AxiosError that already chained an object cause could carry its
    // own config/request — drop it before we re-chain err.
    const e = err as { cause?: unknown };
    if (e.cause && typeof e.cause === 'object') delete e.cause;
    return true;
  } catch {
    return false;
  }
}

// Message for the fail-closed path: sanitizeAxiosError could not guarantee every
// credential was scrubbed (an exception partway through — e.g. a frozen response).
// Rather than try to neutralize the untrusted AxiosError surface-by-surface, `err`
// is never referenced beyond its already-known, non-sensitive status code: nothing
// hostile can survive if nothing hostile is included.
const UNCERTAIN_SANITIZATION_MESSAGE = 'response redacted — could not be fully sanitized';

// Single sanitized throw path for every axios call site. Mirrors the historical
// lexwareRequest branches exactly so thrown messages don't drift: a response →
// formatted API error; a network code → "Network error"; anything else → the
// (now sanitized) raw error rethrown as before.
//
// Fail-closed (#75): when sanitizeAxiosError cannot guarantee full redaction, `err`
// is NOT chained as `cause` and none of its fields are read beyond the status code.
export function wrapLexwareError(err: unknown): unknown {
  if (!(err instanceof AxiosError)) return err;
  const fullySanitized = sanitizeAxiosError(err);
  if (!fullySanitized) {
    const status = err.response?.status;
    const label = status !== undefined ? ` ${status}` : '';
    return new Error(`Lexware API error${label}: [${UNCERTAIN_SANITIZATION_MESSAGE}]`);
  }
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

// Parameter-tolerant MIME `type/subtype[; params]` grammar (#67). Rejects any CR/LF
// anywhere after the slash — that is the actual injection sink: `form-data`'s
// `_getContentType` writes `contentType` into the multipart part header VERBATIM
// (it escapes the field name and filename via `escapeHeaderParam`, but not this
// value — §1.3a). A STRICT `type/subtype` regex would also reject legitimate
// values the sink itself accepts (e.g. `application/pdf; charset=utf-8` — the
// Blob constructor's own `type` normalization is an ASCII-printable-range filter,
// not a MIME grammar validator — §1.3b), so the parameter tail is deliberately
// permissive; only `\r`/`\n` inside it is rejected. The `[^\r\n]` is what actually
// closes the hole.
const MIME_TYPE_RE = /^[A-Za-z0-9!#$%&'*+.^_`|~-]+\/[A-Za-z0-9!#$%&'*+.^_`|~-]+(;[^\r\n]*)?$/;

// Reject a malformed upload contentType before it reaches the multipart part —
// never silently strip it, which would hide the caller's error. Post-migration to
// native FormData/Blob (below), the sink would otherwise degrade a malformed value
// silently to `application/octet-stream` (Blob blanks any `type` containing a char
// outside U+0020–U+007E rather than throwing — §1.3b) instead of failing loudly, so
// this guard is what actually surfaces the caller's mistake.
function assertValidMimeType(contentType: string): void {
  if (!MIME_TYPE_RE.test(contentType)) {
    throw new Error(`Invalid contentType for upload: ${JSON.stringify(contentType)}`);
  }
}

export async function lexwareUpload<T = unknown>(
  path: string,
  fileBuffer: Buffer,
  fileName: string,
  contentType: string,
  uploadType?: 'voucher'
): Promise<T> {
  const client = getClient();
  assertValidMimeType(contentType);

  // Node 20+ global FormData/Blob (#74.1): unlike the old `form-data` package, this
  // produces a REPLAYABLE body — axios rebuilds a fresh multipart stream from it on
  // every attempt (§1.3c), so a 429 upload can now be retried instead of hanging
  // until timeout under the isStreamBody guard.
  const form = new FormData();
  // @types/node types Buffer as Uint8Array<ArrayBufferLike>, but BlobPart requires
  // ArrayBufferView<ArrayBuffer>. A Buffer.from(...) is never SharedArrayBuffer-backed,
  // so this cast is safe — without it: TS2322.
  const filePart = new Blob([fileBuffer as Uint8Array<ArrayBuffer>], { type: contentType });
  form.append('file', filePart, fileName);
  // POST /v1/files requires a `type` part (400 without it). POST /vouchers/{id}/files
  // must NOT have one — its documented sample sends the file part alone.
  if (uploadType) form.append('type', uploadType);

  try {
    const response = await client.request<T>({
      method: 'POST',
      url: path,
      data: form,
      headers: {
        // MUST override the client default `application/json` set in createClient():
        // axios's transformRequest JSON-stringifies a FormData body whenever the
        // Content-Type contains "application/json", silently dropping the file
        // bytes. The boundary itself is filled in by the http adapter.
        'Content-Type': 'multipart/form-data',
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

// --- Content-Disposition filename parsing (#63) --------------------------------
//
// Deliberately not a full parameter tokenizer — three anchored regexes, not a
// grammar. Two known, accepted limitations, both intentional and covered by tests:
//   (i) a `;` inside ANOTHER parameter's quoted value re-opens the `(?:^|;)`
//       anchor, e.g. `attachment; foo="a; filename=evil.pdf"` yields `evil.pdf`.
//       The prior code had the identical weakness; harmless because the result is
//       sanitized below regardless of which parameter "won".
//  (ii) RFC 2231 continuations (`filename*0*=…; filename*1*=…`) are unsupported
//       and fall back to the plain `filename` (or the caller's static default).
const FILENAME_STAR_RE = /(?:^|;)\s*filename\*\s*=\s*([^;]+)/i;
const FILENAME_TOKEN_OR_QUOTED_RE = /(?:^|;)\s*filename\s*=\s*(?:"((?:[^"\\]|\\.)*)"|([^;"\s]+))/i;

function unescapeQuoted(value: string): string {
  return value.replace(/\\(.)/g, '$1');
}

// Decode an RFC 5987/8187 ext-value: `charset ' language-tag ' value`. Percent-decode
// BYTE-WISE (not decodeURIComponent, which assumes UTF-8 and throws on a stray
// %-escape from another charset), then decode as the declared charset. Returns null
// — so the caller falls through to the plain `filename` — for an unrecognized/
// unsupported charset, a malformed %-escape, or (UTF-8 only) undecodable bytes:
// `Buffer`-style lossy decoding would substitute U+FFFD instead of failing, so this
// uses `TextDecoder('utf-8', { fatal: true })` specifically to reject those bytes
// rather than silently emit "<63>xEF__.pdf".
function decodeExtValue(raw: string): string | null {
  const m = /^([^']*)'[^']*'(.*)$/.exec(raw.trim());
  if (!m) return null;
  const charset = m[1].toLowerCase();
  const encoded = m[2];
  if (charset !== 'utf-8' && charset !== 'iso-8859-1') return null;

  const bytes: number[] = [];
  for (let i = 0; i < encoded.length; i++) {
    const ch = encoded[i];
    if (ch === '%' && i + 2 < encoded.length) {
      const byte = Number.parseInt(encoded.slice(i + 1, i + 3), 16);
      if (Number.isNaN(byte)) return null; // malformed %-escape
      bytes.push(byte);
      i += 2;
    } else {
      const code = ch.codePointAt(0) as number;
      if (code > 0xff) return null; // not a valid single octet in this grammar
      bytes.push(code);
    }
  }

  if (charset === 'iso-8859-1') {
    return bytes.map((b) => String.fromCharCode(b)).join('');
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(bytes));
  } catch {
    return null; // undecodable bytes -> fall through, same as an unknown charset
  }
}

// Sanitize a filename recovered from an untrusted header before it is handed back
// to an MCP client, which typically uses it verbatim when saving the payload to
// disk (this repo never does — grepped). Takes the last path segment (defuses any
// embedded directory component), drops C0 controls + DEL by CODE POINT — not a
// regex character class, which eslint's no-control-regex rule rejects — caps at
// 255 CODE POINTS via Array.from (a naive .slice(0, 255) can split a surrogate
// pair), and rejects '', '.', '..' so the caller's static fallback applies instead
// of a filesystem-meaningful non-name.
function sanitizeFileName(raw: string): string | undefined {
  const lastSegment = raw.split(/[/\\]/).pop() ?? '';
  const codePoints = Array.from(lastSegment).filter((ch) => {
    const code = ch.codePointAt(0) as number;
    return !(code <= 0x1f || code === 0x7f);
  });
  const cleaned = codePoints.slice(0, 255).join('');
  if (cleaned === '' || cleaned === '.' || cleaned === '..') return undefined;
  return cleaned;
}

// Parse a Content-Disposition header for a filename per RFC 6266, preferring the
// RFC 5987/8187 extended `filename*=` form over the plain `filename=` form when
// both are present (RFC 6266 §4.3) — the prior code had no support for `filename*`
// at all (a literal `=` right after `filename` never matches `filename*=`, so it
// simply produced no match, not a mis-capture). Returns undefined when neither form
// is present/decodable, or the recovered name is empty/'.'/'..' after sanitizing —
// the caller's static default applies in that case.
export function parseContentDispositionFileName(header: string): string | undefined {
  const starMatch = FILENAME_STAR_RE.exec(header);
  if (starMatch) {
    const decoded = decodeExtValue(starMatch[1].trim());
    if (decoded !== null) {
      const sanitized = sanitizeFileName(decoded);
      if (sanitized !== undefined) return sanitized;
    }
    // Undecodable/unsupported filename* -> fall through to the plain form below.
  }

  const tokenMatch = FILENAME_TOKEN_OR_QUOTED_RE.exec(header);
  if (!tokenMatch) return undefined;
  const raw = tokenMatch[1] !== undefined ? unescapeQuoted(tokenMatch[1]) : (tokenMatch[2] as string);
  return sanitizeFileName(raw);
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
    const fileName = contentDisposition
      ? parseContentDispositionFileName(contentDisposition)
      : undefined;

    return {
      data: Buffer.from(response.data as ArrayBuffer),
      contentType: (response.headers['content-type'] as string) || 'application/octet-stream',
      fileName,
    };
  } catch (err) {
    throw wrapLexwareError(err);
  }
}
