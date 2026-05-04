import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { lexwareRequest, lexwareDownload } from '../services/lexware.js';
import { handleToolRequest } from '../helpers.js';
import { UuidSchema, VersionParam } from '../schemas/common.js';

export function registerOrderConfirmationTools(server: McpServer): void {
  server.registerTool('lexware_create_order_confirmation', {
    title: 'Create Order Confirmation',
    description: 'Create a new order confirmation in Lexware.',
    inputSchema: z.object({
      body: z.record(z.string(), z.unknown()).describe(
        'Order confirmation JSON body. Key fields: voucherDate, address (object with contactId or manual fields), lineItems (array with name, quantity, unitPrice, etc.), totalPrice (object), taxConditions (object). See Lexware API docs for full schema.'
      ),
    }),
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
  }, handleToolRequest(async (params) => {
    return lexwareRequest('POST', '/order-confirmations', params.body);
  }));

  server.registerTool('lexware_get_order_confirmation', {
    title: 'Get Order Confirmation',
    description: 'Retrieve an order confirmation by ID from Lexware.',
    inputSchema: z.object({
      id: UuidSchema.describe('Order confirmation UUID'),
    }),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  }, handleToolRequest(async (params) => {
    return lexwareRequest('GET', `/order-confirmations/${params.id}`);
  }));

  server.registerTool('lexware_download_order_confirmation_file', {
    title: 'Download Order Confirmation File',
    description: 'Download the PDF file for an order confirmation.',
    inputSchema: z.object({
      id: UuidSchema.describe('Order confirmation UUID'),
    }),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  }, handleToolRequest(async (params) => {
    const file = await lexwareDownload(`/order-confirmations/${params.id}/file`);
    return {
      fileName: file.fileName || 'order-confirmation.pdf',
      contentType: file.contentType,
      contentBase64: file.data.toString('base64'),
    };
  }));

  server.registerTool('lexware_pursue_order_confirmation', {
    title: 'Pursue Order Confirmation',
    description: 'Transition an order confirmation from draft to open/pending status.',
    inputSchema: z.object({
      id: UuidSchema.describe('Order confirmation UUID'),
      ...VersionParam,
    }),
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
  }, handleToolRequest(async (params) => {
    return lexwareRequest('POST', `/order-confirmations/${params.id}/actions/pursue`, undefined, { version: params.version });
  }));

  server.registerTool('lexware_deeplink_order_confirmation', {
    title: 'Deeplink to Order Confirmation',
    description: 'Get a direct link to view/edit an order confirmation in the Lexware web app.',
    inputSchema: z.object({
      id: UuidSchema.describe('Order confirmation UUID'),
    }),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  }, handleToolRequest(async (params) => {
    return { deeplink: `https://app.lexware.io/permalink/order-confirmations/edit/${params.id}` };
  }));
}
