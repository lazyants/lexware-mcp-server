import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { lexwareRequest } from '../services/lexware.js';
import { handleToolRequest } from '../helpers.js';

export function registerPaymentConditionTools(server: McpServer): void {
  server.registerTool('lexware_list_payment_conditions', {
    title: 'List Payment Conditions',
    description: 'List all available payment conditions.',
    inputSchema: z.object({}),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }, handleToolRequest(async () => lexwareRequest('GET', '/payment-conditions')));
}
