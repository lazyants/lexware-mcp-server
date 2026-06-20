import { describe, expect, it } from 'vitest';
import { LEXWARE_APP_BASE } from '../constants.js';

// Regression guard for the deeplink-domain bug (PR #39): permalinks must point
// at the Lexware *web app* host `app.lexware.de`, never the legacy/wrong
// `app.lexware.io`. The host is a single constant (`LEXWARE_APP_BASE`) consumed
// by every deeplink tool, so asserting the constant + the two permalink shapes
// covers all call sites. The API gateway (`api.lexware.io`) is a SEPARATE host
// and is intentionally not asserted here.

describe('deeplink domain (regression: app.lexware.de, never app.lexware.io)', () => {
  it('pins the web-app base to https://app.lexware.de', () => {
    expect(LEXWARE_APP_BASE).toBe('https://app.lexware.de');
    expect(LEXWARE_APP_BASE).not.toContain('lexware.io');
  });

  it('builds a sales-voucher permalink with edit/ on app.lexware.de', () => {
    const url = `${LEXWARE_APP_BASE}/permalink/invoices/edit/abc-uuid`;
    expect(url).toBe('https://app.lexware.de/permalink/invoices/edit/abc-uuid');
    expect(url).not.toContain('lexware.io');
  });

  it('builds a contact permalink with view/ on app.lexware.de', () => {
    const url = `${LEXWARE_APP_BASE}/permalink/contacts/view/c-3`;
    expect(url).toBe('https://app.lexware.de/permalink/contacts/view/c-3');
    expect(url).not.toContain('lexware.io');
  });

  it('builds a voucher permalink with edit/{id} on app.lexware.de', () => {
    const url = `${LEXWARE_APP_BASE}/permalink/vouchers/edit/v-9`;
    expect(url).toBe('https://app.lexware.de/permalink/vouchers/edit/v-9');
    expect(url).not.toContain('lexware.io');
  });

  it('builds a recurring-template permalink with edit/{id} on app.lexware.de', () => {
    const url = `${LEXWARE_APP_BASE}/permalink/recurring-templates/edit/rt-2`;
    expect(url).toBe('https://app.lexware.de/permalink/recurring-templates/edit/rt-2');
    expect(url).not.toContain('lexware.io');
  });

  it('builds the files-inbox permalink WITHOUT a trailing id (documented idless exception)', () => {
    // Lexware docs define `/permalink/files/view` as the bookkeeping inbox of
    // newly-uploaded files, not a per-file link — so it carries no id segment.
    // Lock the idless shape so a later refactor cannot "fix" it by appending one.
    const url = `${LEXWARE_APP_BASE}/permalink/files/view`;
    expect(url).toBe('https://app.lexware.de/permalink/files/view');
    expect(url).not.toMatch(/\/permalink\/files\/view\/.+/);
    expect(url).not.toContain('lexware.io');
  });
});
