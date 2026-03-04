import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { lexwareRequest } from '../services/lexware.js';
import { handleToolRequest } from '../helpers.js';

export function registerProfileTools(server: McpServer): void {
  server.registerTool('lexware_get_profile', {
    title: 'Get Profile',
    description: 'Get the organization profile information.',
    inputSchema: z.object({}),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }, handleToolRequest(async () => lexwareRequest('GET', '/profile')));
}
