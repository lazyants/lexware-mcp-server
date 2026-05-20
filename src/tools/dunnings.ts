import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { lexwareRequest, lexwareDownload } from '../services/lexware.js';
import { handleToolRequest } from '../helpers.js';
import { UuidSchema } from '../schemas/common.js';

export function registerDunningTools(server: McpServer): void {
  server.registerTool('lexware_create_dunning', {
    title: 'Create Dunning',
    description: 'Create a new dunning in Lexware.',
    inputSchema: z.object({
      body: z.record(z.string(), z.unknown()).describe(
        'Dunning JSON body. Key fields: voucherDate, address (object with contactId or manual fields), lineItems (array), totalPrice (object), taxConditions (object). See Lexware API docs for full schema.'
      ),
    }),
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
  }, handleToolRequest(async (params) => {
    return lexwareRequest('POST', '/dunnings', params.body);
  }));

  server.registerTool('lexware_pursue_dunning', {
    title: 'Pursue to a Dunning',
    description:
      'Create a new dunning as a follow-up to a preceding invoice. ' +
      'Maps to the documented `POST /dunnings?precedingSalesVoucherId={id}` endpoint. ' +
      'Dunnings are always created in draft mode and do not need to be finalized.',
    inputSchema: z.object({
      precedingSalesVoucherId: UuidSchema.describe(
        'UUID of the preceding invoice that this dunning is pursued from. Required by the Lexware API.'
      ),
      body: z.record(z.string(), z.unknown()).describe(
        'Dunning JSON body. Same shape as lexware_create_dunning. See Lexware API docs for full schema.'
      ),
    }),
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
  }, handleToolRequest(async (params) => {
    return lexwareRequest('POST', '/dunnings', params.body, {
      precedingSalesVoucherId: params.precedingSalesVoucherId,
    });
  }));

  server.registerTool('lexware_get_dunning', {
    title: 'Get Dunning',
    description: 'Retrieve a dunning by ID from Lexware.',
    inputSchema: z.object({
      id: UuidSchema.describe('Dunning UUID'),
    }),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  }, handleToolRequest(async (params) => {
    return lexwareRequest('GET', `/dunnings/${params.id}`);
  }));

  server.registerTool('lexware_download_dunning_file', {
    title: 'Download Dunning File',
    description: 'Download the PDF file for a dunning.',
    inputSchema: z.object({
      id: UuidSchema.describe('Dunning UUID'),
    }),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  }, handleToolRequest(async (params) => {
    const file = await lexwareDownload(`/dunnings/${params.id}/file`);
    return {
      fileName: file.fileName || 'dunning.pdf',
      contentType: file.contentType,
      contentBase64: file.data.toString('base64'),
    };
  }));

  server.registerTool('lexware_deeplink_dunning', {
    title: 'Deeplink to Dunning',
    description: 'Get a direct link to view/edit a dunning in the Lexware web app.',
    inputSchema: z.object({
      id: UuidSchema.describe('Dunning UUID'),
    }),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  }, handleToolRequest(async (params) => {
    return { deeplink: `https://app.lexware.io/permalink/dunnings/edit/${params.id}` };
  }));
}
