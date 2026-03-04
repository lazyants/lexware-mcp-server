import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

export function toolError(err: unknown): CallToolResult {
  const message = err instanceof Error ? err.message : String(err);
  return {
    content: [{ type: 'text', text: `Error: ${message}` }],
    isError: true,
  };
}

export function formatResponse(data: unknown): CallToolResult {
  const result: CallToolResult = {
    content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
  };
  // GOTCHA: DELETE responses return empty strings (204). Only set structuredContent for objects.
  if (data !== null && typeof data === 'object') {
    result.structuredContent = data as Record<string, unknown>;
  }
  return result;
}

// GOTCHA: Must use `any` — Record<string,unknown> makes destructured props `unknown`,
// breaking template literals like `/invoices/${id}`. Zod validates at runtime anyway.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function handleToolRequest(fn: (params: any) => Promise<unknown>) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return async (params: any) => {
    try {
      const data = await fn(params);
      return formatResponse(data);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[lexware-mcp] Tool error: ${message}`);
      return toolError(err);
    }
  };
}
