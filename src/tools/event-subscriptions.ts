import { createVerify } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getWebhookPublicKey, lexwareRequest } from '../services/lexware.js';
import { handleToolRequest } from '../helpers.js';
import { UuidSchema } from '../schemas/common.js';

const EVENT_TYPE_DESCRIPTION =
  'Event type. Documented values: contact.changed, contact.deleted, ' +
  'voucher.created, voucher.changed, voucher.deleted, ' +
  'invoice.created, invoice.changed, invoice.deleted, ' +
  'credit-note.created, credit-note.changed, credit-note.deleted, ' +
  'quotation.created, quotation.changed, quotation.deleted, ' +
  'delivery-note.status.changed, order-confirmation.status.changed. ' +
  'Lexware may add new types — pass any documented value.';

export function registerEventSubscriptionTools(server: McpServer): void {
  server.registerTool('lexware_create_event_subscription', {
    title: 'Create Event Subscription',
    description: 'Create a new webhook event subscription in Lexware.',
    inputSchema: z.object({
      eventType: z.string().describe(EVENT_TYPE_DESCRIPTION),
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

  server.registerTool('lexware_verify_webhook_signature', {
    title: 'Verify Webhook Signature',
    description:
      'Verify a Lexware webhook X-Lxo-Signature (RSA-SHA512, base64) against the raw request body. ' +
      'Pass the EXACT raw HTTP body bytes you received — do not JSON.parse/stringify round-trip, ' +
      'as Lexware signs the compact JSON as transmitted (whitespace and key order matter). ' +
      'On first call the public key is fetched once from developers.lexware.io and cached for ' +
      'the process lifetime; set LEXWARE_WEBHOOK_PUBLIC_KEY (PEM) to override (recommended for ' +
      'production where you cannot tolerate one-time TLS-substitution risk on the public-key fetch).',
    inputSchema: z.object({
      payload: z.string().describe('Raw HTTP request body received from Lexware (verbatim, untransformed).'),
      signature: z.string().describe('Value of the X-Lxo-Signature header (base64).'),
    }),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  }, handleToolRequest(async (params) => {
    const publicKey = await getWebhookPublicKey();
    const verifier = createVerify('RSA-SHA512');
    verifier.update(params.payload);
    verifier.end();
    const verified = verifier.verify(publicKey, params.signature, 'base64');
    return { verified, algorithm: 'RSA-SHA512' as const };
  }));
}
