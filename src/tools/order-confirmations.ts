import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { lexwareRequest } from '../services/lexware.js';
import { handleToolRequest } from '../helpers.js';
import { UuidSchema } from '../schemas/common.js';
import { LEXWARE_APP_BASE } from '../constants.js';
import { downloadFileResult } from './_download.js';
import { SALES_TEXT_FORMATTING_DESCRIPTION } from './_text-formatting.js';

export function registerOrderConfirmationTools(server: McpServer): void {
  server.registerTool('lexware_create_order_confirmation', {
    title: 'Create Order Confirmation',
    description: 'Create a new order confirmation in Lexware; finalize=true finalizes at creation, false or omitted creates a draft. ' + SALES_TEXT_FORMATTING_DESCRIPTION,
    inputSchema: z.object({
      body: z.record(z.string(), z.unknown()).describe(
        'Order confirmation JSON body with voucherDate, address (contactId or manual fields), lineItems (name, quantity, unitPrice), totalPrice, and taxConditions. ' + SALES_TEXT_FORMATTING_DESCRIPTION
      ),
      finalize: z.boolean().optional().describe(
        'When true, finalize the order confirmation at creation via ?finalize=true. When false or omitted, create as draft.'
      ),
    }),
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
  }, handleToolRequest(async (params) => {
    const query = params.finalize === true ? { finalize: true } : undefined;
    return lexwareRequest('POST', '/order-confirmations', params.body, query);
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
    return downloadFileResult(`/order-confirmations/${params.id}/file`, 'order-confirmation.pdf');
  }));

  server.registerTool('lexware_pursue_order_confirmation', {
    title: 'Pursue to an Order Confirmation',
    description:
      'Create a new order confirmation from a quotation via `POST /order-confirmations?precedingSalesVoucherId={id}`. ' +
      SALES_TEXT_FORMATTING_DESCRIPTION,
    inputSchema: z.object({
      precedingSalesVoucherId: UuidSchema.describe(
        'UUID of the preceding quotation that this order confirmation is pursued from.'
      ),
      body: z.record(z.string(), z.unknown()).describe(
        'Order confirmation JSON body with voucherDate, address, lineItems, totalPrice, and taxConditions. ' + SALES_TEXT_FORMATTING_DESCRIPTION
      ),
    }),
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
  }, handleToolRequest(async (params) => {
    return lexwareRequest('POST', '/order-confirmations', params.body, {
      precedingSalesVoucherId: params.precedingSalesVoucherId,
    });
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
    return { deeplink: `${LEXWARE_APP_BASE}/permalink/order-confirmations/edit/${params.id}` };
  }));
}
