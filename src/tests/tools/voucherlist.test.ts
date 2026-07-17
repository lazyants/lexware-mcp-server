import { describe, it, expect, vi, beforeEach } from 'vitest';
import { z } from 'zod';
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
      // breaking real users. Asserted through the zod schema (not the raw
      // handler) so it genuinely exercises comma-separation and verbatim
      // preservation, rather than the trivially-passing 'any' wildcard.
      const tools = await loadAndRegister();
      const list = getTool(tools, 'lexware_list_voucherlist');
      const schema = z.object(list.schemaShape as z.ZodRawShape);
      expect(schema.parse({ voucherType: 'invoice,creditnote' }).voucherType).toBe('invoice,creditnote');
    });

    describe('mandatory voucherType/voucherStatus defaults (#61)', () => {
      // The Lexware API requires BOTH voucherType and voucherStatus on every
      // /voucherlist request, but the service layer's stripUndefined() drops
      // any key omitted by the caller — so a `.optional()` field would never
      // reach the query string and a parameterless call would 400.
      //
      // registerAndCapture invokes the handler directly and never parses
      // through zod, so these assertions build a real ZodObject from the
      // captured `schemaShape` and parse through IT, proving the MCP SDK's
      // own validation step (which runs zod's `.default()`) actually fills
      // in the wildcard — a handler-level assertion would pass equally for
      // a buggy runtime `?? 'any'` fallback.
      let schema: z.ZodObject<z.ZodRawShape>;

      beforeEach(async () => {
        const tools = await loadAndRegister();
        const list = getTool(tools, 'lexware_list_voucherlist');
        schema = z.object(list.schemaShape as z.ZodRawShape);
      });

      it('defaults both filters to "any" on a parameterless call', () => {
        const parsed = schema.parse({});
        expect(parsed.voucherType).toBe('any');
        expect(parsed.voucherStatus).toBe('any');
      });

      it('defaults both filters to "any" when only an unrelated param (contactId) is passed', () => {
        const parsed = schema.parse({ contactId: '745f3319-f473-4d55-9943-fecd942fd76d' });
        expect(parsed.voucherType).toBe('any');
        expect(parsed.voucherStatus).toBe('any');
      });

      it('defaults the omitted filter to "any" while preserving the explicitly-passed one verbatim', () => {
        const parsed = schema.parse({ voucherType: 'invoice,creditnote' });
        expect(parsed.voucherType).toBe('invoice,creditnote');
        expect(parsed.voucherStatus).toBe('any');
      });

      it('emits default:"any" on both filters in the tools/list JSON schema, with neither required', () => {
        const jsonSchema = z.toJSONSchema(schema, { io: 'input' }) as {
          properties?: Record<string, { default?: unknown }>;
          required?: string[];
        };
        expect(jsonSchema.properties?.voucherType?.default).toBe('any');
        expect(jsonSchema.properties?.voucherStatus?.default).toBe('any');
        expect(jsonSchema.required ?? []).not.toContain('voucherType');
        expect(jsonSchema.required ?? []).not.toContain('voucherStatus');
      });
    });
  });
});
