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
  const { registerPaymentConditionTools } = await import('../../tools/payment-conditions.js');
  return registerAndCapture(registerPaymentConditionTools as (s: unknown) => void);
}

describe('payment-conditions tool registry', () => {
  beforeEach(() => {
    mockLexwareRequest.mockReset();
  });

  it('registers exactly the single list_payment_conditions tool', async () => {
    const tools = await loadAndRegister();
    expect([...tools.keys()].sort()).toEqual(['lexware_list_payment_conditions']);
  });

  describe('lexware_list_payment_conditions', () => {
    it('GETs /payment-conditions with no body and no query params', async () => {
      // This endpoint is a global enumeration — no pagination, no filters.
      mockLexwareRequest.mockResolvedValue([
        { id: 'pc-1', paymentTermLabel: 'Net 14', paymentTermDuration: 14 },
      ]);
      const tools = await loadAndRegister();
      const list = getTool(tools, 'lexware_list_payment_conditions');
      await list.handler({});
      expect(mockLexwareRequest).toHaveBeenCalledExactlyOnceWith(
        'GET',
        '/payment-conditions',
      );
    });

    it('returns the array payload as JSON text without structuredContent', async () => {
      // GOTCHA from `formatResponse`: the MCP SDK rejects arrays in `structuredContent`.
      // Array payloads must surface in `content[0].text` as the stringified JSON only.
      const payload = [
        { id: 'pc-1', paymentTermLabel: 'Net 14' },
        { id: 'pc-2', paymentTermLabel: 'Net 30' },
      ];
      mockLexwareRequest.mockResolvedValue(payload);
      const tools = await loadAndRegister();
      const list = getTool(tools, 'lexware_list_payment_conditions');
      const result = (await list.handler({})) as {
        content: Array<{ type: string; text: string }>;
        structuredContent?: unknown;
      };
      expect(result.content[0].type).toBe('text');
      expect(JSON.parse(result.content[0].text)).toEqual(payload);
      expect(result.structuredContent).toBeUndefined();
    });
  });
});
