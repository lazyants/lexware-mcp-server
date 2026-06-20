import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { lexwareRequest, lexwareDownload } from '../services/lexware.js';
import { handleToolRequest } from '../helpers.js';
import { UuidSchema, DownloadFormat, downloadAccept, downloadFallbackName } from '../schemas/common.js';
import { LEXWARE_APP_BASE } from '../constants.js';

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
    description:
      'Download the file for an invoice. Defaults to PDF; pass format="xml" to request the ' +
      'XRechnung XML e-invoice when available (the API returns whatever representation it can render).',
    inputSchema: z.object({
      id: UuidSchema.describe('Invoice UUID'),
      format: DownloadFormat,
    }),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  }, handleToolRequest(async (params) => {
    const file = await lexwareDownload(`/invoices/${params.id}/file`, downloadAccept(params.format));
    return {
      fileName: file.fileName || downloadFallbackName('invoice', file.contentType),
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
    title: 'Pursue to an Invoice',
    description:
      'Create a new invoice as a follow-up to a preceding sales voucher (quotation, order confirmation, or delivery note). ' +
      'Maps to the documented `POST /invoices?precedingSalesVoucherId={id}[&finalize=true]` endpoint. ' +
      'Set finalize=true to immediately finalize the new invoice (status "open"); omit or false to create as draft.',
    inputSchema: z.object({
      precedingSalesVoucherId: UuidSchema.describe(
        'UUID of the preceding sales voucher (quotation, order confirmation, or delivery note) that this invoice is pursued from.'
      ),
      body: z.record(z.string(), z.unknown()).describe(
        'Invoice JSON body. Same shape as lexware_create_invoice. Required fields: voucherDate, address, lineItems, totalPrice, taxConditions. ' +
        'See Lexware API docs for full schema.'
      ),
      finalize: z.boolean().optional().describe(
        'When true, creates the invoice in finalized "open" status. When false or omitted, creates as draft. ' +
        'Maps to the documented ?finalize=true query parameter.'
      ),
    }),
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
  }, handleToolRequest(async (params) => {
    // Documented endpoint: POST /v1/invoices?precedingSalesVoucherId={id}[&finalize=true]
    // The pursue action is a CREATE on /invoices with a chaining query param, NOT a
    // status transition on an existing invoice. The prior implementation hit an
    // undocumented `POST /invoices/{id}/actions/pursue` path that returns HTTP 404
    // on the live API.
    // Only emit ?finalize when truthy — per the Lexware docs only `[&finalize=true]`
    // is defined, and some HTTP parsers treat any non-empty query value (including
    // the literal "false") as truthy.
    const query: Record<string, unknown> = { precedingSalesVoucherId: params.precedingSalesVoucherId };
    if (params.finalize === true) query.finalize = true;
    return lexwareRequest('POST', '/invoices', params.body, query);
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
    return { deeplink: `${LEXWARE_APP_BASE}/permalink/invoices/edit/${params.id}` };
  }));
}
