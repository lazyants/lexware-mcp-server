import { describe, it, expect } from 'vitest';
import { LEXWARE_APP_BASE } from '../constants.js';

// The other constants (LEXWARE_API_BASE, MAX_PAGE_SIZE, MAX_RETRIES,
// REQUEST_TIMEOUT) previously had tautological "equals its own literal" tests
// here that would never catch a real regression on their own — a wrong value
// breaks whatever depends on it, which is tested where it's used. LEXWARE_APP_BASE
// is different: it's a genuine regression guard for the `.de`/`.io` domain mixup
// (the API gateway is `api.lexware.io`, the web app used for deeplinks and the
// token page is `app.lexware.de`), so it stays pinned here directly.
describe('constants', () => {
  it('has correct web app base URL', () => {
    expect(LEXWARE_APP_BASE).toBe('https://app.lexware.de');
  });
});
