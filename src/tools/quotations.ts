import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { lexwareRequest, lexwareDownload } from '../services/lexware.js';
import { handleToolRequest } from '../helpers.js';
import { UuidSchema, DownloadFormat, downloadAccept, downloadFallbackName } from '../schemas/common.js';
import { LEXWARE_APP_BASE } from '../constants.js';

export function registerQuotationTools(server: McpServer): void {
  server.registerTool('lexware_create_quotation', {
    title: 'Create Quotation',
    description: 'Create a new quotation in Lexware.',
    inputSchema: z.object({
      body: z.record(z.string(), z.unknown()).describe(
        'Quotation JSON body. Key fields: voucherDate, expirationDate, address (object with contactId or manual fields), lineItems (array with name, quantity, unitPrice, etc.), totalPrice (object), taxConditions (object). See Lexware API docs for full schema.'
      ),
    }),
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
  }, handleToolRequest(async (params) => {
    return lexwareRequest('POST', '/quotations', params.body);
  }));

  server.registerTool('lexware_get_quotation', {
    title: 'Get Quotation',
    description: 'Retrieve a quotation by ID from Lexware.',
    inputSchema: z.object({
      id: UuidSchema.describe('Quotation UUID'),
    }),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  }, handleToolRequest(async (params) => {
    return lexwareRequest('GET', `/quotations/${params.id}`);
  }));

  server.registerTool('lexware_download_quotation_file', {
    title: 'Download Quotation File',
    description:
      'Download the file for a quotation. Defaults to PDF; pass format="xml" to request the XML ' +
      'representation when available (the API returns whatever representation it can render).',
    inputSchema: z.object({
      id: UuidSchema.describe('Quotation UUID'),
      format: DownloadFormat,
    }),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  }, handleToolRequest(async (params) => {
    const file = await lexwareDownload(`/quotations/${params.id}/file`, downloadAccept(params.format));
    return {
      fileName: file.fileName || downloadFallbackName('quotation', file.contentType),
      contentType: file.contentType,
      contentBase64: file.data.toString('base64'),
    };
  }));

  // NOTE: lexware_pursue_quotation was removed because quotations are the start
  // of the Lexware sales-voucher document chain and have no preceding voucher.
  // The Lexware API documents no `Pursue to a Quotation` endpoint, and the prior
  // implementation hit an undocumented `POST /quotations/{id}/actions/pursue` path
  // that returns HTTP 404 on the live API.

  server.registerTool('lexware_deeplink_quotation', {
    title: 'Deeplink to Quotation',
    description: 'Get a direct link to view/edit a quotation in the Lexware web app.',
    inputSchema: z.object({
      id: UuidSchema.describe('Quotation UUID'),
    }),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  }, handleToolRequest(async (params) => {
    return { deeplink: `${LEXWARE_APP_BASE}/permalink/quotations/edit/${params.id}` };
  }));
}
