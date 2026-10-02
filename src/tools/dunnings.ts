import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { lexwareRequest } from '../services/lexware.js';
import { handleToolRequest } from '../helpers.js';
import { UuidSchema } from '../schemas/common.js';
import { LEXWARE_APP_BASE } from '../constants.js';
import { downloadFileResult } from './_download.js';
import { SALES_TEXT_FORMATTING_DESCRIPTION } from './_text-formatting.js';

export function registerDunningTools(server: McpServer): void {
  // NOTE: lexware_create_dunning was removed because dunnings are a chain-terminal
  // sales voucher: `precedingSalesVoucherId` is a mandatory query parameter per the
  // Lexware docs and there is no standalone `POST /dunnings` form. Use
  // lexware_pursue_dunning instead.

  server.registerTool('lexware_pursue_dunning', {
    title: 'Pursue to a Dunning',
    description:
      'Create a new dunning from an invoice via `POST /dunnings?precedingSalesVoucherId={id}`; dunnings are always created as drafts and do not need finalization. ' +
      SALES_TEXT_FORMATTING_DESCRIPTION,
    inputSchema: z.object({
      precedingSalesVoucherId: UuidSchema.describe(
        'UUID of the preceding invoice that this dunning is pursued from. Required by the Lexware API.'
      ),
      body: z.record(z.string(), z.unknown()).describe(
        'Dunning JSON body with voucherDate, address (contactId or manual fields), lineItems, totalPrice, and taxConditions. ' + SALES_TEXT_FORMATTING_DESCRIPTION
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
    return downloadFileResult(`/dunnings/${params.id}/file`, 'dunning.pdf');
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
    return { deeplink: `${LEXWARE_APP_BASE}/permalink/dunnings/edit/${params.id}` };
  }));
}
