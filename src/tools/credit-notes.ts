import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { lexwareRequest } from '../services/lexware.js';
import { handleToolRequest } from '../helpers.js';
import { UuidSchema, DownloadFormat, downloadAccept, downloadFallbackName } from '../schemas/common.js';
import { LEXWARE_APP_BASE } from '../constants.js';
import { downloadFileResult } from './_download.js';
import { SALES_TEXT_FORMATTING_DESCRIPTION } from './_text-formatting.js';

export function registerCreditNoteTools(server: McpServer): void {
  server.registerTool('lexware_create_credit_note', {
    title: 'Create Credit Note',
    description: 'Create a new credit note in Lexware. ' + SALES_TEXT_FORMATTING_DESCRIPTION,
    inputSchema: z.object({
      body: z.record(z.string(), z.unknown()).describe(
        'Credit note JSON body with voucherDate, address (contactId or manual fields), lineItems (name, quantity, unitPrice), totalPrice, and taxConditions. ' + SALES_TEXT_FORMATTING_DESCRIPTION
      ),
    }),
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
  }, handleToolRequest(async (params) => {
    return lexwareRequest('POST', '/credit-notes', params.body);
  }));

  server.registerTool('lexware_get_credit_note', {
    title: 'Get Credit Note',
    description: 'Retrieve a credit note by ID from Lexware.',
    inputSchema: z.object({
      id: UuidSchema.describe('Credit note UUID'),
    }),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  }, handleToolRequest(async (params) => {
    return lexwareRequest('GET', `/credit-notes/${params.id}`);
  }));

  server.registerTool('lexware_download_credit_note_file', {
    title: 'Download Credit Note File',
    description:
      'Download the file for a credit note. Defaults to PDF; pass format="xml" to request the ' +
      'XRechnung XML e-invoice when available (the API returns whatever representation it can render).',
    inputSchema: z.object({
      id: UuidSchema.describe('Credit note UUID'),
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
      `/credit-notes/${params.id}/file`,
      (contentType) => downloadFallbackName('credit-note', contentType),
      downloadAccept(params.format),
    );
  }));

  server.registerTool('lexware_pursue_credit_note', {
    title: 'Pursue to a Credit Note',
    description:
      'Create a new credit note from an invoice via `POST /credit-notes?precedingSalesVoucherId={id}[&finalize=true]`; finalize=true finalizes the credit note, false or omitted creates a draft. ' +
      SALES_TEXT_FORMATTING_DESCRIPTION,
    inputSchema: z.object({
      precedingSalesVoucherId: UuidSchema.describe(
        'UUID of the preceding invoice that this credit note is pursued from.'
      ),
      body: z.record(z.string(), z.unknown()).describe(
        'Credit note JSON body with voucherDate, address, lineItems, totalPrice, and taxConditions. ' + SALES_TEXT_FORMATTING_DESCRIPTION
      ),
      finalize: z.boolean().optional().describe(
        'When true, creates the credit note in finalized status (immediately paid-off, reducing the invoice open amount). ' +
        'When false or omitted, creates as draft. Maps to the documented ?finalize=true query parameter.'
      ),
    }),
    annotations: {
      readOnlyHint: false,
      // finalize=true immediately reduces the open amount of the preceding
      // invoice — an irreversible financial side effect on a sibling resource.
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true,
    },
  }, handleToolRequest(async (params) => {
    const query: Record<string, unknown> = { precedingSalesVoucherId: params.precedingSalesVoucherId };
    if (params.finalize === true) query.finalize = true;
    return lexwareRequest('POST', '/credit-notes', params.body, query);
  }));

  server.registerTool('lexware_deeplink_credit_note', {
    title: 'Deeplink to Credit Note',
    description: 'Get a direct link to view/edit a credit note in the Lexware web app.',
    inputSchema: z.object({
      id: UuidSchema.describe('Credit note UUID'),
    }),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  }, handleToolRequest(async (params) => {
    return { deeplink: `${LEXWARE_APP_BASE}/permalink/credit-notes/edit/${params.id}` };
  }));
}
