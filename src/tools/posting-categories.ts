import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { lexwareRequest } from '../services/lexware.js';
import { handleToolRequest } from '../helpers.js';

export function registerPostingCategoryTools(server: McpServer): void {
  server.registerTool('lexware_list_posting_categories', {
    title: 'List Posting Categories',
    description: 'List all available posting categories for bookkeeping.',
    inputSchema: z.object({}),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }, handleToolRequest(async () => lexwareRequest('GET', '/posting-categories')));
}
