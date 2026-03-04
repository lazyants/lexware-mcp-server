import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { lexwareRequest } from '../services/lexware.js';
import { handleToolRequest } from '../helpers.js';

export function registerPrintLayoutTools(server: McpServer): void {
  server.registerTool('lexware_list_print_layouts', {
    title: 'List Print Layouts',
    description: 'List available print layout templates.',
    inputSchema: z.object({}),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  }, handleToolRequest(async () => {
    return lexwareRequest('GET', '/print-layouts');
  }));
}
