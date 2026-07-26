import { lexwareDownload } from '../services/lexware.js';

export interface DownloadFileResult {
  fileName: string;
  contentType: string;
  contentBase64: string;
}

/**
 * Shared body for the 8 `lexware_download_*` tools: fetches the file, applies
 * the fallback name, and base64-encodes the payload.
 *
 * `fallbackName` is a literal for the 5 PDF-only tools, or a function of the
 * resolved `contentType` for the 3 XRechnung-capable tools (which need
 * `downloadFallbackName(resource, contentType)`). The fallback uses `||`, not
 * `??` — an empty-string `fileName` from the API must still fall through, not
 * just a missing one.
 *
 * `accept` is only forwarded to `lexwareDownload` when the caller passes one:
 * the PDF-only tools call it with a single argument, matching `lexwareDownload`'s
 * own `application/pdf` default and the exact call arity existing tests assert.
 */
export async function downloadFileResult(
  path: string,
  fallbackName: string | ((contentType: string) => string),
  accept?: string,
): Promise<DownloadFileResult> {
  const file = accept !== undefined ? await lexwareDownload(path, accept) : await lexwareDownload(path);
  const fallback = typeof fallbackName === 'function' ? fallbackName(file.contentType) : fallbackName;
  return {
    fileName: file.fileName || fallback,
    contentType: file.contentType,
    contentBase64: file.data.toString('base64'),
  };
}
