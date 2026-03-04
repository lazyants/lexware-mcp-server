import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { lexwareRequest } from '../services/lexware.js';
import { handleToolRequest } from '../helpers.js';

export function registerCountryTools(server: McpServer): void {
  server.registerTool('lexware_list_countries', {
    title: 'List Countries',
    description: 'List all available countries with their tax classifications.',
    inputSchema: z.object({}),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }, handleToolRequest(async () => lexwareRequest('GET', '/countries')));
}
