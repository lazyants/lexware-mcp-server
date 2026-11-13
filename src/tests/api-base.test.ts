import { describe, it, expect, afterEach } from 'vitest';
import { parseApiBase } from '../api-base.js';
import { LEXWARE_API_BASE } from '../constants.js';
import { createServer, startServer } from '../server.js';

describe('LEXWARE_API_BASE', () => {
  it('means the real gateway when unset or empty', () => {
    expect(parseApiBase(undefined)).toBe('https://api.lexware.io/v1');
    expect(parseApiBase('')).toBe(LEXWARE_API_BASE);
    expect(parseApiBase('   ')).toBe(LEXWARE_API_BASE);
  });

  it('takes an http or https base URL and drops one trailing slash', () => {
    expect(parseApiBase('http://lexware-double:8080/v1')).toBe('http://lexware-double:8080/v1');
    expect(parseApiBase(' https://sandbox.example.com/v1/ ')).toBe('https://sandbox.example.com/v1');
    expect(parseApiBase('http://127.0.0.1:4010')).toBe('http://127.0.0.1:4010');
  });

  it.each([
    'api.lexware.io/v1',
    'ftp://example.com/v1',
    'file:///tmp/lexware',
    'https://user:secret@example.com/v1',
    'https://example.com/v1?tenant=test',
    'https://example.com/v1#x',
    'https://example.com/v1?',
    'https://example.com/v1#',
    'not a url',
  ])('refuses %j instead of falling back to the real gateway', (value) => {
    expect(() => parseApiBase(value)).toThrow(
      'LEXWARE_API_BASE must be an absolute http or https URL without credentials, query or fragment',
    );
  });

  describe('at startup', () => {
    const original = process.env.LEXWARE_API_BASE;
    afterEach(() => {
      if (original === undefined) delete process.env.LEXWARE_API_BASE;
      else process.env.LEXWARE_API_BASE = original;
    });

    it('stops the server before it opens stdio when the value is invalid', async () => {
      process.env.LEXWARE_API_BASE = 'api.lexware.io/v1';
      const server = createServer();
      await expect(startServer(server)).rejects.toThrow('LEXWARE_API_BASE must be');
      expect(server.isConnected()).toBe(false);
    });
  });
});
