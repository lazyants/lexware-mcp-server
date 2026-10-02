import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { lexwareRequest } from '../services/lexware.js';
import { handleToolRequest } from '../helpers.js';
import { UuidSchema } from '../schemas/common.js';
import { LEXWARE_APP_BASE } from '../constants.js';
import { downloadFileResult } from './_download.js';
import { SALES_TEXT_FORMATTING_DESCRIPTION } from './_text-formatting.js';

export function registerDeliveryNoteTools(server: McpServer): void {
  server.registerTool('lexware_create_delivery_note', {
    title: 'Create Delivery Note',
    description: 'Create a new delivery note in Lexware. ' + SALES_TEXT_FORMATTING_DESCRIPTION,
    inputSchema: z.object({
      body: z.record(z.string(), z.unknown()).describe(
        'Delivery note JSON body with voucherDate, address (contactId or manual fields), lineItems (name, quantity, unitPrice), totalPrice, and taxConditions. ' + SALES_TEXT_FORMATTING_DESCRIPTION
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
    return downloadFileResult(`/delivery-notes/${params.id}/file`, 'delivery-note.pdf');
  }));

  server.registerTool('lexware_pursue_delivery_note', {
    title: 'Pursue to a Delivery Note',
    description:
      'Create a new delivery note from a quotation or order confirmation via `POST /delivery-notes?precedingSalesVoucherId={id}`. ' +
      SALES_TEXT_FORMATTING_DESCRIPTION,
    inputSchema: z.object({
      precedingSalesVoucherId: UuidSchema.describe(
        'UUID of the preceding sales voucher (quotation or order confirmation) that this delivery note is pursued from.'
      ),
      body: z.record(z.string(), z.unknown()).describe(
        'Delivery note JSON body with voucherDate, address, lineItems, totalPrice, and taxConditions. ' + SALES_TEXT_FORMATTING_DESCRIPTION
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
