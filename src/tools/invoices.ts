import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { lexwareRequest } from '../services/lexware.js';
import { handleToolRequest } from '../helpers.js';
import { UuidSchema, DownloadFormat, downloadAccept, downloadFallbackName } from '../schemas/common.js';
import { LEXWARE_APP_BASE } from '../constants.js';
import { downloadFileResult } from './_download.js';
import { SALES_TEXT_FORMATTING_DESCRIPTION } from './_text-formatting.js';

export function registerInvoiceTools(server: McpServer): void {
  server.registerTool('lexware_create_invoice', {
    title: 'Create Invoice',
    description:
      'Create a new invoice in Lexware; finalize=true creates status "open", false or omitted creates a draft, and the API cannot finalize an existing draft. ' +
      SALES_TEXT_FORMATTING_DESCRIPTION,
    inputSchema: z.object({
      body: z.record(z.string(), z.unknown()).describe(
        'Invoice JSON body with voucherDate, address (contactId or manual fields), lineItems (name, quantity, unitPrice), totalPrice, and taxConditions. ' + SALES_TEXT_FORMATTING_DESCRIPTION
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
    return downloadFileResult(
      `/invoices/${params.id}/file`,
      (contentType) => downloadFallbackName('invoice', contentType),
      downloadAccept(params.format),
    );
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
      'Create a new invoice from a quotation, order confirmation, or delivery note via `POST /invoices?precedingSalesVoucherId={id}[&finalize=true]`; finalize=true creates status "open", false or omitted creates a draft. ' +
      SALES_TEXT_FORMATTING_DESCRIPTION,
    inputSchema: z.object({
      precedingSalesVoucherId: UuidSchema.describe(
        'UUID of the preceding sales voucher (quotation, order confirmation, or delivery note) that this invoice is pursued from.'
      ),
      body: z.record(z.string(), z.unknown()).describe(
        'Invoice JSON body with required voucherDate, address, lineItems, totalPrice, and taxConditions. ' + SALES_TEXT_FORMATTING_DESCRIPTION
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
