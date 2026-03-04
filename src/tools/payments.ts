import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { lexwareRequest } from '../services/lexware.js';
import { handleToolRequest } from '../helpers.js';
import { UuidSchema } from '../schemas/common.js';

export function registerPaymentTools(server: McpServer): void {
  server.registerTool('lexware_get_payments', {
    title: 'Get Payments',
    description: 'Get payment details for a specific voucher.',
    inputSchema: z.object({
      id: UuidSchema.describe('Voucher UUID'),
    }),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  }, handleToolRequest(async (params) => {
    return lexwareRequest('GET', `/payments/${params.id}`);
  }));
}
