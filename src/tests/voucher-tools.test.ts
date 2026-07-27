import { describe, it, expect, vi, beforeEach } from 'vitest';
import { z } from 'zod';
import { normalizeVoucherStatus, VOUCHER_STATUSES } from '../tools/_vouchers.js';
import { createServer } from '../server.js';
import { registerVoucherTools } from '../tools/vouchers.js';

// Behavioural coverage for the voucher querying surface: status folding, the
// post-upload retry, and auto-pagination + client-side filtering. The registry
// assertions (which tools exist, which params reach lexwareRequest) stay in
// tests/tools/vouchers.test.ts; this file drives the handlers' logic.
const mocks = vi.hoisted(() => ({
  lexwareRequest: vi.fn(),
  lexwareUpload: vi.fn(),
}));

vi.mock('../services/lexware.js', () => ({
  lexwareRequest: mocks.lexwareRequest,
  lexwareUpload: mocks.lexwareUpload,
  lexwareDownload: vi.fn(),
}));

// GOTCHA: McpServer.registerTool has overloaded signatures — use `any` + `.apply()` like smoke.test.ts.
function captureTools(registerFn: (server: ReturnType<typeof createServer>) => void) {
  const server = createServer('test');
  const captured = new Map<string, { schema: z.ZodTypeAny; handler: (params: unknown) => Promise<any> }>();
  const orig = server.registerTool;
  server.registerTool = ((...args: any[]) => {
    const [name, config, handler] = args;
    captured.set(name, { schema: config.inputSchema, handler });
    return (orig as any).apply(server, args);
  }) as typeof server.registerTool;
  registerFn(server);
  return captured;
}

const VALID_UUID = '550e8400-e29b-41d4-a716-446655440000';

// ─── normalizeVoucherStatus ───────────────────────────────────────────────────

describe('normalizeVoucherStatus', () => {
  it.each(VOUCHER_STATUSES)('returns %s unchanged (already canonical)', (status) => {
    expect(normalizeVoucherStatus(status)).toBe(status);
  });

  it.each([
    ['OPEN',        'open'],
    ['Open',        'open'],
    ['PAID',        'paid'],
    ['UNCHECKED',   'unchecked'],
    ['PaidOff',     'paidoff'],
    ['VOIDED',      'voided'],
    ['Transferred', 'transferred'],
    ['SepADebit',   'sepadebit'],
  ])('normalizes %s → %s (case-insensitive)', (input, expected) => {
    expect(normalizeVoucherStatus(input)).toBe(expected);
  });

  it('trims surrounding whitespace', () => {
    expect(normalizeVoucherStatus('  open  ')).toBe('open');
    expect(normalizeVoucherStatus('\tPAID\n')).toBe('paid');
  });

  // Deliberate: a status Lexware adds later must still fold, not throw.
  it('lowercases unknown values as a best-effort fallback', () => {
    expect(normalizeVoucherStatus('UNKNOWN')).toBe('unknown');
    expect(normalizeVoucherStatus('CustomStatus')).toBe('customstatus');
  });
});

// ─── lexware_get_voucher ──────────────────────────────────────────────────────

describe('lexware_get_voucher', () => {
  let handler: (params: unknown) => Promise<any>;

  beforeEach(() => {
    mocks.lexwareRequest.mockReset();
    handler = captureTools(registerVoucherTools).get('lexware_get_voucher')!.handler;
  });

  it('calls the correct endpoint', async () => {
    mocks.lexwareRequest.mockResolvedValue({ id: VALID_UUID, version: 1 });
    await handler({ id: VALID_UUID });
    expect(mocks.lexwareRequest).toHaveBeenCalledWith('GET', `/vouchers/${VALID_UUID}`);
  });

  it('normalizes voucherStatus to lowercase', async () => {
    mocks.lexwareRequest.mockResolvedValue({ id: VALID_UUID, version: 1, voucherStatus: 'OPEN' });
    const result = await handler({ id: VALID_UUID });
    expect(result.structuredContent.voucherStatus).toBe('open');
  });

  it('renames status → voucherStatus when voucherStatus is absent', async () => {
    mocks.lexwareRequest.mockResolvedValue({ id: VALID_UUID, version: 1, status: 'PAID' });
    const sc = (await handler({ id: VALID_UUID })).structuredContent;
    expect(sc.voucherStatus).toBe('paid');
    expect(sc.status).toBeUndefined();
  });

  it('drops the redundant status field when voucherStatus was the source', async () => {
    mocks.lexwareRequest.mockResolvedValue({
      id: VALID_UUID, version: 1,
      voucherStatus: 'open',
      status: 'OPEN', // redundant field that some API versions include
    });
    const sc = (await handler({ id: VALID_UUID })).structuredContent;
    expect(sc.voucherStatus).toBe('open');
    expect(sc.status).toBeUndefined();
  });

  it('falls back to status when voucherStatus is null', async () => {
    mocks.lexwareRequest.mockResolvedValue({ id: VALID_UUID, version: 1, voucherStatus: null, status: 'VOIDED' });
    const sc = (await handler({ id: VALID_UUID })).structuredContent;
    expect(sc.voucherStatus).toBe('voided');
  });

  it('passes the response through unchanged when no status field is present', async () => {
    const data = { id: VALID_UUID, version: 1, voucherNumber: 'RE-001' };
    mocks.lexwareRequest.mockResolvedValue(data);
    expect((await handler({ id: VALID_UUID })).structuredContent).toEqual(data);
  });

  it('preserves all other fields in the response', async () => {
    mocks.lexwareRequest.mockResolvedValue({
      id: VALID_UUID, version: 2,
      voucherStatus: 'PAID',
      voucherNumber: 'RE-2024-001',
      totalGrossAmount: 119.0,
    });
    const sc = (await handler({ id: VALID_UUID })).structuredContent;
    expect(sc.voucherNumber).toBe('RE-2024-001');
    expect(sc.totalGrossAmount).toBe(119.0);
    expect(sc.version).toBe(2);
  });
});
