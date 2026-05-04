import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { lexwareRequest, lexwareDownload } from '../services/lexware.js';
import { handleToolRequest } from '../helpers.js';
import { UuidSchema, VersionParam } from '../schemas/common.js';

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
    description: 'Download the PDF file for a quotation.',
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
    const file = await lexwareDownload(`/quotations/${params.id}/file`);
    return {
      fileName: file.fileName || 'quotation.pdf',
      contentType: file.contentType,
      contentBase64: file.data.toString('base64'),
    };
  }));

  server.registerTool('lexware_pursue_quotation', {
    title: 'Pursue Quotation',
    description: 'Transition a quotation from draft to open/pending status.',
    inputSchema: z.object({
      id: UuidSchema.describe('Quotation UUID'),
      ...VersionParam,
    }),
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
  }, handleToolRequest(async (params) => {
    return lexwareRequest('POST', `/quotations/${params.id}/actions/pursue`, undefined, { version: params.version });
  }));

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
    return { deeplink: `https://app.lexware.io/permalink/quotations/edit/${params.id}` };
  }));
}
