import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { lexwareRequest, lexwareDownload } from '../services/lexware.js';
import { handleToolRequest } from '../helpers.js';
import { UuidSchema, VersionParam } from '../schemas/common.js';

export function registerCreditNoteTools(server: McpServer): void {
  server.registerTool('lexware_create_credit_note', {
    title: 'Create Credit Note',
    description: 'Create a new credit note in Lexware.',
    inputSchema: z.object({
      body: z.record(z.unknown()).describe(
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
    title: 'Pursue Credit Note',
    description: 'Transition a credit note from draft to open/pending status.',
    inputSchema: z.object({
      id: UuidSchema.describe('Credit note UUID'),
      ...VersionParam,
    }),
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
  }, handleToolRequest(async (params) => {
    return lexwareRequest('POST', `/credit-notes/${params.id}/actions/pursue`, undefined, { version: params.version });
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
