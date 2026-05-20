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
  const { registerPaymentTools } = await import('../../tools/payments.js');
  return registerAndCapture(registerPaymentTools as (s: unknown) => void);
}

describe('payments tool registry', () => {
  beforeEach(() => {
    mockLexwareRequest.mockReset();
  });

  it('registers exactly the single read-only payments tool', async () => {
    const tools = await loadAndRegister();
    expect([...tools.keys()].sort()).toEqual(['lexware_get_payments']);
  });

  describe('lexware_get_payments', () => {
    it('GETs /payments/{voucherId} — note: voucher UUID, not a payment id', async () => {
      // The Lexware API exposes payment details *per voucher*: GET /v1/payments/{voucherId}.
      // The `id` param therefore identifies the voucher (invoice/credit-note/etc.),
      // not a standalone payment record.
      mockLexwareRequest.mockResolvedValue({
        openAmount: 0,
        paymentStatus: 'paid',
        paidDate: '2026-01-15',
      });
      const tools = await loadAndRegister();
      const get = getTool(tools, 'lexware_get_payments');
      await get.handler({ id: '745f3319-f473-4d55-9943-fecd942fd76d' });
      expect(mockLexwareRequest).toHaveBeenCalledExactlyOnceWith(
        'GET',
        '/payments/745f3319-f473-4d55-9943-fecd942fd76d',
      );
    });

    it('returns the payment status payload as structuredContent', async () => {
      const payload = { openAmount: 50, paymentStatus: 'open' };
      mockLexwareRequest.mockResolvedValue(payload);
      const tools = await loadAndRegister();
      const get = getTool(tools, 'lexware_get_payments');
      const result = (await get.handler({ id: 'voucher-1' })) as {
        structuredContent: typeof payload;
      };
      expect(result.structuredContent).toEqual(payload);
    });
  });
});
