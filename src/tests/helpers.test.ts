import { describe, it, expect, vi } from 'vitest';
import { toolError, formatResponse, handleToolRequest } from '../helpers.js';

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

  it('handles arrays with structuredContent', () => {
    const data = [1, 2, 3];
    const result = formatResponse(data);
    expect(result.structuredContent).toEqual(data);
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
