import { describe, it, expect } from 'vitest';
import { LEXWARE_API_BASE, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, MAX_RETRIES, REQUEST_TIMEOUT } from '../constants.js';

describe('constants', () => {
  it('has correct API base URL', () => {
    expect(LEXWARE_API_BASE).toBe('https://api.lexware.io/v1');
  });

  it('has correct default page size', () => {
    expect(DEFAULT_PAGE_SIZE).toBe(25);
  });

  it('has correct max page size', () => {
    expect(MAX_PAGE_SIZE).toBe(250);
  });

  it('has correct max retries', () => {
    expect(MAX_RETRIES).toBe(3);
  });

  it('has correct request timeout', () => {
    expect(REQUEST_TIMEOUT).toBe(30_000);
  });
});
