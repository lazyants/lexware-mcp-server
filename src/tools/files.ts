import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { lexwareRequest, lexwareUpload } from '../services/lexware.js';
import { handleToolRequest } from '../helpers.js';
import { UuidSchema } from '../schemas/common.js';
import { LEXWARE_APP_BASE } from '../constants.js';
import { downloadFileResult } from './_download.js';
import { uploadInputSchema, resolveUpload } from './_upload.js';

export function registerFileTools(server: McpServer): void {
  server.registerTool('lexware_upload_file', {
    title: 'Upload File',
    description:
      'Upload a file to Lexware. Provide either filePath (absolute path on the MCP server host) ' +
      'or contentBase64 (base64-encoded content) — not both. When using filePath, fileName is ' +
      'optional (derived from the file name) and contentType is auto-detected for common image ' +
      'extensions. When using contentBase64, fileName is required.',
    inputSchema: uploadInputSchema({}),
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
  }, handleToolRequest(async (params) => {
    const { buffer, fileName, contentType } = resolveUpload(params);
    // POST /v1/files requires a type form part; 'voucher' is the only documented
    // upload type; omitting it → HTTP 400. Not needed on /vouchers/{id}/files.
    return lexwareUpload('/files', buffer, fileName, contentType, 'voucher');
  }));

  server.registerTool('lexware_download_file', {
    title: 'Download File',
    description: 'Download a file from Lexware. Returns the file as base64-encoded content.',
    inputSchema: z.object({
      id: UuidSchema.describe('File UUID'),
    }),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  }, handleToolRequest(async (params) => {
    return downloadFileResult(`/files/${params.id}`, 'file');
  }));

  server.registerTool('lexware_get_file_status', {
    title: 'Get File Status',
    description:
      'Get the processing status of an uploaded file from Lexware. Requires an API key with ' +
      'the file-status scope; keys without it get an access_denied error from Lexware.',
    inputSchema: z.object({
      id: UuidSchema.describe('File UUID'),
    }),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  }, handleToolRequest(async (params) => {
    // MUST be `/status`, not `/files/{id}` — the latter is the binary DOWNLOAD route.
    // Verified against the live API: with `Accept: application/json` it answers 200
    // with Content-Type application/pdf and the file body base64-encoded, so reading
    // it as metadata returned the file, never a status.
    return lexwareRequest('GET', `/files/${params.id}/status`);
  }));

  server.registerTool('lexware_deeplink_file', {
    title: 'Deeplink to Files Inbox',
    // Idless by design: per the Lexware docs this permalink opens the bookkeeping
    // inbox of newly-uploaded files, not a per-file link, so the tool takes no id.
    description: 'Get a direct link to the bookkeeping inbox of newly-uploaded files in the Lexware web app.',
    inputSchema: z.object({}),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  }, handleToolRequest(async () => {
    return { deeplink: `${LEXWARE_APP_BASE}/permalink/files/view` };
  }));
}
