export const LEXWARE_API_BASE = 'https://api.lexware.io/v1';
export const LEXWARE_APP_BASE = 'https://app.lexware.de';
export const MAX_PAGE_SIZE = 250;
// Lexware rejects larger uploads server-side; checked client-side so the caller
// gets an actionable error instead of paying to stream the body first.
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
export const MAX_RETRIES = 3;
export const REQUEST_TIMEOUT = 30_000;
