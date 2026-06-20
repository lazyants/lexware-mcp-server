import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { lexwareRequest, lexwareDownload } from '../services/lexware.js';
import { handleToolRequest } from '../helpers.js';
import { UuidSchema, DownloadFormat, downloadAccept, downloadFallbackName } from '../schemas/common.js';
import { LEXWARE_APP_BASE } from '../constants.js';

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
    description:
      'Download the file for a delivery note. Defaults to PDF; pass format="xml" to request the XML ' +
      'representation when available (the API returns whatever representation it can render).',
    inputSchema: z.object({
      id: UuidSchema.describe('Delivery note UUID'),
      format: DownloadFormat,
    }),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  }, handleToolRequest(async (params) => {
    const file = await lexwareDownload(`/delivery-notes/${params.id}/file`, downloadAccept(params.format));
    return {
      fileName: file.fileName || downloadFallbackName('delivery-note', file.contentType),
      contentType: file.contentType,
      contentBase64: file.data.toString('base64'),
    };
  }));

  server.registerTool('lexware_pursue_delivery_note', {
    title: 'Pursue to a Delivery Note',
    description:
      'Create a new delivery note as a follow-up to a preceding quotation or order confirmation. ' +
      'Maps to the documented `POST /delivery-notes?precedingSalesVoucherId={id}` endpoint.',
    inputSchema: z.object({
      precedingSalesVoucherId: UuidSchema.describe(
        'UUID of the preceding sales voucher (quotation or order confirmation) that this delivery note is pursued from.'
      ),
      body: z.record(z.string(), z.unknown()).describe(
        'Delivery note JSON body. Same shape as lexware_create_delivery_note. See Lexware API docs for full schema.'
      ),
    }),
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
  }, handleToolRequest(async (params) => {
    return lexwareRequest('POST', '/delivery-notes', params.body, {
      precedingSalesVoucherId: params.precedingSalesVoucherId,
    });
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
    return { deeplink: `${LEXWARE_APP_BASE}/permalink/delivery-notes/edit/${params.id}` };
  }));
}
