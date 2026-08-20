import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { lexwareRequest, lexwareUpload } from '../services/lexware.js';
import { handleToolRequest } from '../helpers.js';
import { UuidSchema, PaginationParams } from '../schemas/common.js';
import { LEXWARE_APP_BASE } from '../constants.js';
import { uploadInputSchema, resolveUpload } from './_upload.js';

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
    description: 'Retrieve a bookkeeping voucher by ID from Lexware.',
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
    return lexwareRequest('GET', `/vouchers/${params.id}`);
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
    description:
      'Upload a file attachment to a bookkeeping voucher. Provide either filePath (absolute path ' +
      'on the MCP server host) or contentBase64 (base64-encoded content) — not both. When using ' +
      'filePath, fileName is optional (derived from the file name) and contentType is auto-detected ' +
      'for common image extensions. When using contentBase64, fileName is required.',
    inputSchema: uploadInputSchema({
      id: UuidSchema.describe('Voucher UUID'),
    }),
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
  }, handleToolRequest(async (params) => {
    const { buffer, fileName, contentType } = resolveUpload(params);
    return lexwareUpload(`/vouchers/${params.id}/files`, buffer, fileName, contentType);
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
