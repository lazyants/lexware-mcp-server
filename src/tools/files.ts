import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { lexwareRequest, lexwareUpload, lexwareDownload } from '../services/lexware.js';
import { handleToolRequest } from '../helpers.js';
import { UuidSchema } from '../schemas/common.js';

export function registerFileTools(server: McpServer): void {
  server.registerTool('lexware_upload_file', {
    title: 'Upload File',
    description: 'Upload a file to Lexware.',
    inputSchema: z.object({
      fileName: z.string().describe('Name of the file to upload'),
      contentBase64: z.string().describe('Base64-encoded file content'),
      contentType: z.string().optional().describe('MIME type, defaults to application/pdf'),
    }),
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
  }, handleToolRequest(async (params) => {
    const buffer = Buffer.from(params.contentBase64, 'base64');
    return lexwareUpload('/files', buffer, params.fileName, params.contentType || 'application/pdf');
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
    const file = await lexwareDownload(`/files/${params.id}`);
    return {
      fileName: file.fileName || 'file',
      contentType: file.contentType,
      contentBase64: file.data.toString('base64'),
    };
  }));

  server.registerTool('lexware_get_file_status', {
    title: 'Get File Status',
    description: 'Get file metadata and processing status from Lexware.',
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
    return lexwareRequest('GET', `/files/${params.id}`);
  }));
}
