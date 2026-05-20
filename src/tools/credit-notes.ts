import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { lexwareRequest, lexwareDownload } from '../services/lexware.js';
import { handleToolRequest } from '../helpers.js';
import { UuidSchema } from '../schemas/common.js';

export function registerCreditNoteTools(server: McpServer): void {
  server.registerTool('lexware_create_credit_note', {
    title: 'Create Credit Note',
    description: 'Create a new credit note in Lexware.',
    inputSchema: z.object({
      body: z.record(z.string(), z.unknown()).describe(
        'Credit note JSON body. Key fields: voucherDate, address (object with contactId or manual fields), lineItems (array with name, quantity, unitPrice, etc.), totalPrice (object), taxConditions (object). See Lexware API docs for full schema.'
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
    description: 'Download the PDF file for a credit note.',
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
    const file = await lexwareDownload(`/credit-notes/${params.id}/file`);
    return {
      fileName: file.fileName || 'credit-note.pdf',
      contentType: file.contentType,
      contentBase64: file.data.toString('base64'),
    };
  }));

  server.registerTool('lexware_pursue_credit_note', {
    title: 'Pursue to a Credit Note',
    description:
      'Create a new credit note as a follow-up to a preceding invoice. ' +
      'Maps to the documented `POST /credit-notes?precedingSalesVoucherId={id}[&finalize=true]` endpoint. ' +
      'Set finalize=true to immediately finalize the credit note; omit or false to create as draft.',
    inputSchema: z.object({
      precedingSalesVoucherId: UuidSchema.describe(
        'UUID of the preceding invoice that this credit note is pursued from.'
      ),
      body: z.record(z.string(), z.unknown()).describe(
        'Credit note JSON body. Same shape as lexware_create_credit_note. See Lexware API docs for full schema.'
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
    return { deeplink: `https://app.lexware.io/permalink/credit-notes/edit/${params.id}` };
  }));
}
