import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { lexwareRequest, lexwareDownload } from '../services/lexware.js';
import { handleToolRequest } from '../helpers.js';
import { UuidSchema, VersionParam } from '../schemas/common.js';

export function registerInvoiceTools(server: McpServer): void {
  server.registerTool('lexware_create_invoice', {
    title: 'Create Invoice',
    description:
      'Create a new invoice in Lexware. Set finalize=true to immediately finalize (status "open"); ' +
      'omit or false to create as draft. The Lexware API does not support finalizing an existing draft — ' +
      'this is the only documented way to obtain a finalized invoice.',
    inputSchema: z.object({
      body: z.record(z.string(), z.unknown()).describe(
        'Invoice JSON body. Key fields: voucherDate, address (object with contactId or manual fields), lineItems (array with name, quantity, unitPrice, etc.), totalPrice (object), taxConditions (object). See Lexware API docs for full schema.'
      ),
      finalize: z.boolean().optional().describe(
        'When true, creates the invoice in finalized "open" status. When false or omitted, creates as draft. Maps to the documented ?finalize=true query parameter.'
      ),
    }),
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
  }, handleToolRequest(async (params) => {
    // Only forward finalize when truthy. The Lexware API only documents
    // `[&finalize=true]`; some HTTP parsers treat any non-empty value
    // (including `false`) as truthy, which would silently produce a
    // finalized invoice. Omitting the query param entirely is the
    // documented "create as draft" behavior.
    const query = params.finalize === true ? { finalize: true } : undefined;
    return lexwareRequest('POST', '/invoices', params.body, query);
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

  // NOTE: A `lexware_finalize_invoice` tool was removed in 2026-05 because the Lexware
  // Office API does not expose any endpoint to finalize an existing draft invoice.
  // Per the Lexware docs (https://developers.lexware.io/docs/#invoices-endpoint-create-an-invoice):
  //   "The status of an invoice cannot be changed via the api."
  // The previous implementation hit an undocumented `POST /invoices/{id}/actions/finalize`
  // path which returns HTTP 404 on the current API. The only documented way to obtain a
  // finalized invoice is at creation time via `POST /invoices?finalize=true` — exposed
  // through the `finalize` parameter on `lexware_create_invoice` above.

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
