import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { lexwareRequest } from '../services/lexware.js';
import { handleToolRequest } from '../helpers.js';
import { UuidSchema, PaginationParams } from '../schemas/common.js';

export function registerRecurringTemplateTools(server: McpServer): void {
  server.registerTool('lexware_list_recurring_templates', {
    title: 'List Recurring Templates',
    description: 'List recurring invoice templates from Lexware.',
    inputSchema: z.object({
      ...PaginationParams,
    }),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  }, handleToolRequest(async (params) => {
    return lexwareRequest('GET', '/recurring-templates', undefined, {
      page: params.page,
      size: params.size,
    });
  }));

  server.registerTool('lexware_get_recurring_template', {
    title: 'Get Recurring Template',
    description: 'Retrieve a recurring invoice template by ID from Lexware.',
    inputSchema: z.object({
      id: UuidSchema.describe('Recurring template UUID'),
    }),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  }, handleToolRequest(async (params) => {
    return lexwareRequest('GET', `/recurring-templates/${params.id}`);
  }));
}
