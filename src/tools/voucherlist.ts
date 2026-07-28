import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { lexwareRequest } from '../services/lexware.js';
import { handleToolRequest } from '../helpers.js';
import { UuidSchema, PaginationParams } from '../schemas/common.js';
import { MAX_PAGE_SIZE } from '../constants.js';
import { wildcardMatch } from './_vouchers.js';

// Bound on auto-pagination. At the 250-row default that is 25 000 entries, well past
// any interactive query, and it stops a pathological totalPages from turning one tool
// call into an unbounded request storm.
const MAX_AUTO_PAGES = 100;

interface VoucherlistEntry {
  contactName?: unknown;
  openAmount?: unknown;
}

interface VoucherlistResponse {
  content?: VoucherlistEntry[];
  totalPages?: number;
}

export function registerVoucherlistTools(server: McpServer): void {
  server.registerTool('lexware_list_voucherlist', {
    title: 'List Voucherlist',
    description: 'Search and filter across all voucher types in Lexware. This is the main way to find invoices, credit notes, quotations, and other voucher types.',
    inputSchema: z.object({
      ...PaginationParams,
      // GOTCHA: Don't use z.enum() for API filter params — Lexware accepts comma-separated
      // values and has more types than initially documented (e.g. purchaseinvoice, purchasecreditnote).
      // Both filters below use `.default('any')` rather than `.optional()`: the Lexware API
      // requires both to be present on every request, and the service layer's stripUndefined()
      // drops omitted keys entirely — so an optional/omitted key would never reach the query
      // string and the API would 400.
      voucherType: z.string().default('any').describe(
        'Voucher type(s), comma-separated, or "any" for no type filter (default). Values: invoice, creditnote, orderconfirmation, quotation, deliverynote, downpaymentinvoice, dunning, purchaseinvoice, purchasecreditnote'
      ),
      voucherStatus: z.string().default('any').describe(
        'Voucher status(es), comma-separated, or "any" for no status filter (default). Values: draft, open, overdue, paid, paidoff, voided, accepted, rejected, unchecked'
      ),
      contactId: UuidSchema.optional().describe('Filter by contact UUID'),
      voucherDateFrom: z.string().optional().describe('Filter vouchers from date (ISO, e.g. "2024-01-01")'),
      voucherDateTo: z.string().optional().describe('Filter vouchers to date (ISO, e.g. "2024-12-31")'),
      voucherNumber: z.string().optional().describe('Filter by voucher number'),
      archived: z.boolean().optional().describe('Filter by archived status'),
      createdDateFrom: z.string().optional().describe('Filter by creation date from (yyyy-MM-dd)'),
      createdDateTo: z.string().optional().describe('Filter by creation date to (yyyy-MM-dd)'),
      fetchAllPages: z.boolean().default(false).describe(
        'When true, follow pagination until every page is retrieved (capped at ' +
        `${MAX_AUTO_PAGES} requests) instead of returning a single page.`
      ),
      contactName: z.string().optional().describe(
        'Wildcard filter on contactName, applied client-side after fetching. ' +
        '% = any sequence, _ = exactly one character. Case-insensitive. Example: "Müller%". ' +
        'Implies fetchAllPages.'
      ),
      hasOpenAmount: z.boolean().optional().describe(
        'When true, keep only entries with openAmount > 0. Applied client-side after ' +
        'fetching. Implies fetchAllPages.'
      ),
    })
      // `page` selects one page; the aggregate modes read every page. Combining them
      // is incoherent, and the alternative — silently ignoring the caller's `page` —
      // would let someone believe an offset was honoured when it was not.
      .refine(
        (d) => !(d.page !== undefined && (d.fetchAllPages || d.contactName !== undefined || d.hasOpenAmount !== undefined)),
        {
          message:
            'page cannot be combined with fetchAllPages, contactName or hasOpenAmount — ' +
            'those modes read every page. Use size to control the batch size instead.',
        },
      ),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  }, handleToolRequest(async (params) => {
    const { fetchAllPages, contactName, hasOpenAmount, ...query } = params;

    // Default path is byte-identical to before: one request, raw API response. The
    // aggregate path only engages when the caller asks for it, so nothing that
    // relies on the passthrough shape changes underneath it.
    const clientSideFilter = contactName !== undefined || hasOpenAmount !== undefined;
    if (!fetchAllPages && !clientSideFilter) {
      return lexwareRequest('GET', '/voucherlist', undefined, query);
    }

    const pageSize = query.size ?? MAX_PAGE_SIZE;
    const all: VoucherlistEntry[] = [];
    // ALWAYS from 0. Seeding this with a caller-supplied `page` meant that `page: 5`
    // failed the `page < totalPages` guard on entry (totalPages starts at 1), so the
    // loop never ran: zero requests, empty content, and truncated:false — a filter
    // reporting "no matches" without ever having asked. The schema now rejects that
    // combination outright; this stays pinned at 0 so the bug cannot return if the
    // schema is later relaxed.
    let page = 0;
    let totalPages = 1;
    let last: VoucherlistResponse = {};
    let requests = 0;

    while (page < totalPages && requests < MAX_AUTO_PAGES) {
      last = await lexwareRequest<VoucherlistResponse>(
        'GET', '/voucherlist', undefined, { ...query, page, size: pageSize },
      );
      all.push(...(last.content ?? []));
      totalPages = last.totalPages ?? 1;
      page++;
      requests++;
    }

    let content = all;
    if (contactName !== undefined) {
      content = content.filter(
        (v) => typeof v.contactName === 'string' && wildcardMatch(contactName, v.contactName),
      );
    }
    if (hasOpenAmount === true) {
      content = content.filter((v) => typeof v.openAmount === 'number' && v.openAmount > 0);
    }

    // Spread the last response so API-provided fields (totalElements, etc.) survive,
    // then override content and state plainly what this aggregate actually did.
    // `truncated` is reported rather than hidden: a silently short list reads as
    // "that is all there is", the one answer a caller must never be given wrongly.
    return {
      ...last,
      content,
      filteredCount: content.length,
      fetchedPages: requests,
      truncated: page < totalPages,
    };
  }));
}
