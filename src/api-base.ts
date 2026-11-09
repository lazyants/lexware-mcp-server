import { LEXWARE_API_BASE } from './constants.js';

const INVALID =
  `LEXWARE_API_BASE must be an absolute http or https URL without credentials, query or fragment (unset or empty means ${LEXWARE_API_BASE}).`;

/**
 * Parse `LEXWARE_API_BASE`, the base URL of the Lexware REST API. Unset or empty (after trimming)
 * means the real gateway. Any other value must be an absolute http or https URL without
 * credentials, query or fragment; one trailing slash is dropped, so `…/v1/` and `…/v1` agree.
 *
 * Any other value throws. A typo must not fall back to the real gateway: a server meant to talk to
 * a test double would otherwise write into the live account without notice, so the server refuses
 * to start instead.
 */
export function parseApiBase(value: string | undefined): string {
  const trimmed = value?.trim() ?? '';
  if (trimmed === '') return LEXWARE_API_BASE;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error(INVALID);
  }
  if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.username || url.password || url.search || url.hash) {
    throw new Error(INVALID);
  }
  return url.href.replace(/\/$/, '');
}

export function apiBaseFromEnv(): string {
  return parseApiBase(process.env.LEXWARE_API_BASE);
}
