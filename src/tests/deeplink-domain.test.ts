import { describe, expect, it } from 'vitest';
import { LEXWARE_APP_BASE } from '../constants.js';

// Regression guard for the deeplink-domain bug (PR #39): permalinks must point
// at the Lexware *web app* host `app.lexware.de`, never the legacy/wrong
// `app.lexware.io`. The host is a single constant (`LEXWARE_APP_BASE`) consumed
// by every deeplink tool, so pinning the constant covers all call sites without
// re-asserting each tool's own URL-building logic (that belongs to each tool's
// own test file — e.g. `tools/invoices.test.ts`'s `lexware_deeplink_invoice`
// test). The API gateway (`api.lexware.io`) is a SEPARATE host and is
// intentionally not asserted here.

describe('deeplink domain (regression: app.lexware.de, never app.lexware.io)', () => {
  it('pins the web-app base to https://app.lexware.de', () => {
    expect(LEXWARE_APP_BASE).toBe('https://app.lexware.de');
    expect(LEXWARE_APP_BASE).not.toContain('lexware.io');
  });
});
