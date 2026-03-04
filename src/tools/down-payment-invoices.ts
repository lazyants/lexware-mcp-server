import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { lexwareRequest, lexwareDownload } from '../services/lexware.js';
import { handleToolRequest } from '../helpers.js';
import { UuidSchema } from '../schemas/common.js';

export function registerDownPaymentInvoiceTools(server: McpServer): void {
  server.registerTool('lexware_get_down_payment_invoice', {
    title: 'Get Down Payment Invoice',
    description: 'Retrieve a down payment invoice by ID from Lexware.',
    inputSchema: z.object({
      id: UuidSchema.describe('Down payment invoice UUID'),
    }),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  }, handleToolRequest(async (params) => {
    return lexwareRequest('GET', `/down-payment-invoices/${params.id}`);
  }));

  server.registerTool('lexware_download_down_payment_invoice_file', {
    title: 'Download Down Payment Invoice File',
    description: 'Download the PDF file for a down payment invoice.',
    inputSchema: z.object({
      id: UuidSchema.describe('Down payment invoice UUID'),
    }),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  }, handleToolRequest(async (params) => {
    const file = await lexwareDownload(`/down-payment-invoices/${params.id}/file`);
    return {
      fileName: file.fileName || 'down-payment-invoice.pdf',
      contentType: file.contentType,
      contentBase64: file.data.toString('base64'),
    };
  }));

  server.registerTool('lexware_deeplink_down_payment_invoice', {
    title: 'Deeplink to Down Payment Invoice',
    description: 'Get a direct link to view/edit a down payment invoice in the Lexware web app.',
    inputSchema: z.object({
      id: UuidSchema.describe('Down payment invoice UUID'),
    }),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  }, handleToolRequest(async (params) => {
    return { deeplink: `https://app.lexware.io/permalink/down-payment-invoices/edit/${params.id}` };
  }));
}
