/**
 * Canonical voucher status values, as the Lexware API spells them.
 *
 * The API is inconsistent about casing across endpoints and returns the status
 * under `status` on some responses and `voucherStatus` on others, so both the
 * values it returns and the values a caller filters on are folded to one form
 * before anything compares them. Without that, a filter for "Open" silently
 * matches nothing — the worst failure shape here, since an empty result set
 * looks like a legitimate answer.
 */
export const VOUCHER_STATUSES = [
  'unchecked',   // pending review
  'open',        // due for payment
  'paid',        // paid
  'paidoff',     // settled
  'voided',      // cancelled
  'transferred', // posted
  'sepadebit',   // SEPA direct debit
] as const;

/**
 * Fold a status to canonical form.
 *
 * Deliberately does NOT validate against VOUCHER_STATUSES. That list is what
 * Lexware documents today; a status added later must still fold to something that
 * compares sensibly on both sides rather than throwing on a value the API itself
 * considers valid.
 */
export function normalizeVoucherStatus(status: string): string {
  return status.toLowerCase().trim();
}

/**
 * SQL-style wildcard match: `%` is any run of characters, `_` exactly one.
 * Case-insensitive.
 *
 * Implemented as an O(m×n) dynamic program rather than by translating the pattern
 * into a RegExp. The pattern is caller-supplied, and a translated `%`-heavy pattern
 * is exactly the shape that backtracks catastrophically — this cannot, since each
 * cell is computed once.
 */
export function wildcardMatch(pattern: string, text: string): boolean {
  const p = pattern.toLowerCase();
  const t = text.toLowerCase();
  const m = p.length;
  const n = t.length;

  // dp[i][j]: does the first i chars of the pattern match the first j of the text?
  const dp: boolean[][] = Array.from({ length: m + 1 }, () => new Array<boolean>(n + 1).fill(false));
  dp[0][0] = true;
  // A leading run of '%' can match the empty text.
  for (let i = 1; i <= m; i++) {
    if (p[i - 1] === '%') dp[i][0] = dp[i - 1][0];
  }

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (p[i - 1] === '%') {
        // '%' either consumes nothing (dp[i-1][j]) or one more char (dp[i][j-1]).
        dp[i][j] = dp[i - 1][j] || dp[i][j - 1];
      } else if (p[i - 1] === '_' || p[i - 1] === t[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1];
      }
    }
  }
  return dp[m][n];
}

/**
 * Read a voucher's status from either field name, fold it, and write it back under
 * the canonical `voucherStatus` key — dropping the `status` alias so a caller never
 * has to decide which of two disagreeing fields to trust.
 *
 * Mutates and returns the same object: the response is freshly deserialized per
 * request and not shared, and copying whole voucher payloads to change one key
 * would be wasteful.
 */
export function normalizeVoucherResponse(voucher: Record<string, unknown>): Record<string, unknown> {
  const raw = voucher.voucherStatus ?? voucher.status;
  // Only collapse the two keys when a usable status was actually found — otherwise
  // an unexpected non-string `status` would be silently deleted rather than passed
  // through for the caller to see.
  if (typeof raw === 'string') {
    voucher.voucherStatus = normalizeVoucherStatus(raw);
    delete voucher.status;
  }
  return voucher;
}
