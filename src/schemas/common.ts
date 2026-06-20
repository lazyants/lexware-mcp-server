import { z } from 'zod';

export const UuidSchema = z.string().uuid().describe('Resource UUID');

export const PaginationParams = {
  page: z.number().int().min(0).optional().describe('Page number (0-indexed)'),
  size: z.number().int().min(1).max(250).optional().describe('Results per page (max 250)'),
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
