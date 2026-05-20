import { describe, it, expect, vi, beforeEach } from 'vitest';
import { registerAndCapture, getTool } from './_helpers.js';

const { mockLexwareRequest, mockLexwareDownload } = vi.hoisted(() => ({
  mockLexwareRequest: vi.fn(),
  mockLexwareDownload: vi.fn(),
}));

vi.mock('../../services/lexware.js', () => ({
  lexwareRequest: mockLexwareRequest,
  lexwareDownload: mockLexwareDownload,
}));

async function loadAndRegister() {
  const { registerOrderConfirmationTools } = await import('../../tools/order-confirmations.js');
  return registerAndCapture(registerOrderConfirmationTools as (s: unknown) => void);
}

describe('order-confirmations tool registry', () => {
  beforeEach(() => {
    mockLexwareRequest.mockReset();
    mockLexwareDownload.mockReset();
  });

  it('registers exactly the expected 5 order-confirmation tools', async () => {
    const tools = await loadAndRegister();
    expect([...tools.keys()].sort()).toEqual([
      'lexware_create_order_confirmation',
      'lexware_deeplink_order_confirmation',
      'lexware_download_order_confirmation_file',
      'lexware_get_order_confirmation',
      'lexware_pursue_order_confirmation',
    ]);
  });

  describe('lexware_create_order_confirmation', () => {
    it('POSTs /order-confirmations with the body payload', async () => {
      mockLexwareRequest.mockResolvedValue({ id: 'oc-1', version: 1 });
      const tools = await loadAndRegister();
      const create = getTool(tools, 'lexware_create_order_confirmation');
      const body = { voucherDate: '2026-01-01', lineItems: [] };
      await create.handler({ body });
      expect(mockLexwareRequest).toHaveBeenCalledExactlyOnceWith(
        'POST',
        '/order-confirmations',
        body,
      );
    });
  });

  describe('lexware_get_order_confirmation', () => {
    it('GETs /order-confirmations/{id}', async () => {
      mockLexwareRequest.mockResolvedValue({ id: 'oc-1' });
      const tools = await loadAndRegister();
      const get = getTool(tools, 'lexware_get_order_confirmation');
      await get.handler({ id: '745f3319-f473-4d55-9943-fecd942fd76d' });
      expect(mockLexwareRequest).toHaveBeenCalledExactlyOnceWith(
        'GET',
        '/order-confirmations/745f3319-f473-4d55-9943-fecd942fd76d',
      );
    });
  });

  describe('lexware_download_order_confirmation_file', () => {
    it('calls lexwareDownload with the file path and base64-encodes the bytes', async () => {
      mockLexwareDownload.mockResolvedValue({
        fileName: 'oc.pdf',
        contentType: 'application/pdf',
        data: Buffer.from('OC'),
      });
      const tools = await loadAndRegister();
      const dl = getTool(tools, 'lexware_download_order_confirmation_file');
      const result = (await dl.handler({ id: 'oc-1' })) as {
        structuredContent: { fileName: string; contentType: string; contentBase64: string };
      };
      expect(mockLexwareDownload).toHaveBeenCalledExactlyOnceWith('/order-confirmations/oc-1/file');
      expect(result.structuredContent.fileName).toBe('oc.pdf');
      expect(result.structuredContent.contentBase64).toBe(Buffer.from('OC').toString('base64'));
    });

    it('falls back to "order-confirmation.pdf" when the service omits fileName', async () => {
      mockLexwareDownload.mockResolvedValue({
        fileName: undefined,
        contentType: 'application/pdf',
        data: Buffer.from('X'),
      });
      const tools = await loadAndRegister();
      const dl = getTool(tools, 'lexware_download_order_confirmation_file');
      const result = (await dl.handler({ id: 'oc-2' })) as {
        structuredContent: { fileName: string };
      };
      expect(result.structuredContent.fileName).toBe('order-confirmation.pdf');
    });
  });

  describe('lexware_pursue_order_confirmation', () => {
    it('POSTs /order-confirmations/{id}/actions/pursue with version query param', async () => {
      mockLexwareRequest.mockResolvedValue({ id: 'oc-1', version: 2 });
      const tools = await loadAndRegister();
      const pursue = getTool(tools, 'lexware_pursue_order_confirmation');
      await pursue.handler({ id: 'oc-1', version: 5 });
      expect(mockLexwareRequest).toHaveBeenCalledExactlyOnceWith(
        'POST',
        '/order-confirmations/oc-1/actions/pursue',
        undefined,
        { version: 5 },
      );
    });
  });

  describe('lexware_deeplink_order_confirmation', () => {
    it('returns a /permalink/order-confirmations/edit URL without hitting the API', async () => {
      const tools = await loadAndRegister();
      const deeplink = getTool(tools, 'lexware_deeplink_order_confirmation');
      const result = (await deeplink.handler({ id: 'oc-9' })) as {
        structuredContent: { deeplink: string };
      };
      expect(result.structuredContent.deeplink).toBe(
        'https://app.lexware.io/permalink/order-confirmations/edit/oc-9',
      );
      expect(mockLexwareRequest).not.toHaveBeenCalled();
    });
  });
});
