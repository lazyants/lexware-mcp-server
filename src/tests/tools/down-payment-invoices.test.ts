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
  const { registerDownPaymentInvoiceTools } = await import('../../tools/down-payment-invoices.js');
  return registerAndCapture(registerDownPaymentInvoiceTools as (s: unknown) => void);
}

describe('down-payment-invoices tool registry', () => {
  beforeEach(() => {
    mockLexwareRequest.mockReset();
    mockLexwareDownload.mockReset();
  });

  it('registers exactly the expected 3 down-payment-invoice tools (no create/pursue — read-only resource)', async () => {
    const tools = await loadAndRegister();
    // Down-payment invoices are derived from invoices and not directly created
    // via this endpoint, so the tool surface is read-only + download + deeplink.
    expect([...tools.keys()].sort()).toEqual([
      'lexware_deeplink_down_payment_invoice',
      'lexware_download_down_payment_invoice_file',
      'lexware_get_down_payment_invoice',
    ]);
  });

  describe('lexware_get_down_payment_invoice', () => {
    it('GETs /down-payment-invoices/{id}', async () => {
      mockLexwareRequest.mockResolvedValue({ id: 'dpi-1' });
      const tools = await loadAndRegister();
      const get = getTool(tools, 'lexware_get_down_payment_invoice');
      await get.handler({ id: '745f3319-f473-4d55-9943-fecd942fd76d' });
      expect(mockLexwareRequest).toHaveBeenCalledExactlyOnceWith(
        'GET',
        '/down-payment-invoices/745f3319-f473-4d55-9943-fecd942fd76d',
      );
    });
  });

  describe('lexware_download_down_payment_invoice_file', () => {
    it('calls lexwareDownload with the file path and base64-encodes the bytes', async () => {
      mockLexwareDownload.mockResolvedValue({
        fileName: 'dpi.pdf',
        contentType: 'application/pdf',
        data: Buffer.from('DPI'),
      });
      const tools = await loadAndRegister();
      const dl = getTool(tools, 'lexware_download_down_payment_invoice_file');
      const result = (await dl.handler({ id: 'dpi-1' })) as {
        structuredContent: { fileName: string; contentType: string; contentBase64: string };
      };
      expect(mockLexwareDownload).toHaveBeenCalledExactlyOnceWith(
        '/down-payment-invoices/dpi-1/file',
        'application/pdf',
      );
      expect(result.structuredContent.fileName).toBe('dpi.pdf');
      expect(result.structuredContent.contentBase64).toBe(Buffer.from('DPI').toString('base64'));
    });

    it('falls back to "down-payment-invoice.pdf" when the service omits fileName', async () => {
      mockLexwareDownload.mockResolvedValue({
        fileName: undefined,
        contentType: 'application/pdf',
        data: Buffer.from('X'),
      });
      const tools = await loadAndRegister();
      const dl = getTool(tools, 'lexware_download_down_payment_invoice_file');
      const result = (await dl.handler({ id: 'dpi-2' })) as {
        structuredContent: { fileName: string };
      };
      expect(result.structuredContent.fileName).toBe('down-payment-invoice.pdf');
    });

    it('threads format="xml" to the application/xml Accept and yields down-payment-invoice.xml on XML contentType', async () => {
      mockLexwareDownload.mockResolvedValue({
        fileName: undefined,
        contentType: 'application/xml',
        data: Buffer.from('<xml/>'),
      });
      const tools = await loadAndRegister();
      const dl = getTool(tools, 'lexware_download_down_payment_invoice_file');
      const result = (await dl.handler({ id: 'dpi-x', format: 'xml' })) as {
        structuredContent: { fileName: string };
      };
      expect(mockLexwareDownload).toHaveBeenCalledExactlyOnceWith(
        '/down-payment-invoices/dpi-x/file',
        'application/xml',
      );
      expect(result.structuredContent.fileName).toBe('down-payment-invoice.xml');
    });
  });

  describe('lexware_deeplink_down_payment_invoice', () => {
    it('returns a /permalink/down-payment-invoices/edit URL without hitting the API', async () => {
      const tools = await loadAndRegister();
      const deeplink = getTool(tools, 'lexware_deeplink_down_payment_invoice');
      const result = (await deeplink.handler({ id: 'dpi-9' })) as {
        structuredContent: { deeplink: string };
      };
      expect(result.structuredContent.deeplink).toBe(
        'https://app.lexware.de/permalink/down-payment-invoices/edit/dpi-9',
      );
      expect(mockLexwareRequest).not.toHaveBeenCalled();
    });
  });
});
