import { describe, it, expect, vi, beforeEach } from 'vitest';
import { z } from 'zod';
import { registerAndCapture, getTool, expectRequest } from './_helpers.js';

const { mockLexwareRequest, mockLexwareUpload } = vi.hoisted(() => ({
  mockLexwareRequest: vi.fn(),
  mockLexwareUpload: vi.fn(),
}));

vi.mock('../../services/lexware.js', () => ({
  lexwareRequest: mockLexwareRequest,
  lexwareDownload: vi.fn(),
  lexwareUpload: mockLexwareUpload,
}));

async function loadAndRegister() {
  const { registerVoucherTools } = await import('../../tools/vouchers.js');
  return registerAndCapture(registerVoucherTools as (s: unknown) => void);
}

describe('vouchers tool registry', () => {
  beforeEach(() => {
    mockLexwareRequest.mockReset();
    mockLexwareUpload.mockReset();
  });

  it('registers exactly the expected 6 voucher tools', async () => {
    const tools = await loadAndRegister();
    expect([...tools.keys()].sort()).toEqual([
      'lexware_create_voucher',
      'lexware_deeplink_voucher',
      'lexware_get_voucher',
      'lexware_list_vouchers',
      'lexware_update_voucher',
      'lexware_upload_voucher_file',
    ]);
  });

  describe('lexware_create_voucher', () => {
    it('POSTs /vouchers with body', async () => {
      mockLexwareRequest.mockResolvedValue({ id: 'v-1', version: 0 });
      const tools = await loadAndRegister();
      const create = getTool(tools, 'lexware_create_voucher');
      const body = {
        type: 'salesinvoice',
        voucherNumber: 'RG-001',
        voucherDate: '2026-01-01T00:00:00.000+01:00',
        totalGrossAmount: 119,
        totalTaxAmount: 19,
        taxType: 'net',
        voucherItems: [],
      };
      await create.handler({ body });
      expect(mockLexwareRequest).toHaveBeenCalledExactlyOnceWith(
        'POST',
        '/vouchers',
        body,
      );
    });
  });

  describe('lexware_get_voucher', () => {
    it('GETs /vouchers/{id}', async () => {
      mockLexwareRequest.mockResolvedValue({ id: 'v-2' });
      const tools = await loadAndRegister();
      const get = getTool(tools, 'lexware_get_voucher');
      await get.handler({ id: 'v-2' });
      expect(mockLexwareRequest).toHaveBeenCalledExactlyOnceWith(
        'GET',
        '/vouchers/v-2',
      );
    });
  });

  describe('lexware_update_voucher', () => {
    it('PUTs /vouchers/{id} with version-bearing body for optimistic locking', async () => {
      mockLexwareRequest.mockResolvedValue({ id: 'v-3', version: 2 });
      const tools = await loadAndRegister();
      const update = getTool(tools, 'lexware_update_voucher');
      const body = { version: 1, type: 'salesinvoice', voucherItems: [] };
      await update.handler({ id: 'v-3', body });
      expect(mockLexwareRequest).toHaveBeenCalledExactlyOnceWith(
        'PUT',
        '/vouchers/v-3',
        body,
      );
    });

    it('surfaces a 429-exhaustion error, and a subsequent retry-success returns data normally', async () => {
      // The 429 retry policy lives in the axios interceptor inside
      // `services/lexware.ts` (covered in `retry-interceptor.test.ts` —
      // `lexware-client.test.ts` stubs `interceptors.response.use` with a
      // bare `vi.fn()`, so it never exercises the real interceptor). From
      // the tool's perspective, `lexwareRequest` either resolves with data
      // or rejects after MAX_RETRIES. Both outcomes are exercised here.
      mockLexwareRequest
        .mockRejectedValueOnce(new Error('Rate limit exceeded after maximum retries'))
        .mockResolvedValueOnce({ id: 'v-retry', version: 5 });
      const tools = await loadAndRegister();
      const update = getTool(tools, 'lexware_update_voucher');

      const errored = (await update.handler({
        id: 'v-retry',
        body: { version: 4 },
      })) as { isError?: boolean; content: Array<{ text: string }> };
      expect(errored.isError).toBe(true);
      expect(errored.content[0].text).toMatch(/Rate limit exceeded/);

      const ok = (await update.handler({
        id: 'v-retry',
        body: { version: 4 },
      })) as { structuredContent: { id: string; version: number } };
      expect(ok.structuredContent).toEqual({ id: 'v-retry', version: 5 });
    });
  });

  describe('lexware_list_vouchers', () => {
    it('GETs /vouchers with voucherNumber and pagination', async () => {
      // GOTCHA: This tool hand-picks the three params it forwards rather than
      // spreading `params` — assert all three arrive.
      mockLexwareRequest.mockResolvedValue({ content: [] });
      const tools = await loadAndRegister();
      const list = getTool(tools, 'lexware_list_vouchers');
      await list.handler({ page: 0, size: 100, voucherNumber: 'RG-001' });
      expectRequest(mockLexwareRequest, {
        method: 'GET',
        url: '/vouchers',
        body: undefined,
        params: { page: 0, size: 100, voucherNumber: 'RG-001' },
      });
    });

    // GET /vouchers answers 400 "voucherNumber parameter is required" without it —
    // confirmed against the live API. The old optional param let a caller make a
    // request that could only ever fail, so the schema now refuses it up front.
    it('requires voucherNumber, and still exposes no client-side filters', async () => {
      const tools = await loadAndRegister();
      const list = getTool(tools, 'lexware_list_vouchers');
      const jsonSchema = z.toJSONSchema(z.object(list.schemaShape as z.ZodRawShape), { io: 'input' }) as {
        properties?: Record<string, unknown>;
        required?: string[];
      };
      expect(jsonSchema.required).toContain('voucherNumber');
      // Browsing and filtering moved to /voucherlist, the endpoint that supports
      // them and supplies contactName/openAmount.
      for (const gone of ['voucherStatus', 'contactName', 'hasOpenAmount', 'voucherDateFrom']) {
        expect(jsonSchema.properties).not.toHaveProperty(gone);
      }
    });
  });

  describe('lexware_upload_voucher_file', () => {
    it('routes through lexwareUpload (NOT lexwareRequest) with /vouchers/{id}/files path', async () => {
      mockLexwareUpload.mockResolvedValue({ id: 'file-1' });
      const tools = await loadAndRegister();
      const upload = getTool(tools, 'lexware_upload_voucher_file');
      await upload.handler({
        id: 'v-up',
        fileName: 'receipt.pdf',
        contentBase64: Buffer.from('hello').toString('base64'),
        contentType: 'application/pdf',
      });
      expect(mockLexwareRequest).not.toHaveBeenCalled();
      expect(mockLexwareUpload).toHaveBeenCalledExactlyOnceWith(
        '/vouchers/v-up/files',
        expect.any(Buffer),
        'receipt.pdf',
        'application/pdf',
      );
      // Verify the buffer is the decoded base64, not the raw string.
      const [, buffer] = mockLexwareUpload.mock.calls[0];
      expect((buffer as Buffer).toString()).toBe('hello');
    });

    it('defaults contentType to application/pdf when omitted', async () => {
      mockLexwareUpload.mockResolvedValue({ id: 'file-2' });
      const tools = await loadAndRegister();
      const upload = getTool(tools, 'lexware_upload_voucher_file');
      await upload.handler({
        id: 'v-up',
        fileName: 'note.pdf',
        contentBase64: 'Zm9v', // "foo"
      });
      expect(mockLexwareUpload).toHaveBeenCalledExactlyOnceWith(
        '/vouchers/v-up/files',
        expect.any(Buffer),
        'note.pdf',
        'application/pdf',
      );
    });
  });

  describe('lexware_deeplink_voucher', () => {
    it('returns a /permalink/vouchers/edit/{id} URL without hitting the API', async () => {
      const tools = await loadAndRegister();
      const deeplink = getTool(tools, 'lexware_deeplink_voucher');
      const result = (await deeplink.handler({ voucherId: 'v-7' })) as {
        structuredContent: { deeplink: string };
      };
      expect(result.structuredContent.deeplink).toBe(
        'https://app.lexware.de/permalink/vouchers/edit/v-7',
      );
      expect(mockLexwareRequest).not.toHaveBeenCalled();
    });
  });
});
