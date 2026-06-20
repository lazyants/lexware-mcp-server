import { describe, it, expect } from 'vitest';
import util from 'node:util';
import { AxiosError, AxiosHeaders } from 'axios';
import { wrapLexwareError } from '../services/lexware.js';

// Distinctive sentinel: if this string survives anywhere in a chained/serialized
// error, the bearer token would have leaked into a logger walking the cause.
const TOKEN = 'sk-leaky-bearer-DO-NOT-LEAK-9f3a';

// Build an AxiosError seeded with the token in every place axios stashes it:
// flat request config headers + basic-auth `auth` + Node ClientRequest `_header`
// raw block, optionally mirrored onto `response.config`/`response.request`.
function makeAxiosError(opts: {
  withResponse?: { status: number; statusText: string; data: unknown };
  withCode?: string;
  plainUpperHeader?: boolean;
}): AxiosError {
  const err = new AxiosError('Request failed');
  const headers = opts.plainUpperHeader
    ? ({ AUTHORIZATION: `Bearer ${TOKEN}` } as unknown as AxiosHeaders)
    : new AxiosHeaders({ Authorization: `Bearer ${TOKEN}` });
  const config = {
    headers,
    auth: { username: 'u', password: TOKEN },
    proxy: { host: 'proxy', port: 8080, auth: { username: 'p', password: TOKEN } },
  } as unknown as AxiosError['config'];
  err.config = config;
  (err as { request?: unknown }).request = {
    _header: `POST /v1/invoices HTTP/1.1\r\nAuthorization: Bearer ${TOKEN}\r\n\r\n`,
  };
  if (opts.withCode) err.code = opts.withCode;
  if (opts.withResponse) {
    err.response = {
      status: opts.withResponse.status,
      statusText: opts.withResponse.statusText,
      data: opts.withResponse.data,
      headers: {},
      // Same config ref the request used — proves scrubbing the shared object
      // covers response.config too.
      config,
      request: {
        _header: `POST /v1/invoices HTTP/1.1\r\nAuthorization: Bearer ${TOKEN}\r\n\r\n`,
      },
    } as unknown as AxiosError['response'];
  }
  return err;
}

describe('wrapLexwareError token redaction', () => {
  it('does not leak the bearer token in inspect, JSON.stringify, or toJSON (regression #51)', () => {
    const err = makeAxiosError({
      withResponse: {
        status: 500,
        statusText: 'Internal Server Error',
        data: { message: 'boom', status: 500 },
      },
    });

    const wrapped = wrapLexwareError(err);

    // The core assertion: a deep inspect (the way a logger surfaces a cause)
    // must not surface the token or the Authorization header name.
    const inspected = util.inspect(wrapped, { depth: null });
    expect(inspected).not.toContain(TOKEN);
    expect(inspected).not.toMatch(/authorization/i);

    // The chained cause must be clean too — both via JSON.stringify and the
    // AxiosError.toJSON() serializer (which embeds config).
    const cause = (wrapped as Error).cause as AxiosError;
    expect(JSON.stringify(cause)).not.toContain(TOKEN);
    expect(JSON.stringify(cause.toJSON())).not.toContain(TOKEN);
  });

  it('preserves the standard message identity', () => {
    const err = makeAxiosError({
      withResponse: {
        status: 400,
        statusText: 'Bad Request',
        data: { message: 'Invalid invoice data', status: 400 },
      },
    });
    const wrapped = wrapLexwareError(err) as Error;
    expect(wrapped.message).toBe('Lexware API [400]: Invalid invoice data');
  });

  it('preserves the legacy IssueList message identity', () => {
    const err = makeAxiosError({
      withResponse: {
        status: 422,
        statusText: 'Unprocessable Entity',
        data: {
          IssueList: [
            { type: 'validation_failure', source: 'company.name', i18nKey: 'missing_field' },
          ],
        },
      },
    });
    const wrapped = wrapLexwareError(err) as Error;
    expect(wrapped.message).toBe(
      'Lexware API validation error: [validation_failure] company.name: missing_field',
    );
  });

  it('preserves the network-error message identity and leaks no token', () => {
    const err = makeAxiosError({ withCode: 'ECONNABORTED' });
    err.message = 'timeout of 0ms exceeded';
    const wrapped = wrapLexwareError(err);
    expect(wrapped).toBeInstanceOf(Error);
    expect((wrapped as Error).message).toBe('Network error: timeout of 0ms exceeded');
    expect(util.inspect(wrapped, { depth: null })).not.toContain(TOKEN);
  });

  it('returns the same (sanitized) instance for an AxiosError with no response and no code', () => {
    const err = makeAxiosError({});
    const wrapped = wrapLexwareError(err);
    expect(wrapped).toBe(err);
    expect(util.inspect(wrapped, { depth: null })).not.toContain(TOKEN);
  });

  it('scrubs an uppercase AUTHORIZATION header key case-insensitively', () => {
    const err = makeAxiosError({
      withResponse: {
        status: 500,
        statusText: 'Internal Server Error',
        data: { message: 'boom', status: 500 },
      },
      plainUpperHeader: true,
    });
    const wrapped = wrapLexwareError(err);
    expect(util.inspect(wrapped, { depth: null })).not.toContain(TOKEN);
  });

  it('returns a non-Axios error unchanged', () => {
    const plain = new Error('plain');
    expect(wrapLexwareError(plain)).toBe(plain);
  });
});
