import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { lexwareRequest, lexwareDownload } from '../services/lexware.js';
import { handleToolRequest } from '../helpers.js';
import { UuidSchema, DownloadFormat, downloadAccept, downloadFallbackName } from '../schemas/common.js';
import { LEXWARE_APP_BASE } from '../constants.js';

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
    description:
      'Download the file for a down payment invoice. Defaults to PDF; pass format="xml" to request ' +
      'the XRechnung XML e-invoice when available (the API returns whatever representation it can render).',
    inputSchema: z.object({
      id: UuidSchema.describe('Down payment invoice UUID'),
      format: DownloadFormat,
    }),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  }, handleToolRequest(async (params) => {
    const file = await lexwareDownload(`/down-payment-invoices/${params.id}/file`, downloadAccept(params.format));
    return {
      fileName: file.fileName || downloadFallbackName('down-payment-invoice', file.contentType),
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
    // DPIs deliberately reuse the invoices permalink route — Lexware docs give no
    // permalink/down-payment-invoices/… route.
    return { deeplink: `${LEXWARE_APP_BASE}/permalink/invoices/edit/${params.id}` };
  }));
}
