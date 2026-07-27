import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { UuidSchema, PaginationParams, VersionParam, MimeTypeSchema } from '../schemas/common.js';

describe('UuidSchema', () => {
  it('accepts valid UUIDs', () => {
    expect(UuidSchema.parse('550e8400-e29b-41d4-a716-446655440000')).toBe('550e8400-e29b-41d4-a716-446655440000');
    expect(UuidSchema.parse('6ba7b810-9dad-11d1-80b4-00c04fd430c8')).toBe('6ba7b810-9dad-11d1-80b4-00c04fd430c8');
  });

  it('rejects invalid UUIDs', () => {
    expect(() => UuidSchema.parse('not-a-uuid')).toThrow();
    expect(() => UuidSchema.parse('')).toThrow();
    expect(() => UuidSchema.parse('12345')).toThrow();
    expect(() => UuidSchema.parse('550e8400-e29b-41d4-a716')).toThrow();
  });
});

describe('PaginationParams', () => {
  const schema = z.object({ ...PaginationParams });

  it('accepts valid page and size', () => {
    expect(schema.parse({ page: 0, size: 25 })).toEqual({ page: 0, size: 25 });
  });

  it('accepts page 0 (0-indexed)', () => {
    expect(schema.parse({ page: 0 })).toEqual({ page: 0 });
  });

  it('rejects negative page', () => {
    expect(() => schema.parse({ page: -1 })).toThrow();
  });

  it('rejects size exceeding max', () => {
    expect(() => schema.parse({ size: 251 })).toThrow();
  });

  it('rejects size of 0', () => {
    expect(() => schema.parse({ size: 0 })).toThrow();
  });

  it('accepts empty object (all optional)', () => {
    expect(schema.parse({})).toEqual({});
  });
});

describe('VersionParam', () => {
  const schema = z.object({ ...VersionParam });

  it('accepts valid version', () => {
    expect(schema.parse({ version: 0 })).toEqual({ version: 0 });
    expect(schema.parse({ version: 5 })).toEqual({ version: 5 });
  });

  it('rejects negative version', () => {
    expect(() => schema.parse({ version: -1 })).toThrow();
  });
});

// Boundary schema for the two upload tools' contentType param (#88). The full
// cross-layer agreement corpus against the sink guard lives in
// upload-body.test.ts (D2); this file only pins the schema's own shape.
describe('MimeTypeSchema', () => {
  it('accepts a plain type/subtype', () => {
    expect(MimeTypeSchema.parse('application/pdf')).toBe('application/pdf');
  });

  it('accepts a type/subtype with a parameter tail', () => {
    expect(MimeTypeSchema.parse('application/pdf; charset=utf-8')).toBe(
      'application/pdf; charset=utf-8'
    );
  });

  it('rejects a value with no slash', () => {
    expect(() => MimeTypeSchema.parse('not-a-mime-type')).toThrow();
  });

  // D3: '' is rejected at the boundary, not silently defaulted — see D2's shared
  // corpus for the full rationale.
  it('rejects an empty string', () => {
    expect(() => MimeTypeSchema.parse('')).toThrow();
  });
});
