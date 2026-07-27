import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { lexwareRequest, lexwareUpload } from '../services/lexware.js';
import { handleToolRequest, withProcessingRetry, isNotFound } from '../helpers.js';
import { UuidSchema, MimeTypeSchema } from '../schemas/common.js';
import { LEXWARE_APP_BASE, MAX_PAGE_SIZE } from '../constants.js';
import {
  VOUCHER_STATUSES,
  normalizeVoucherResponse,
  normalizeVoucherStatus,
  wildcardMatch,
} from './_vouchers.js';

// Bound on auto-pagination. At the 250-row default this is 25 000 vouchers, well
// past any interactive query, and it stops a pathological totalPages from turning
// one tool call into an unbounded request storm.
const MAX_AUTO_PAGES = 100;

export function registerVoucherTools(server: McpServer): void {
  server.registerTool('lexware_create_voucher', {
    title: 'Create Voucher',
    description: 'Create a new bookkeeping voucher in Lexware.',
    inputSchema: z.object({
      body: z.record(z.string(), z.unknown()).describe(
        'Voucher JSON. Key fields: type ("salesinvoice"|"salescreditnote"|"purchaseinvoice"|"purchasecreditnote"), voucherNumber, voucherDate, totalGrossAmount, totalTaxAmount, taxType, voucherItems (array), contactId'
      ),
    }),
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
  }, handleToolRequest(async (params) => {
    return lexwareRequest('POST', '/vouchers', params.body);
  }));

  server.registerTool('lexware_get_voucher', {
    title: 'Get Voucher',
    description:
      'Retrieve a bookkeeping voucher by ID from Lexware. The voucherStatus field in the ' +
      'response is normalized to its canonical lowercase form. Known values: ' +
      `${VOUCHER_STATUSES.join(', ')}. ` +
      'Retries up to 3 times (1 s / 2 s / 4 s) on 404 to absorb the indexing delay after an ' +
      'upload; if the voucher is still missing, returns { voucherId, status: "processing", ' +
      'message } rather than an error. Other failures are reported as errors.',
    inputSchema: z.object({
      id: UuidSchema.describe('Voucher UUID'),
    }),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  }, handleToolRequest(async (params) => {
    try {
      return await withProcessingRetry(async () => {
        const voucher = await lexwareRequest<Record<string, unknown>>('GET', `/vouchers/${params.id}`);
        return normalizeVoucherResponse(voucher);
      });
    } catch (err) {
      // ONLY an exhausted 404 becomes the soft "processing" answer. Reporting a 401
      // or a 500 as "still processing" would tell the caller to wait for something
      // that is never going to arrive, and hide the real fault — so rethrow and let
      // handleToolRequest surface it as a tool error.
      if (!isNotFound(err)) throw err;
      return {
        voucherId: params.id as string,
        status: 'processing',
        message: 'Voucher is still being processed by Lexware — please retry in 30 seconds.',
      };
    }
  }));

  server.registerTool('lexware_update_voucher', {
    title: 'Update Voucher',
    description: 'Update an existing bookkeeping voucher in Lexware. Requires version field for optimistic locking.',
    inputSchema: z.object({
      id: UuidSchema.describe('Voucher UUID'),
      body: z.record(z.string(), z.unknown()).describe('Voucher JSON with version field for optimistic locking'),
    }),
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  }, handleToolRequest(async (params) => {
    return lexwareRequest('PUT', `/vouchers/${params.id}`, params.body);
  }));

  server.registerTool('lexware_list_vouchers', {
    title: 'List Vouchers',
    description:
      'List bookkeeping vouchers from Lexware. Fetches every page automatically and returns ' +
      '{ content, totalCount, fetchedPages, truncated }. voucherNumber is filtered by the API; ' +
      'voucherStatus, contactName, voucherDateFrom, voucherDateTo and hasOpenAmount are applied ' +
      'client-side over the full result set. voucherStatus values (case-insensitive): ' +
      `${VOUCHER_STATUSES.join(', ')}.`,
    inputSchema: z.object({
      // NOT PaginationParams: this tool owns paging. `size` is the per-request batch
      // size, not a result count, and there is no `page` — see the handler.
      size: z
        .number().int().min(1).max(MAX_PAGE_SIZE)
        .optional()
        .describe(`Results per API request (default ${MAX_PAGE_SIZE}). Controls fetch batch size, not result count.`),
      voucherNumber: z.string().optional().describe('Filter by voucher number (API-side)'),
      voucherStatus: z.string().optional().describe(
        `Filter by voucher status (client-side). Accepted values: ${VOUCHER_STATUSES.join(', ')}. Case-insensitive.`
      ),
      contactName: z.string().optional().describe(
        'Wildcard filter on contactName (client-side). % = any chars, _ = any single char. Case-insensitive. Example: "Müller%".'
      ),
      voucherDateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}/, 'Must be YYYY-MM-DD').optional().describe(
        'Include only vouchers with voucherDate >= this date (inclusive). Format: YYYY-MM-DD.'
      ),
      voucherDateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}/, 'Must be YYYY-MM-DD').optional().describe(
        'Include only vouchers with voucherDate <= this date (inclusive). Format: YYYY-MM-DD.'
      ),
      hasOpenAmount: z.boolean().optional().describe(
        'When true, include only vouchers with openAmount > 0.'
      ),
    }),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  }, handleToolRequest(async (params) => {
    const pageSize = params.size ?? MAX_PAGE_SIZE;
    const all: Record<string, unknown>[] = [];
    let page = 0;
    let totalPages = 1;

    while (page < totalPages && page < MAX_AUTO_PAGES) {
      const response = await lexwareRequest<{ content?: Record<string, unknown>[]; totalPages?: number }>(
        'GET', '/vouchers', undefined,
        {
          page,
          size: pageSize,
          voucherNumber: params.voucherNumber,
          // voucherStatus is deliberately NOT sent: the Lexware API ignores it on
          // GET /vouchers (#65), so forwarding it would look like a filter while
          // silently returning unfiltered results. It is applied client-side below.
        },
      );
      all.push(...(response.content ?? []));
      totalPages = response.totalPages ?? 1;
      page++;
    }

    const fetchedPages = page;
    // Report rather than hide the cap: a silently short result set reads as "that's
    // all there is", which is the one answer a caller must not be given wrongly.
    const truncated = page < totalPages;

    let filtered = all;

    if (params.voucherStatus) {
      const wanted = normalizeVoucherStatus(params.voucherStatus);
      filtered = filtered.filter((v) => {
        const raw = v.voucherStatus ?? v.status;
        return typeof raw === 'string' && normalizeVoucherStatus(raw) === wanted;
      });
    }

    if (params.contactName) {
      const pattern = params.contactName as string;
      filtered = filtered.filter((v) => typeof v.contactName === 'string' && wildcardMatch(pattern, v.contactName));
    }

    if (params.voucherDateFrom) {
      const from = params.voucherDateFrom as string;
      // Lexware returns voucherDate as an ISO-8601 string, so a lexicographic
      // comparison against a YYYY-MM-DD bound orders correctly without parsing.
      filtered = filtered.filter((v) => typeof v.voucherDate === 'string' && v.voucherDate >= from);
    }

    if (params.voucherDateTo) {
      // Compare only the date part, so an inclusive "to" bound does not exclude a
      // same-day voucher carrying a time component ("2024-03-15T09:00:00").
      const to = params.voucherDateTo as string;
      filtered = filtered.filter((v) => typeof v.voucherDate === 'string' && v.voucherDate.slice(0, 10) <= to);
    }

    if (params.hasOpenAmount === true) {
      filtered = filtered.filter((v) => typeof v.openAmount === 'number' && v.openAmount > 0);
    }

    return { content: filtered, totalCount: filtered.length, fetchedPages, truncated };
  }));

  server.registerTool('lexware_upload_voucher_file', {
    title: 'Upload Voucher File',
    description: 'Upload a file attachment to a bookkeeping voucher.',
    inputSchema: z.object({
      id: UuidSchema.describe('Voucher UUID'),
      fileName: z.string().describe('Name of the file to upload'),
      contentBase64: z.string().describe('Base64-encoded file content'),
      contentType: MimeTypeSchema.optional(),
    }),
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
  }, handleToolRequest(async (params) => {
    const buffer = Buffer.from(params.contentBase64, 'base64');
    return lexwareUpload(`/vouchers/${params.id}/files`, buffer, params.fileName, params.contentType || 'application/pdf');
  }));

  server.registerTool('lexware_deeplink_voucher', {
    title: 'Deeplink to Voucher',
    description: 'Get a direct link to view/edit a bookkeeping voucher in the Lexware web app.',
    inputSchema: z.object({
      voucherId: UuidSchema.describe('Voucher UUID'),
    }),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  }, handleToolRequest(async (params) => {
    return { deeplink: `${LEXWARE_APP_BASE}/permalink/vouchers/edit/${params.voucherId}` };
  }));
}
