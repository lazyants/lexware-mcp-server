import { describe, it, expect, vi, beforeEach } from 'vitest';
import { registerAndCapture, getTool } from './_helpers.js';

const { mockLexwareRequest } = vi.hoisted(() => ({
  mockLexwareRequest: vi.fn(),
}));

vi.mock('../../services/lexware.js', () => ({
  lexwareRequest: mockLexwareRequest,
  lexwareDownload: vi.fn(),
}));

async function loadAndRegister() {
  const { registerVoucherlistTools } = await import('../../tools/voucherlist.js');
  return registerAndCapture(registerVoucherlistTools as (s: unknown) => void);
}

describe('voucherlist tool registry', () => {
  beforeEach(() => {
    mockLexwareRequest.mockReset();
  });

  it('registers exactly the single list_voucherlist tool', async () => {
    const tools = await loadAndRegister();
    expect([...tools.keys()].sort()).toEqual(['lexware_list_voucherlist']);
  });

  describe('lexware_list_voucherlist', () => {
    it('GETs /voucherlist and forwards ALL filter params verbatim as query string', async () => {
      // The tool spreads the entire params object into the query string — no
      // server-side renaming, no validation beyond zod's surface type. The
      // services layer strips undefined keys, but the raw shape here must
      // be exactly what the user passed.
      mockLexwareRequest.mockResolvedValue({ content: [] });
      const tools = await loadAndRegister();
      const list = getTool(tools, 'lexware_list_voucherlist');
      const params = {
        page: 0,
        size: 50,
        voucherType: 'invoice,creditnote',
        voucherStatus: 'open,overdue',
        contactId: '745f3319-f473-4d55-9943-fecd942fd76d',
        voucherDateFrom: '2026-01-01',
        voucherDateTo: '2026-03-31',
        archived: false,
      };
      await list.handler(params);
      expect(mockLexwareRequest).toHaveBeenCalledExactlyOnceWith(
        'GET',
        '/voucherlist',
        undefined,
        params,
      );
    });

    it('accepts comma-separated voucherType values without enum validation', async () => {
      // Regression guard for the in-source GOTCHA comment: voucherType is
      // intentionally `z.string()` not `z.enum()` because Lexware accepts
      // comma-separated values and adds new types (e.g. purchaseinvoice).
      // Locking this in as a test ensures a future refactor that "tightens"
      // the schema to z.enum will break this test instead of silently
      // breaking real users.
      mockLexwareRequest.mockResolvedValue({ content: [] });
      const tools = await loadAndRegister();
      const list = getTool(tools, 'lexware_list_voucherlist');
      await list.handler({ voucherType: 'any' });
      expect(mockLexwareRequest).toHaveBeenCalledExactlyOnceWith(
        'GET',
        '/voucherlist',
        undefined,
        { voucherType: 'any' },
      );
    });
  });
});
