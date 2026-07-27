import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { lexwareRequest, lexwareUpload } from '../services/lexware.js';
import { handleToolRequest, withProcessingRetry, isNotFound } from '../helpers.js';
import { UuidSchema, PaginationParams, MimeTypeSchema } from '../schemas/common.js';
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
      return await withProcessingRetry(async () => {
        const voucher = await lexwareRequest<Record<string, unknown>>('GET', `/vouchers/${params.id}`);
        return normalizeVoucherResponse(voucher);
      });
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
    title: 'List Vouchers',
    description: 'List bookkeeping vouchers from Lexware with optional filters.',
    inputSchema: z.object({
      ...PaginationParams,
      voucherNumber: z.string().optional().describe('Filter by voucher number'),
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
