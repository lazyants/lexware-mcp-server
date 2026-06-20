import { describe, expect, it } from 'vitest';
import { parseRetryAfterMs } from '../services/lexware.js';

// Unit tests for the pure Retry-After parser. A bare parseInt turned an HTTP-date
// into NaN → setTimeout(NaN) fired immediately and defeated the backoff; these
// lock in delta-seconds + HTTP-date support and the finite, non-negative clamp.

const MAX = 2_147_483_647; // setTimeout ceiling

describe('parseRetryAfterMs', () => {
  it('returns null when the header is absent', () => {
    expect(parseRetryAfterMs(undefined)).toBeNull();
    expect(parseRetryAfterMs('')).toBeNull();
  });

  it('parses delta-seconds into milliseconds', () => {
    expect(parseRetryAfterMs('120')).toBe(120_000);
    expect(parseRetryAfterMs('0')).toBe(0);
    expect(parseRetryAfterMs('  30  ')).toBe(30_000);
  });

  it('parses an HTTP-date relative to now, never negative', () => {
    const now = Date.parse('2025-10-21T07:28:00Z'); // 2025-10-21 is a Tuesday
    expect(parseRetryAfterMs('Tue, 21 Oct 2025 07:28:05 GMT', now)).toBe(5_000);
    // A date already in the past clamps to 0 instead of going negative.
    expect(parseRetryAfterMs('Tue, 21 Oct 2025 07:27:00 GMT', now)).toBe(0);
  });

  it('rejects an IMF-fixdate whose day-name does not match the date', () => {
    // 2025-10-21 is a Tuesday; a "Wed"/garbage weekday means a corrupt header, so
    // we reject it (→ exponential backoff) rather than trust a malformed value.
    const now = Date.parse('2025-10-21T07:28:00Z');
    expect(parseRetryAfterMs('Wed, 21 Oct 2025 07:28:05 GMT', now)).toBeNull();
    expect(parseRetryAfterMs('Foo, 21 Oct 2025 07:28:05 GMT', now)).toBeNull();
  });

  it('returns null for an unparseable value so the caller can back off', () => {
    expect(parseRetryAfterMs('soon')).toBeNull();
    expect(parseRetryAfterMs('not-a-date')).toBeNull();
  });

  it('rejects obsolete RFC 850 / asctime HTTP-dates instead of mis-parsing them', () => {
    // Date.parse maps RFC 850 two-digit years to 19xx (not the spec's sliding
    // window) and reads asctime in local time, so a valid future Retry-After could
    // become 0 → immediate retry. We only accept IMF-fixdate; everything else is
    // null so the caller uses exponential backoff rather than a wrong delay.
    const now = Date.parse('2026-06-20T00:00:00Z');
    expect(parseRetryAfterMs('Sunday, 06-Nov-94 08:49:37 GMT', now)).toBeNull();
    expect(parseRetryAfterMs('Sun Nov  6 08:49:37 2094', now)).toBeNull();
  });

  it('rejects IMF-fixdate-shaped values whose fields are invalid or normalized', () => {
    // These match the regex shape but are not exact UTC instants; without the
    // round-trip check Date.UTC silently normalizes them to a WRONG delay.
    expect(parseRetryAfterMs('Wed, 31 Feb 2025 07:28:05 GMT')).toBeNull(); // Feb 31 → Mar 3
    expect(parseRetryAfterMs('Wed, 29 Feb 2025 07:28:05 GMT')).toBeNull(); // 2025 not a leap year
    expect(parseRetryAfterMs('Wed, 21 Oct 2025 25:00:00 GMT')).toBeNull(); // hour 25
    expect(parseRetryAfterMs('Wed, 00 Oct 2025 07:28:05 GMT')).toBeNull(); // day 0
    expect(parseRetryAfterMs('Wed, 01 Jan 0027 00:00:00 GMT')).toBeNull(); // year 0-99 → Date.UTC 19xx
    expect(parseRetryAfterMs('Wed, 99 Oct 2025 07:28:05 GMT')).toBeNull(); // day 99
  });

  it('accepts a valid leap-day IMF-fixdate', () => {
    const now = Date.parse('2024-02-29T00:00:00Z');
    expect(parseRetryAfterMs('Thu, 29 Feb 2024 00:00:30 GMT', now)).toBe(30_000);
  });

  it('clamps absurd delays to the setTimeout ceiling (no overflow-to-immediate)', () => {
    expect(parseRetryAfterMs('999999999')).toBe(MAX);
    const now = Date.parse('2025-01-01T00:00:00Z');
    expect(parseRetryAfterMs('Fri, 01 Jan 2100 00:00:00 GMT', now)).toBe(MAX);
  });
});
