import { describe, it, expect, vi } from 'vitest';
import { toolError, formatResponse, handleToolRequest, withProcessingRetry, isNotFound } from '../helpers.js';

describe('isNotFound', () => {
  it('detects a 404 on the chained axios cause', () => {
    expect(isNotFound(Object.assign(new Error('Not Found'), { cause: { response: { status: 404 } } }))).toBe(true);
  });

  it.each([
    'Lexware API [404]: Voucher not found',
    'Lexware API error: 404 Not Found',
  ])('detects a 404 from the formatted message %s', (message) => {
    expect(isNotFound(new Error(message))).toBe(true);
  });

  // The formatError fallback appends the response body, and voucher numbers are
  // free text — a bare "404" scan would turn either into a bogus retry loop.
  it.each([
    'Lexware API error: 400 Bad Request — {"source":"voucher RE-404 is invalid"}',
    'Lexware API [500]: request 404 could not be processed',
    'Network error: connect ECONNREFUSED 10.0.0.404:443',
  ])('does not treat an incidental 404 in %s as not-found', (message) => {
    expect(isNotFound(new Error(message))).toBe(false);
  });

  it('returns false for a non-404 status on the cause', () => {
    expect(isNotFound(Object.assign(new Error('boom'), { cause: { response: { status: 500 } } }))).toBe(false);
  });

  it('returns false for non-Error values', () => {
    expect(isNotFound('404')).toBe(false);
    expect(isNotFound(null)).toBe(false);
  });
});

describe('withProcessingRetry', () => {
  const notFound = () => Object.assign(new Error('Not Found'), { cause: { response: { status: 404 } } });

  it('returns the result immediately on first success', async () => {
    const fn = vi.fn().mockResolvedValue({ id: '123' });
    expect(await withProcessingRetry(fn, 3, [0, 0, 0])).toEqual({ id: '123' });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries a 404 and returns the eventual success', async () => {
    const fn = vi.fn().mockRejectedValueOnce(notFound()).mockResolvedValue({ id: 'ok' });
    expect(await withProcessingRetry(fn, 3, [0, 0, 0])).toEqual({ id: 'ok' });
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('retries a 404 detected from the formatted message', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('Lexware API [404]: not found'))
      .mockResolvedValue({ id: 'ok' });
    expect(await withProcessingRetry(fn, 3, [0, 0, 0])).toEqual({ id: 'ok' });
    expect(fn).toHaveBeenCalledTimes(2);
  });

  // The whole point of scoping the retry: a 500 will not fix itself, and retrying
  // only delays the real error.
  it('rethrows a non-404 immediately without retrying', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('Internal Server Error'));
    await expect(withProcessingRetry(fn, 3, [0, 0, 0])).rejects.toThrow('Internal Server Error');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('throws the last 404 after exhausting every attempt', async () => {
    const fn = vi.fn().mockRejectedValue(notFound());
    await expect(withProcessingRetry(fn, 3, [0, 0, 0])).rejects.toThrow('Not Found');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it.each([[null], ['']])('retries an empty response (%p) and returns it on the last attempt', async (empty) => {
    const fn = vi.fn().mockResolvedValue(empty);
    expect(await withProcessingRetry(fn, 3, [0, 0, 0])).toBe(empty);
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('returns the successful result after retrying an empty response', async () => {
    const fn = vi.fn().mockResolvedValueOnce(null).mockResolvedValue({ id: 'abc' });
    expect(await withProcessingRetry(fn, 3, [0, 0, 0])).toEqual({ id: 'abc' });
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('respects a custom retries count', async () => {
    const fn = vi.fn().mockRejectedValue(notFound());
    await expect(withProcessingRetry(fn, 2, [0, 0])).rejects.toThrow('Not Found');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('reuses the final delay when there are more attempts than delays', async () => {
    const fn = vi.fn().mockRejectedValue(notFound());
    await expect(withProcessingRetry(fn, 4, [0])).rejects.toThrow('Not Found');
    expect(fn).toHaveBeenCalledTimes(4);
  });
});

describe('toolError', () => {
  it('returns isError true with Error message', () => {
    const result = toolError(new Error('something broke'));
    expect(result.isError).toBe(true);
    expect(result.content[0]).toEqual({ type: 'text', text: 'Error: something broke' });
  });

  it('returns isError true with string', () => {
    const result = toolError('string error');
    expect(result.isError).toBe(true);
    expect(result.content[0]).toEqual({ type: 'text', text: 'Error: string error' });
  });
});

describe('formatResponse', () => {
  it('returns JSON text for objects with structuredContent', () => {
    const data = { id: '123', name: 'test' };
    const result = formatResponse(data);
    expect(result.content[0]).toEqual({ type: 'text', text: JSON.stringify(data, null, 2) });
    expect(result.structuredContent).toEqual(data);
  });

  it('returns text without structuredContent for strings', () => {
    const result = formatResponse('plain text');
    expect(result.content[0]).toEqual({ type: 'text', text: '"plain text"' });
    expect(result.structuredContent).toBeUndefined();
  });

  it('returns text without structuredContent for empty string', () => {
    const result = formatResponse('');
    expect(result.content[0]).toEqual({ type: 'text', text: '""' });
    expect(result.structuredContent).toBeUndefined();
  });

  it('handles null without structuredContent', () => {
    const result = formatResponse(null);
    expect(result.content[0]).toEqual({ type: 'text', text: 'null' });
    expect(result.structuredContent).toBeUndefined();
  });

  it('omits structuredContent for arrays (MCP SDK rejects arrays there)', () => {
    const data = [1, 2, 3];
    const result = formatResponse(data);
    expect(result.content[0]).toEqual({ type: 'text', text: JSON.stringify(data, null, 2) });
    expect(result.structuredContent).toBeUndefined();
  });
});

describe('handleToolRequest', () => {
  it('wraps successful result with formatResponse', async () => {
    const fn = vi.fn().mockResolvedValue({ id: 'abc' });
    const handler = handleToolRequest(fn);
    const result = await handler({ test: true });
    expect(fn).toHaveBeenCalledWith({ test: true });
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toEqual({ id: 'abc' });
  });

  it('catches errors and returns toolError', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const fn = vi.fn().mockRejectedValue(new Error('API failed'));
    const handler = handleToolRequest(fn);
    const result = await handler({});
    expect(result.isError).toBe(true);
    expect(result.content[0]).toEqual({ type: 'text', text: 'Error: API failed' });
    expect(consoleSpy).toHaveBeenCalledWith('[lexware-mcp] Tool error: API failed');
    consoleSpy.mockRestore();
  });
});
