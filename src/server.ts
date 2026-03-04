import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const pkg = require('../package.json') as { version: string; name: string };

export function createServer(name = 'lexware-mcp-server'): McpServer {
  return new McpServer({ name, version: pkg.version });
}

export async function startServer(server: McpServer): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`MCP server running on stdio (v${pkg.version})`);
}
