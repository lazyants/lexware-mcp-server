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
