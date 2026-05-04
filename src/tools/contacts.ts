import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { lexwareRequest } from '../services/lexware.js';
import { handleToolRequest, formatResponse } from '../helpers.js';
import { UuidSchema, PaginationParams } from '../schemas/common.js';

export function registerContactTools(server: McpServer): void {
  server.registerTool('lexware_list_contacts', {
    title: 'List Contacts',
    description: 'List all contacts with optional pagination and filters.',
    inputSchema: z.object({
      ...PaginationParams,
      email: z.string().optional().describe('Filter by email address'),
      name: z.string().optional().describe('Filter by name'),
      number: z.number().optional().describe('Filter by contact number'),
      customer: z.boolean().optional().describe('Filter for customers'),
      vendor: z.boolean().optional().describe('Filter for vendors'),
      archived: z.boolean().optional().describe('Filter by archived status'),
    }),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }, handleToolRequest(async (params) => lexwareRequest('GET', '/contacts', undefined, params)));

  server.registerTool('lexware_get_contact', {
    title: 'Get Contact',
    description: 'Get a single contact by ID.',
    inputSchema: z.object({ id: UuidSchema.describe('Contact ID') }),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }, handleToolRequest(async (params) => lexwareRequest('GET', `/contacts/${params.id}`)));

  server.registerTool('lexware_create_contact', {
    title: 'Create Contact',
    description: 'Create a new contact.',
    inputSchema: z.object({
      body: z.record(z.unknown()).describe(
        'Contact JSON. Key fields: version (0 for new), roles (object with customer/vendor), company (object with name), person (object with firstName, lastName), addresses (object with billing/shipping arrays), emailAddresses, phoneNumbers'
      ),
    }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  }, handleToolRequest(async (params) => lexwareRequest('POST', '/contacts', params.body)));

  server.registerTool('lexware_update_contact', {
    title: 'Update Contact',
    description: 'Update an existing contact. The body must include the version field for optimistic locking.',
    inputSchema: z.object({
      id: UuidSchema.describe('Contact ID'),
      body: z.record(z.unknown()).describe(
        'Contact JSON with version field. Same structure as create.'
      ),
    }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }, handleToolRequest(async (params) => lexwareRequest('PUT', `/contacts/${params.id}`, params.body)));

  server.registerTool('lexware_deeplink_contact', {
    title: 'Deeplink Contact',
    description: 'Get a direct URL to view a contact in the Lexware web app.',
    inputSchema: z.object({ id: UuidSchema.describe('Contact ID') }),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async (params) => {
    const url = `https://app.lexware.io/permalink/contacts/view/${params.id}`;
    return formatResponse({ url });
  });
}
