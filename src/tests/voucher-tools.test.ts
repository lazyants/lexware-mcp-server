import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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

// ─── lexware_list_vouchers — auto-pagination ──────────────────────────────────

describe('lexware_list_vouchers — auto-pagination', () => {
  let handler: (params: unknown) => Promise<any>;

  beforeEach(() => {
    mocks.lexwareRequest.mockReset();
    mocks.lexwareRequest.mockResolvedValue({ content: [], totalPages: 1 });
    handler = captureTools(registerVoucherTools).get('lexware_list_vouchers')!.handler;
  });

  it('forwards voucherNumber and batch size, always starting at page 0', async () => {
    await handler({ size: 50, voucherNumber: 'RE-001' });
    expect(mocks.lexwareRequest).toHaveBeenCalledWith(
      'GET', '/vouchers', undefined,
      { page: 0, size: 50, voucherNumber: 'RE-001' },
    );
  });

  it('defaults the batch size to 250 when size is omitted', async () => {
    await handler({});
    expect(mocks.lexwareRequest).toHaveBeenCalledWith(
      'GET', '/vouchers', undefined,
      expect.objectContaining({ page: 0, size: 250 }),
    );
  });

  // #65: the API ignores voucherStatus on GET /vouchers. Sending it would look
  // like a filter while returning unfiltered results.
  it('never forwards voucherStatus as a query param', async () => {
    await handler({ voucherStatus: 'OPEN' });
    const params = mocks.lexwareRequest.mock.calls[0][3];
    expect(params).not.toHaveProperty('voucherStatus');
  });

  it('returns the { content, totalCount, fetchedPages, truncated } shape', async () => {
    mocks.lexwareRequest.mockResolvedValue({ content: [{ id: 'v1' }], totalPages: 1 });
    const sc = (await handler({})).structuredContent;
    expect(sc).toEqual({ content: [{ id: 'v1' }], totalCount: 1, fetchedPages: 1, truncated: false });
  });

  it('auto-paginates until totalPages is exhausted', async () => {
    mocks.lexwareRequest
      .mockResolvedValueOnce({ content: [{ id: 'v1' }, { id: 'v2' }], totalPages: 2 })
      .mockResolvedValueOnce({ content: [{ id: 'v3' }], totalPages: 2 });
    const sc = (await handler({ size: 2 })).structuredContent;
    expect(sc.content).toHaveLength(3);
    expect(sc.totalCount).toBe(3);
    expect(sc.fetchedPages).toBe(2);
    expect(sc.truncated).toBe(false);
    expect(mocks.lexwareRequest).toHaveBeenCalledTimes(2);
    expect(mocks.lexwareRequest).toHaveBeenNthCalledWith(1, 'GET', '/vouchers', undefined, expect.objectContaining({ page: 0 }));
    expect(mocks.lexwareRequest).toHaveBeenNthCalledWith(2, 'GET', '/vouchers', undefined, expect.objectContaining({ page: 1 }));
  });

  it('tolerates a response with no content array', async () => {
    mocks.lexwareRequest.mockResolvedValue({ totalPages: 1 });
    const sc = (await handler({})).structuredContent;
    expect(sc.content).toEqual([]);
    expect(sc.totalCount).toBe(0);
  });

  // A silently short result set reads as "that's all there is" — the one wrong
  // answer this must never give.
  it('stops at the page cap and flags the result as truncated', async () => {
    mocks.lexwareRequest.mockResolvedValue({ content: [{ id: 'v' }], totalPages: 5_000 });
    const sc = (await handler({})).structuredContent;
    expect(sc.fetchedPages).toBe(100);
    expect(sc.truncated).toBe(true);
    expect(mocks.lexwareRequest).toHaveBeenCalledTimes(100);
  });
});

// ─── lexware_list_vouchers — client-side filters ──────────────────────────────

