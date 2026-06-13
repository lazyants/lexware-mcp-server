import { describe, expect, it } from 'vitest';
import { resolveApiToken } from '../services/lexware.js';

// Unit tests for the PURE token-source selection function. Keeping selection
// pure (no keyring/env IO) means every branch is directly testable without
// mocking the native module — the keyring/env reads live in resolveToken().

const SERVICE = 'lexware-mcp';

describe('resolveApiToken (pure token-source selection)', () => {
  it('prefers the keyring value when present', () => {
    expect(
      resolveApiToken({ keyringValue: 'keyring-token', envValue: 'env-token', service: SERVICE }),
    ).toBe('keyring-token');
  });

  it('falls back to the env value when the keyring value is absent', () => {
    expect(resolveApiToken({ keyringValue: null, envValue: 'env-token', service: SERVICE })).toBe(
      'env-token',
    );
    expect(
      resolveApiToken({ keyringValue: undefined, envValue: 'env-token', service: SERVICE }),
    ).toBe('env-token');
    // Empty string is falsy → must fall through to env, not be returned.
    expect(resolveApiToken({ keyringValue: '', envValue: 'env-token', service: SERVICE })).toBe(
      'env-token',
    );
  });

  it('throws a clear, secret-free error when neither source has a token', () => {
    let error: Error | undefined;
    try {
      resolveApiToken({ keyringValue: null, envValue: undefined, service: SERVICE });
    } catch (err) {
      error = err as Error;
    }
    expect(error, 'expected resolveApiToken to throw').toBeInstanceOf(Error);
    const message = (error as Error).message;
    // Actionable guidance: names both sources + how to change the service.
    expect(message).toContain('OS keyring');
    expect(message).toContain(SERVICE);
    expect(message).toContain('LEXWARE_API_TOKEN');
    expect(message).toContain('LEXWARE_KEYRING_SERVICE');
    expect(message).toContain('https://app.lexware.de/addons/public-api');
    // Never echoes a secret-shaped value.
    expect(message).not.toContain('keyring-token');
    expect(message).not.toContain('env-token');
    expect(message).not.toContain('lexware.io');
  });

  it('reflects a custom keyring service name in the error message', () => {
    expect(() =>
      resolveApiToken({ keyringValue: null, envValue: null, service: 'my-company' }),
    ).toThrow('my-company');
  });
});
