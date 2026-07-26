import { describe, it, expect } from 'vitest';
import { parseContentDispositionFileName } from '../services/lexware.js';

// #63 Content-Disposition filename parser. The old code was a single regex,
// `/filename="?([^";\s]+)"?/`, which truncated at the first space and had no
// support at all for RFC 5987/8187 `filename*=` (a literal `=` right after
// `filename` never matches `filename*=`, so it produced no match, not a
// mis-capture — see §1.1 in the plan).
describe('parseContentDispositionFileName', () => {
  it('parses the plain token form', () => {
    expect(parseContentDispositionFileName('attachment; filename=invoice.pdf')).toBe(
      'invoice.pdf',
    );
  });

  it('parses the quoted-string form with spaces', () => {
    expect(
      parseContentDispositionFileName('attachment; filename="my invoice.pdf"'),
    ).toBe('my invoice.pdf');
  });

  it('unescapes a backslash-escaped quote inside a quoted-string value', () => {
    expect(
      parseContentDispositionFileName('attachment; filename="quote \\" here.pdf"'),
    ).toBe('quote " here.pdf');
  });

  it('returns undefined when there is no filename parameter at all', () => {
    expect(parseContentDispositionFileName('attachment')).toBeUndefined();
    expect(parseContentDispositionFileName('inline')).toBeUndefined();
  });

  describe('RFC 5987/8187 filename*=', () => {
    it('decodes a UTF-8 percent-encoded extended value', () => {
      expect(
        parseContentDispositionFileName("attachment; filename*=UTF-8''%e2%82%ac%20rates.pdf"),
      ).toBe('€ rates.pdf');
    });

    it('decodes an ISO-8859-1 percent-encoded extended value', () => {
      expect(
        parseContentDispositionFileName("attachment; filename*=ISO-8859-1''%A3%20rates.pdf"),
      ).toBe('£ rates.pdf');
    });

    // RFC 6266 §4.3: filename* MUST win when both forms are present.
    it('prefers filename* over a plain filename when both are present', () => {
      expect(
        parseContentDispositionFileName(
          'attachment; filename*=UTF-8\'\'%e2%82%ac%20rates.pdf; filename="rates.pdf"',
        ),
      ).toBe('€ rates.pdf');
    });

    // Unknown charset -> fall through to the plain filename, same as an
    // undecodable-bytes failure below.
    it('falls through to the plain filename on an unsupported charset', () => {
      expect(
        parseContentDispositionFileName(
          'filename*=UNKNOWN\'\'%41.pdf; filename="fallback.pdf"',
        ),
      ).toBe('fallback.pdf');
    });

    // §1.3: "unknown charset -> fall through" is not the same as "undecodable
    // bytes -> fall through". A naive Buffer.toString('utf8') never throws — it
    // substitutes U+FFFD — so this must use TextDecoder('utf-8', { fatal: true }).
    it('falls through to the plain filename when the UTF-8 bytes are undecodable', () => {
      expect(
        parseContentDispositionFileName(
          "filename*=UTF-8''%FF%FE.pdf; filename=\"ok.pdf\"",
        ),
      ).toBe('ok.pdf');
    });

    it('returns undefined when filename* is undecodable and there is no plain fallback', () => {
      expect(parseContentDispositionFileName("filename*=UTF-8''%FF%FE.pdf")).toBeUndefined();
    });
  });

  describe('acknowledged limitations (pinned, not accidental)', () => {
    // (i) three anchored regexes, not a parameter tokenizer: a `;` inside ANOTHER
    // parameter's quoted value re-opens the `(?:^|;)` anchor. The prior code had
    // the identical weakness; harmless because the result is sanitized regardless
    // of which parameter "won".
    it('a semicolon inside another quoted parameter can still leak into the match', () => {
      expect(
        parseContentDispositionFileName('attachment; foo="a; filename=evil.pdf"'),
      ).toBe('evil.pdf');
    });

    // (ii) RFC 2231 continuations (filename*0*=..., filename*1*=...) are
    // unsupported and fall back to the plain filename, or undefined if there is
    // none.
    it('does not support RFC 2231 continuations — falls through to the plain filename', () => {
      expect(
        parseContentDispositionFileName(
          "filename*0*=UTF-8''foo; filename*1*=bar.pdf; filename=\"static.pdf\"",
        ),
      ).toBe('static.pdf');
    });

    it('does not support RFC 2231 continuations — undefined with no plain fallback', () => {
      expect(
        parseContentDispositionFileName("filename*0*=UTF-8''foo; filename*1*=bar.pdf"),
      ).toBeUndefined();
    });
  });

  describe('sanitization', () => {
    it('takes only the last path segment, defusing an embedded directory component', () => {
      expect(
        parseContentDispositionFileName('attachment; filename="../../etc/passwd"'),
      ).toBe('passwd');
    });

    it('rejects "." and ".." after sanitizing to a bare path-relative token', () => {
      expect(parseContentDispositionFileName('attachment; filename=".."')).toBeUndefined();
      expect(parseContentDispositionFileName('attachment; filename="."')).toBeUndefined();
    });

    it('rejects an empty filename', () => {
      expect(parseContentDispositionFileName('attachment; filename=""')).toBeUndefined();
    });

    // eslint's no-control-regex rule forbids a literal /[\x00-\x1f]/, so this must
    // be a code-point filter, not a regex character class. Uses String.fromCharCode
    // rather than an embedded literal control byte in the source file.
    it('drops C0 control characters and DEL by code point', () => {
      const raw = 'a' + String.fromCharCode(0x07) + 'b' + String.fromCharCode(0x7f) + 'c.pdf';
      expect(parseContentDispositionFileName(`attachment; filename="${raw}"`)).toBe('abc.pdf');
    });

    it('caps at 255 code points without splitting a surrogate pair', () => {
      const emoji = '\u{1F600}'; // 1 code point, 2 UTF-16 code units
      const longName = emoji.repeat(300) + '.pdf';
      const header = `attachment; filename="${longName}"`;
      const result = parseContentDispositionFileName(header);
      expect(result).toBeDefined();
      const codePoints = Array.from(result as string);
      expect(codePoints.length).toBe(255);
      // Every retained code point is a complete emoji — none is a lone surrogate,
      // which is what a naive .slice(0, 255) on UTF-16 units could produce.
      expect(codePoints.every((cp) => cp === emoji)).toBe(true);
    });
  });
});
