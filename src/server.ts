import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createRequire } from 'module';
import { apiBaseFromEnv } from './api-base.js';
import { LEXWARE_API_BASE } from './constants.js';

const require = createRequire(import.meta.url);
const pkg = require('../package.json') as { version: string; name: string };

export function createServer(name = 'lexware-mcp-server'): McpServer {
  return new McpServer({ name, version: pkg.version });
}

export async function startServer(server: McpServer): Promise<void> {
  // Checked before the transport opens: an invalid LEXWARE_API_BASE stops the server here instead
  // of failing on the first tool call, and a valid override is named, since the token goes there.
  const apiBase = apiBaseFromEnv();
  if (apiBase !== LEXWARE_API_BASE) {
    console.error(`[lexware-mcp] LEXWARE_API_BASE is set: requests go to ${apiBase} instead of ${LEXWARE_API_BASE}`);
  }
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`MCP server running on stdio (v${pkg.version})`);
}

/** Starts the server and exits the process on a fatal startup failure. Shared by every bin entry point. */
export function runServer(server: McpServer): void {
  startServer(server).catch((err) => {
    console.error('Fatal:', err);
    process.exit(1);
  });
}
