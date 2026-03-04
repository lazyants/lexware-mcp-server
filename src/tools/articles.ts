import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { lexwareRequest } from '../services/lexware.js';
import { handleToolRequest } from '../helpers.js';
import { UuidSchema, PaginationParams } from '../schemas/common.js';

export function registerArticleTools(server: McpServer): void {
  server.registerTool('lexware_list_articles', {
    title: 'List Articles',
    description: 'List all articles with optional pagination.',
    inputSchema: z.object({
      ...PaginationParams,
      articleNumber: z.string().optional().describe('Filter by article number'),
      gtin: z.string().optional().describe('Filter by GTIN/EAN'),
      type: z.enum(['PRODUCT', 'SERVICE']).optional().describe('Filter by article type'),
    }),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }, handleToolRequest(async (params) => lexwareRequest('GET', '/articles', undefined, params)));

  server.registerTool('lexware_get_article', {
    title: 'Get Article',
    description: 'Get a single article by ID.',
    inputSchema: z.object({ id: UuidSchema.describe('Article ID') }),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }, handleToolRequest(async (params) => lexwareRequest('GET', `/articles/${params.id}`)));

  server.registerTool('lexware_create_article', {
    title: 'Create Article',
    description: 'Create a new article.',
    inputSchema: z.object({
      body: z.record(z.unknown()).describe(
        'Article JSON. Key fields: title (string), type ("PRODUCT"|"SERVICE"), unitName, unitPrice (object with currency, netAmount, grossAmount, taxRatePercentage), description'
      ),
    }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  }, handleToolRequest(async (params) => lexwareRequest('POST', '/articles', params.body)));

  server.registerTool('lexware_update_article', {
    title: 'Update Article',
    description: 'Update an existing article. The body must include the version field for optimistic locking.',
    inputSchema: z.object({
      id: UuidSchema.describe('Article ID'),
      body: z.record(z.unknown()).describe(
        'Article JSON with version field included for optimistic locking. Key fields: title, type, unitName, unitPrice, description, version (required)'
      ),
    }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }, handleToolRequest(async (params) => lexwareRequest('PUT', `/articles/${params.id}`, params.body)));

  server.registerTool('lexware_delete_article', {
    title: 'Delete Article',
    description: 'Delete an article by ID.',
    inputSchema: z.object({ id: UuidSchema.describe('Article ID') }),
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
  }, handleToolRequest(async (params) => lexwareRequest('DELETE', `/articles/${params.id}`)));
}
