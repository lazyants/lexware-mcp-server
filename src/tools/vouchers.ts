import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { lexwareRequest, lexwareUpload } from '../services/lexware.js';
import { handleToolRequest, withProcessingRetry, isNotFound } from '../helpers.js';
import { UuidSchema, MimeTypeSchema, PaginationParams } from '../schemas/common.js';
import { LEXWARE_APP_BASE } from '../constants.js';
import { VOUCHER_STATUSES, normalizeVoucherResponse } from './_vouchers.js';

export function registerVoucherTools(server: McpServer): void {
  server.registerTool('lexware_create_voucher', {
    title: 'Create Voucher',
    description: 'Create a new bookkeeping voucher in Lexware.',
    inputSchema: z.object({
      body: z.record(z.string(), z.unknown()).describe(
        'Voucher JSON. Key fields: type ("salesinvoice"|"salescreditnote"|"purchaseinvoice"|"purchasecreditnote"), voucherNumber, voucherDate, totalGrossAmount, totalTaxAmount, taxType, voucherItems (array), contactId'
      ),
    }),
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
  }, handleToolRequest(async (params) => {
    return lexwareRequest('POST', '/vouchers', params.body);
  }));

  server.registerTool('lexware_get_voucher', {
    title: 'Get Voucher',
    description:
      'Retrieve a bookkeeping voucher by ID from Lexware. The voucherStatus field in the ' +
      'response is normalized to its canonical lowercase form. Known values: ' +
      `${VOUCHER_STATUSES.join(', ')}. ` +
      'Retries up to 3 times (1 s / 2 s / 4 s) on 404 to absorb the indexing delay after an ' +
      'upload; if the voucher is still missing, returns { voucherId, status: "processing", ' +
      'message } rather than an error. Other failures are reported as errors.',
    inputSchema: z.object({
      id: UuidSchema.describe('Voucher UUID'),
    }),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  }, handleToolRequest(async (params) => {
    try {
      // Normalize AFTER the retry, never inside it. Lexware answers `null` during the
      // indexing window, and normalizing in the retried callback dereferenced that
      // null — throwing a TypeError that isNotFound() rightly rejects, so the empty-
      // response branch of withProcessingRetry could never fire and the caller got a
      // crash instead of a retry.
      const voucher = await withProcessingRetry(
        () => lexwareRequest<Record<string, unknown> | null>('GET', `/vouchers/${params.id}`),
      );
      // Retries can still legitimately end on an empty body; pass it through rather
      // than inventing a shape for it.
      return voucher && typeof voucher === 'object' ? normalizeVoucherResponse(voucher) : voucher;
    } catch (err) {
      // ONLY an exhausted 404 becomes the soft "processing" answer. Reporting a 401
      // or a 500 as "still processing" would tell the caller to wait for something
      // that is never going to arrive, and hide the real fault — so rethrow and let
      // handleToolRequest surface it as a tool error.
      if (!isNotFound(err)) throw err;
      return {
        voucherId: params.id as string,
        status: 'processing',
        message: 'Voucher is still being processed by Lexware — please retry in 30 seconds.',
      };
    }
  }));

  server.registerTool('lexware_update_voucher', {
    title: 'Update Voucher',
    description: 'Update an existing bookkeeping voucher in Lexware. Requires version field for optimistic locking.',
    inputSchema: z.object({
      id: UuidSchema.describe('Voucher UUID'),
      body: z.record(z.string(), z.unknown()).describe('Voucher JSON with version field for optimistic locking'),
    }),
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  }, handleToolRequest(async (params) => {
    return lexwareRequest('PUT', `/vouchers/${params.id}`, params.body);
  }));

  server.registerTool('lexware_list_vouchers', {
    title: 'Look Up Vouchers by Number',
    description:
      'Look up bookkeeping vouchers by voucher number. GET /vouchers is a LOOKUP endpoint, not a ' +
      'browsable collection: the Lexware API rejects any call without voucherNumber with ' +
      'HTTP 400 "voucherNumber parameter is required". To browse or filter vouchers, use ' +
      'lexware_list_voucherlist, which is the collection endpoint and carries the summary ' +
      'fields (contactName, openAmount) that /vouchers does not.',
    inputSchema: z.object({
      ...PaginationParams,
      voucherNumber: z.string().describe(
        'Voucher number to look up. REQUIRED — the API returns 400 without it.'
      ),
    }),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  }, handleToolRequest(async (params) => {
    return lexwareRequest('GET', '/vouchers', undefined, {
      page: params.page,
      size: params.size,
      voucherNumber: params.voucherNumber,
    });
  }));

  server.registerTool('lexware_upload_voucher_file', {
    title: 'Upload Voucher File',
    description: 'Upload a file attachment to a bookkeeping voucher.',
    inputSchema: z.object({
      id: UuidSchema.describe('Voucher UUID'),
      fileName: z.string().describe('Name of the file to upload'),
      contentBase64: z.string().describe('Base64-encoded file content'),
      contentType: MimeTypeSchema.optional(),
    }),
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
  }, handleToolRequest(async (params) => {
    const buffer = Buffer.from(params.contentBase64, 'base64');
    return lexwareUpload(`/vouchers/${params.id}/files`, buffer, params.fileName, params.contentType || 'application/pdf');
  }));

  server.registerTool('lexware_deeplink_voucher', {
    title: 'Deeplink to Voucher',
    description: 'Get a direct link to view/edit a bookkeeping voucher in the Lexware web app.',
    inputSchema: z.object({
      voucherId: UuidSchema.describe('Voucher UUID'),
    }),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  }, handleToolRequest(async (params) => {
    return { deeplink: `${LEXWARE_APP_BASE}/permalink/vouchers/edit/${params.voucherId}` };
  }));
}
