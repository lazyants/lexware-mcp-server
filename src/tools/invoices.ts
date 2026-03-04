import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { lexwareRequest, lexwareDownload } from '../services/lexware.js';
import { handleToolRequest } from '../helpers.js';
import { UuidSchema, VersionParam } from '../schemas/common.js';

export function registerInvoiceTools(server: McpServer): void {
  server.registerTool('lexware_create_invoice', {
    title: 'Create Invoice',
    description: 'Create a new invoice in Lexware.',
    inputSchema: z.object({
      body: z.record(z.unknown()).describe(
        'Invoice JSON body. Key fields: voucherDate, address (object with contactId or manual fields), lineItems (array with name, quantity, unitPrice, etc.), totalPrice (object), taxConditions (object). See Lexware API docs for full schema.'
      ),
    }),
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
  }, handleToolRequest(async (params) => {
    return lexwareRequest('POST', '/invoices', params.body);
  }));

  server.registerTool('lexware_get_invoice', {
    title: 'Get Invoice',
    description: 'Retrieve an invoice by ID from Lexware.',
    inputSchema: z.object({
      id: UuidSchema.describe('Invoice UUID'),
    }),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  }, handleToolRequest(async (params) => {
    return lexwareRequest('GET', `/invoices/${params.id}`);
  }));

  server.registerTool('lexware_download_invoice_file', {
    title: 'Download Invoice File',
    description: 'Download the PDF file for an invoice.',
    inputSchema: z.object({
      id: UuidSchema.describe('Invoice UUID'),
    }),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  }, handleToolRequest(async (params) => {
    const file = await lexwareDownload(`/invoices/${params.id}/file`);
    return {
      fileName: file.fileName || 'invoice.pdf',
      contentType: file.contentType,
      contentBase64: file.data.toString('base64'),
    };
  }));

  server.registerTool('lexware_finalize_invoice', {
    title: 'Finalize Invoice',
    description: 'Finalize an invoice, locking it from further edits.',
    inputSchema: z.object({
      id: UuidSchema.describe('Invoice UUID'),
      ...VersionParam,
    }),
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
  }, handleToolRequest(async (params) => {
    return lexwareRequest('POST', `/invoices/${params.id}/actions/finalize`, undefined, { version: params.version });
  }));

  server.registerTool('lexware_pursue_invoice', {
    title: 'Pursue Invoice',
    description: 'Transition an invoice from draft to open/pending status.',
    inputSchema: z.object({
      id: UuidSchema.describe('Invoice UUID'),
      ...VersionParam,
    }),
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
  }, handleToolRequest(async (params) => {
    return lexwareRequest('POST', `/invoices/${params.id}/actions/pursue`, undefined, { version: params.version });
  }));

  server.registerTool('lexware_deeplink_invoice', {
    title: 'Deeplink to Invoice',
    description: 'Get a direct link to view/edit an invoice in the Lexware web app.',
    inputSchema: z.object({
      id: UuidSchema.describe('Invoice UUID'),
    }),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  }, handleToolRequest(async (params) => {
    return { deeplink: `https://app.lexware.io/permalink/invoices/edit/${params.id}` };
  }));
}
