import { z } from 'zod';
import { MAX_PAGE_SIZE } from '../constants.js';

export const UuidSchema = z.string().uuid().describe('Resource UUID');

export const PaginationParams = {
  page: z.number().int().min(0).optional().describe('Page number (0-indexed)'),
  size: z
    .number()
    .int()
    .min(1)
    .max(MAX_PAGE_SIZE)
    .optional()
    .describe(`Results per page (max ${MAX_PAGE_SIZE})`),
};

export const VersionParam = {
  version: z.number().int().min(0).describe('Resource version for optimistic locking'),
};

export const SortParam = {
  sort: z.string().optional().describe('Sort field and direction, e.g. "createdDate,DESC"'),
};

// Optional download representation selector for the three XRechnung-capable voucher
// download tools (invoices, credit notes, down-payment invoices). Defaults to 'pdf'
// so existing behaviour is byte-for-byte unchanged; 'xml' requests the XRechnung XML
// e-invoice. NOT applied to the PDF-only download tools (quotations, delivery notes,
// dunnings, order confirmations — the Lexware API returns 406 for non-PDF there) or
// the generic `lexware_download_file` tool.
export const DownloadFormat = z
  .enum(['pdf', 'xml'])
  .default('pdf')
  .describe(
    'Representation to request: "pdf" (default) or "xml" for the XRechnung XML e-invoice when available.'
  );

// Map the format selector to the Accept header the Lexware API expects.
export function downloadAccept(format: 'pdf' | 'xml' = 'pdf'): string {
  return format === 'xml' ? 'application/xml' : 'application/pdf';
}

// Per-tool fallback filename when the API omits content-disposition. Preserves each
// tool's existing `<resource>.pdf` name on the PDF/default path; only swaps to `.xml`
// when the API actually returned an XML content type, so PDF downloads keep their
// historical names byte-for-byte.
export function downloadFallbackName(resource: string, contentType: string): string {
  const ext = /xml/i.test(contentType) ? 'xml' : 'pdf';
  return `${resource}.${ext}`;
}

// Parameter-tolerant MIME `type/subtype[; params]` grammar (#67). A STRICT
// `type/subtype` regex would reject legitimate values the sink itself accepts
// (e.g. `application/pdf; charset=utf-8`), so the parameter tail is deliberately
// permissive about STRUCTURE — but every character in it is constrained to the
// printable-ASCII range 0x20-0x7E, not merely "not CR/LF". Two reasons, one
// historical and one current:
//
// (1) WHY THE GUARD EXISTS (historical, #67). The upload path then used the
//     `form-data` package, whose `_getContentType` wrote `contentType` into the
//     multipart part header VERBATIM — it escaped the field name and filename via
//     `escapeHeaderParam` but not this value — so a CR/LF payload injected real
//     headers, and a tab/NUL/other control byte was just as injectable in a raw
//     header block. That package is GONE (#74.1): uploads now build a native
//     `FormData`/`Blob` and axios serializes them, and axios strips `\r`/`\n` from
//     a part's Content-Type itself (`helpers/formDataToStream.js`). Do not read
//     this clause as describing today's sink — it does not.
//
// (2) WHY THE RANGE IS STILL 0x20-0x7E (current, and load-bearing). The `Blob`
//     constructor's own `type` normalization blanks the ENTIRE type to "" on ANY
//     character outside 0x20-0x7E, not just CR/LF (§1.3b). A guard narrowed to
//     CR/LF would therefore admit values that silently degrade to
//     `application/octet-stream` — recreating the exact silent-degradation failure
//     this guard exists to prevent. Matching Blob's own filter range is what closes
//     that gap, and it is the reason the range must not be relaxed.
//
// Shared by the MCP input boundary (MimeTypeSchema below) and the service-layer
// sink guard (assertValidMimeType in services/lexware.ts) — one exported regex so
// the two layers cannot drift apart (#88). Neither the `g` nor the `y` flag is set,
// so `lastIndex` always stays 0 and this shared object cannot leak match state
// between the two layers' independent `.test()` calls.
export const MIME_TYPE_RE = /^[A-Za-z0-9!#$%&'*+.^_`|~-]+\/[A-Za-z0-9!#$%&'*+.^_`|~-]+(;[\x20-\x7E]*)?$/;

// Boundary schema for the two upload tools' `contentType` param. `z.string()`
// rejects non-primitive-string inputs outright (an array, a boxed String) before
// the regex ever runs, so this boundary is strictly at least as strict as the
// sink guard's `RegExp.test`, which coerces first — never looser (#88).
export const MimeTypeSchema = z
  .string()
  .regex(MIME_TYPE_RE)
  .describe('MIME type, defaults to application/pdf');
