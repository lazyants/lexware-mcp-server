import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { lexwareRequest } from '../services/lexware.js';
import { handleToolRequest } from '../helpers.js';
import { UuidSchema, PaginationParams } from '../schemas/common.js';

export function registerVoucherlistTools(server: McpServer): void {
  server.registerTool('lexware_list_voucherlist', {
    title: 'List Voucherlist',
    description: 'Search and filter across all voucher types in Lexware. This is the main way to find invoices, credit notes, quotations, and other voucher types.',
    inputSchema: z.object({
      ...PaginationParams,
      // GOTCHA: Don't use z.enum() for API filter params — Lexware accepts comma-separated
      // values and has more types than initially documented (e.g. purchaseinvoice, purchasecreditnote).
      voucherType: z.string().optional().describe(
        'Voucher type(s), comma-separated or "any". Values: invoice, creditnote, orderconfirmation, quotation, deliverynote, downpaymentinvoice, dunning, purchaseinvoice, purchasecreditnote'
      ),
      voucherStatus: z.string().optional().describe(
        'Voucher status(es), comma-separated or "any". Values: draft, open, overdue, paid, paidoff, voided, accepted, rejected, unchecked'
      ),
      contactId: UuidSchema.optional().describe('Filter by contact UUID'),
      voucherDateFrom: z.string().optional().describe('Filter vouchers from date (ISO, e.g. "2024-01-01")'),
      voucherDateTo: z.string().optional().describe('Filter vouchers to date (ISO, e.g. "2024-12-31")'),
      voucherNumber: z.string().optional().describe('Filter by voucher number'),
      archived: z.boolean().optional().describe('Filter by archived status'),
      createdDateFrom: z.string().optional().describe('Filter by creation date from (yyyy-MM-dd)'),
      createdDateTo: z.string().optional().describe('Filter by creation date to (yyyy-MM-dd)'),
    }),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  }, handleToolRequest(async (params) => {
    return lexwareRequest('GET', '/voucherlist', undefined, params);
  }));
}
