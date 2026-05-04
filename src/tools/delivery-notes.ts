import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { lexwareRequest, lexwareDownload } from '../services/lexware.js';
import { handleToolRequest } from '../helpers.js';
import { UuidSchema, VersionParam } from '../schemas/common.js';

export function registerDeliveryNoteTools(server: McpServer): void {
  server.registerTool('lexware_create_delivery_note', {
    title: 'Create Delivery Note',
    description: 'Create a new delivery note in Lexware.',
    inputSchema: z.object({
      body: z.record(z.string(), z.unknown()).describe(
        'Delivery note JSON body. Key fields: voucherDate, address (object with contactId or manual fields), lineItems (array with name, quantity, unitPrice, etc.), totalPrice (object), taxConditions (object). See Lexware API docs for full schema.'
      ),
    }),
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
  }, handleToolRequest(async (params) => {
    return lexwareRequest('POST', '/delivery-notes', params.body);
  }));

  server.registerTool('lexware_get_delivery_note', {
    title: 'Get Delivery Note',
    description: 'Retrieve a delivery note by ID from Lexware.',
    inputSchema: z.object({
      id: UuidSchema.describe('Delivery note UUID'),
    }),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  }, handleToolRequest(async (params) => {
    return lexwareRequest('GET', `/delivery-notes/${params.id}`);
  }));

  server.registerTool('lexware_download_delivery_note_file', {
    title: 'Download Delivery Note File',
    description: 'Download the PDF file for a delivery note.',
    inputSchema: z.object({
      id: UuidSchema.describe('Delivery note UUID'),
    }),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  }, handleToolRequest(async (params) => {
    const file = await lexwareDownload(`/delivery-notes/${params.id}/file`);
    return {
      fileName: file.fileName || 'delivery-note.pdf',
      contentType: file.contentType,
      contentBase64: file.data.toString('base64'),
    };
  }));

  server.registerTool('lexware_pursue_delivery_note', {
    title: 'Pursue Delivery Note',
    description: 'Transition a delivery note from draft to open/pending status.',
    inputSchema: z.object({
      id: UuidSchema.describe('Delivery note UUID'),
      ...VersionParam,
    }),
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
  }, handleToolRequest(async (params) => {
    return lexwareRequest('POST', `/delivery-notes/${params.id}/actions/pursue`, undefined, { version: params.version });
  }));

  server.registerTool('lexware_deeplink_delivery_note', {
    title: 'Deeplink to Delivery Note',
    description: 'Get a direct link to view/edit a delivery note in the Lexware web app.',
    inputSchema: z.object({
      id: UuidSchema.describe('Delivery note UUID'),
    }),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  }, handleToolRequest(async (params) => {
    return { deeplink: `https://app.lexware.io/permalink/delivery-notes/edit/${params.id}` };
  }));
}
