import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { lexwareRequest } from '../services/lexware.js';
import { handleToolRequest } from '../helpers.js';
import { UuidSchema } from '../schemas/common.js';

export function registerEventSubscriptionTools(server: McpServer): void {
  server.registerTool('lexware_create_event_subscription', {
    title: 'Create Event Subscription',
    description: 'Create a new webhook event subscription in Lexware.',
    inputSchema: z.object({
      eventType: z.string().describe('Event type, e.g. "invoice.created"'),
      callbackUrl: z.string().url().describe('Webhook URL'),
    }),
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
  }, handleToolRequest(async (params) => {
    return lexwareRequest('POST', '/event-subscriptions', {
      eventType: params.eventType,
      callbackUrl: params.callbackUrl,
    });
  }));

  server.registerTool('lexware_list_event_subscriptions', {
    title: 'List Event Subscriptions',
    description: 'List all webhook event subscriptions in Lexware.',
    inputSchema: z.object({}),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  }, handleToolRequest(async () => {
    return lexwareRequest('GET', '/event-subscriptions');
  }));

  server.registerTool('lexware_get_event_subscription', {
    title: 'Get Event Subscription',
    description: 'Retrieve a webhook event subscription by ID from Lexware.',
    inputSchema: z.object({
      id: UuidSchema.describe('Event subscription UUID'),
    }),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  }, handleToolRequest(async (params) => {
    return lexwareRequest('GET', `/event-subscriptions/${params.id}`);
  }));

  server.registerTool('lexware_delete_event_subscription', {
    title: 'Delete Event Subscription',
    description: 'Delete a webhook event subscription from Lexware.',
    inputSchema: z.object({
      id: UuidSchema.describe('Event subscription UUID'),
    }),
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true,
    },
  }, handleToolRequest(async (params) => {
    return lexwareRequest('DELETE', `/event-subscriptions/${params.id}`);
  }));
}