describe('lexware_list_vouchers — client-side filters', () => {
  let schema: z.ZodTypeAny;
  let handler: (params: unknown) => Promise<any>;

  const vouchers = [
    { id: 'v1', contactName: 'Müller GmbH', voucherDate: '2024-01-10', openAmount: 100, voucherStatus: 'OPEN' },
    { id: 'v2', contactName: 'Büroplus AG', voucherDate: '2024-03-15', openAmount: 0,   voucherStatus: 'paid' },
    { id: 'v3', contactName: 'Müller & Co', voucherDate: '2024-06-01', openAmount: 50,  voucherStatus: 'open' },
    { id: 'v4', contactName: 'Technik GmbH', voucherDate: '2024-08-20', openAmount: 200, status: 'Open' },
  ];

  const ids = (result: any) => result.structuredContent.content.map((v: any) => v.id);

  beforeEach(() => {
    mocks.lexwareRequest.mockReset();
    mocks.lexwareRequest.mockResolvedValue({ content: vouchers, totalPages: 1 });
    const tool = captureTools(registerVoucherTools).get('lexware_list_vouchers')!;
    schema = tool.schema;
    handler = tool.handler;
  });

  it('contactName % wildcard matches a prefix', async () => {
    expect(ids(await handler({ contactName: 'Müller%' }))).toEqual(['v1', 'v3']);
  });

  it('contactName % wildcard matches a suffix', async () => {
    expect(ids(await handler({ contactName: '%GmbH' }))).toEqual(['v1', 'v4']);
  });

  it('contactName _ wildcard matches exactly one char', async () => {
    // 'Müller & Co': the _ matches the single '&' between the two spaces
    expect(ids(await handler({ contactName: 'Müller _ Co' }))).toEqual(['v3']);
  });

  it('contactName filter is case-insensitive', async () => {
    expect(ids(await handler({ contactName: 'BÜROPLUS%' }))).toEqual(['v2']);
  });

  it('voucherStatus filter is case-insensitive on both sides and reads either field', async () => {
    // v1 'OPEN' (voucherStatus), v3 'open' (voucherStatus), v4 'Open' (status alias)
    expect(ids(await handler({ voucherStatus: 'Open' }))).toEqual(['v1', 'v3', 'v4']);
  });

  it('voucherDateFrom filters inclusively', async () => {
    expect(ids(await handler({ voucherDateFrom: '2024-06-01' }))).toEqual(['v3', 'v4']);
  });

  it('voucherDateTo filters inclusively', async () => {
    expect(ids(await handler({ voucherDateTo: '2024-03-15' }))).toEqual(['v1', 'v2']);
  });

  it('voucherDateTo includes a same-day voucher carrying a time component', async () => {
    mocks.lexwareRequest.mockResolvedValue({
      content: [{ id: 'vt', voucherDate: '2024-03-15T09:00:00.000+01:00' }],
      totalPages: 1,
    });
    expect(ids(await handler({ voucherDateTo: '2024-03-15' }))).toEqual(['vt']);
  });

  it('voucherDateFrom + voucherDateTo form an inclusive range', async () => {
    expect(ids(await handler({ voucherDateFrom: '2024-03-15', voucherDateTo: '2024-06-01' }))).toEqual(['v2', 'v3']);
  });

  it('hasOpenAmount: true excludes vouchers with openAmount === 0', async () => {
    expect(ids(await handler({ hasOpenAmount: true }))).toEqual(['v1', 'v3', 'v4']);
  });

  it('multiple filters combine as AND', async () => {
    expect(ids(await handler({ contactName: 'Müller%', hasOpenAmount: true }))).toEqual(['v1', 'v3']);
  });

  it('returns an empty content array when nothing matches', async () => {
    const result = await handler({ contactName: 'Nonexistent%' });
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent.content).toEqual([]);
    expect(result.structuredContent.totalCount).toBe(0);
  });

  it.each([
    ['voucherDateFrom', 'January 2024'],
    ['voucherDateTo', '15.01.2024'],
  ])('rejects %s that is not YYYY-MM-DD', (field, value) => {
    expect(schema.safeParse({ [field]: value }).success).toBe(false);
  });

  it('accepts YYYY-MM-DD bounds', () => {
    expect(schema.safeParse({ voucherDateFrom: '2024-01-15', voucherDateTo: '2024-12-31' }).success).toBe(true);
  });
});

// ─── lexware_get_voucher — post-upload retry ──────────────────────────────────

describe('lexware_get_voucher — retry behaviour', () => {
  let handler: (params: unknown) => Promise<any>;

  const notFound = () => Object.assign(new Error('Not Found'), { cause: { response: { status: 404 } } });

  beforeEach(() => {
    mocks.lexwareRequest.mockReset();
    vi.useFakeTimers();
    handler = captureTools(registerVoucherTools).get('lexware_get_voucher')!.handler;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns the soft processing response after exhausting 3 retries on 404', async () => {
    mocks.lexwareRequest.mockRejectedValue(notFound());

    const promise = handler({ id: VALID_UUID });
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.isError).toBeUndefined();
    expect(result.structuredContent.status).toBe('processing');
    expect(result.structuredContent.voucherId).toBe(VALID_UUID);
    expect(result.structuredContent.message).toContain('retry');
    expect(mocks.lexwareRequest).toHaveBeenCalledTimes(3);
  });

  it('returns the voucher on the second attempt after an initial 404', async () => {
    mocks.lexwareRequest
      .mockRejectedValueOnce(notFound())
      .mockResolvedValue({ id: VALID_UUID, voucherStatus: 'OPEN', version: 1 });

    const promise = handler({ id: VALID_UUID });
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.isError).toBeUndefined();
    expect(result.structuredContent.voucherStatus).toBe('open');
    expect(mocks.lexwareRequest).toHaveBeenCalledTimes(2);
  });

  // A 500/401 reported as "still processing" would send the caller into a wait for
  // something that never arrives, and bury the real fault.
  it('surfaces a non-404 as a tool error instead of a processing response', async () => {
    mocks.lexwareRequest.mockRejectedValue(new Error('Internal Server Error'));

    const result = await handler({ id: VALID_UUID });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Internal Server Error');
    expect(mocks.lexwareRequest).toHaveBeenCalledTimes(1);
  });
});
