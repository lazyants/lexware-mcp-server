import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { lexwareRequest, lexwareUpload } from '../services/lexware.js';
import { handleToolRequest } from '../helpers.js';
import { UuidSchema, PaginationParams } from '../schemas/common.js';

export function registerVoucherTools(server: McpServer): void {
  server.registerTool('lexware_create_voucher', {
    title: 'Create Voucher',
    description: 'Create a new bookkeeping voucher in Lexware.',
    inputSchema: z.object({
      body: z.record(z.unknown()).describe(
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
      body: z.record(z.unknown()).describe('Voucher JSON with version field for optimistic locking'),
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
      voucherStatus: z.string().optional().describe('Filter by voucher status'),
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
      voucherStatus: params.voucherStatus,
    });
  }));

  server.registerTool('lexware_upload_voucher_file', {
    title: 'Upload Voucher File',
    description: 'Upload a file attachment to a bookkeeping voucher.',
    inputSchema: z.object({
      id: UuidSchema.describe('Voucher UUID'),
      fileName: z.string().describe('Name of the file to upload'),
      contentBase64: z.string().describe('Base64-encoded file content'),
      contentType: z.string().optional().describe('MIME type, defaults to application/pdf'),
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
}
