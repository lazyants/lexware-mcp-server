import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { z } from 'zod';
import { normalizeVoucherStatus, VOUCHER_STATUSES } from '../tools/_vouchers.js';
import { createServer } from '../server.js';
import { registerVoucherTools } from '../tools/vouchers.js';
import { registerVoucherlistTools } from '../tools/voucherlist.js';

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

// ─── lexware_list_vouchers — lookup by number ─────────────────────────────────

describe('lexware_list_vouchers', () => {
  let schema: z.ZodTypeAny;
  let handler: (params: unknown) => Promise<any>;

  beforeEach(() => {
    mocks.lexwareRequest.mockReset();
    mocks.lexwareRequest.mockResolvedValue({ content: [] });
    const tool = captureTools(registerVoucherTools).get('lexware_list_vouchers')!;
    schema = tool.schema;
    handler = tool.handler;
  });

  // Verified against the live API: GET /vouchers without voucherNumber answers
  // 400 {"IssueList":[{"source":"voucherNumber parameter is required"}]}. It is a
  // lookup endpoint, not a browsable collection, so the schema has to say so.
  it('requires voucherNumber', () => {
    expect(schema.safeParse({}).success).toBe(false);
    expect(schema.safeParse({ voucherNumber: 'RE-001' }).success).toBe(true);
  });

  it('forwards voucherNumber with pagination straight through', async () => {
    await handler({ voucherNumber: 'RE-001', page: 0, size: 100 });
    expect(mocks.lexwareRequest).toHaveBeenCalledExactlyOnceWith(
      'GET', '/vouchers', undefined,
      { page: 0, size: 100, voucherNumber: 'RE-001' },
    );
  });

  // The browsing/filtering surface belongs to /voucherlist now; nothing here may
  // quietly reintroduce a filter this endpoint cannot serve.
  it.each(['contactName', 'hasOpenAmount', 'voucherStatus', 'voucherDateFrom'])(
    'does not expose the %s filter (that lives on lexware_list_voucherlist)',
    (field) => {
      expect(Object.keys((schema as unknown as { shape: object }).shape)).not.toContain(field);
    },
  );
});

// ─── lexware_list_voucherlist — auto-pagination + client-side filters ─────────

describe('lexware_list_voucherlist', () => {
  let handler: (params: unknown) => Promise<any>;

  const entries = [
    { id: 'v1', contactName: 'Müller GmbH', openAmount: 100 },
    { id: 'v2', contactName: 'Büroplus AG', openAmount: 0 },
    { id: 'v3', contactName: 'Müller & Co', openAmount: 50 },
    { id: 'v4', contactName: 'Technik GmbH', openAmount: 200 },
  ];

  const ids = (r: any) => r.structuredContent.content.map((v: any) => v.id);

  beforeEach(() => {
    mocks.lexwareRequest.mockReset();
    mocks.lexwareRequest.mockResolvedValue({ content: entries, totalPages: 1, totalElements: 4 });
    handler = captureTools(registerVoucherlistTools).get('lexware_list_voucherlist')!.handler;
  });

  // The default path must stay exactly what it was before this change, or every
  // existing caller of the raw passthrough shape breaks.
  it('passes through unchanged when neither fetchAllPages nor a client filter is set', async () => {
    const result = await handler({ voucherType: 'any', voucherStatus: 'any', fetchAllPages: false });
    expect(mocks.lexwareRequest).toHaveBeenCalledExactlyOnceWith(
      'GET', '/voucherlist', undefined,
      { voucherType: 'any', voucherStatus: 'any' },
    );
    expect(result.structuredContent.content).toEqual(entries);
    expect(result.structuredContent.fetchedPages).toBeUndefined();
  });

  it('auto-paginates when fetchAllPages is set, preserving API fields', async () => {
    mocks.lexwareRequest
      .mockResolvedValueOnce({ content: [{ id: 'a' }], totalPages: 2, totalElements: 2 })
      .mockResolvedValueOnce({ content: [{ id: 'b' }], totalPages: 2, totalElements: 2 });
    const sc = (await handler({ fetchAllPages: true })).structuredContent;
    expect(sc.content).toHaveLength(2);
    expect(sc.fetchedPages).toBe(2);
    expect(sc.truncated).toBe(false);
    expect(sc.totalElements).toBe(2); // spread from the API response, not invented
    expect(mocks.lexwareRequest).toHaveBeenNthCalledWith(1, 'GET', '/voucherlist', undefined, expect.objectContaining({ page: 0 }));
    expect(mocks.lexwareRequest).toHaveBeenNthCalledWith(2, 'GET', '/voucherlist', undefined, expect.objectContaining({ page: 1 }));
  });

  it('stops at the page cap and flags the result as truncated', async () => {
    mocks.lexwareRequest.mockResolvedValue({ content: [{ id: 'x' }], totalPages: 5_000 });
    const sc = (await handler({ fetchAllPages: true })).structuredContent;
    expect(sc.fetchedPages).toBe(100);
    expect(sc.truncated).toBe(true);
    expect(mocks.lexwareRequest).toHaveBeenCalledTimes(100);
  });

  it.each([
    ['Müller%', ['v1', 'v3']],
    ['%GmbH', ['v1', 'v4']],
    ['Müller _ Co', ['v3']],
    ['BÜROPLUS%', ['v2']],
  ])('contactName %s matches %j (client-side, case-insensitive)', async (pattern, expected) => {
    expect(ids(await handler({ contactName: pattern }))).toEqual(expected);
  });

  it('hasOpenAmount excludes entries with openAmount === 0', async () => {
    expect(ids(await handler({ hasOpenAmount: true }))).toEqual(['v1', 'v3', 'v4']);
  });

  it('combines client-side filters as AND', async () => {
    expect(ids(await handler({ contactName: 'Müller%', hasOpenAmount: true }))).toEqual(['v1', 'v3']);
  });

  it('a client-side filter alone implies fetching all pages', async () => {
    mocks.lexwareRequest
      .mockResolvedValueOnce({ content: [{ id: 'p1', contactName: 'Acme' }], totalPages: 2 })
      .mockResolvedValueOnce({ content: [{ id: 'p2', contactName: 'Acme' }], totalPages: 2 });
    const sc = (await handler({ contactName: 'Acme' })).structuredContent;
    expect(sc.fetchedPages).toBe(2);
    expect(sc.filteredCount).toBe(2);
  });

  it('never forwards the client-side params to the API', async () => {
    await handler({ contactName: 'Acme', hasOpenAmount: true, fetchAllPages: true });
    const query = mocks.lexwareRequest.mock.calls[0][3];
    expect(query).not.toHaveProperty('contactName');
    expect(query).not.toHaveProperty('hasOpenAmount');
    expect(query).not.toHaveProperty('fetchAllPages');
  });

  // Regression: `page` seeded the aggregate loop, so `page: 5` failed the
  // `page < totalPages` guard on entry and returned an empty, non-truncated result
  // WITHOUT making a single request — a filter answering "no matches" without ever
  // having asked. Rejected at the schema now, and the loop is pinned to 0 as well.
  describe('page is incompatible with the aggregate modes', () => {
    let schema: z.ZodTypeAny;

    beforeEach(() => {
      schema = captureTools(registerVoucherlistTools).get('lexware_list_voucherlist')!.schema;
    });

    it.each([
      ['fetchAllPages', { page: 5, fetchAllPages: true }],
      ['contactName', { page: 5, contactName: 'Acme%' }],
      ['hasOpenAmount', { page: 5, hasOpenAmount: true }],
    ])('rejects page combined with %s', (_label, input) => {
      expect(schema.safeParse(input).success).toBe(false);
    });

    it('still accepts page on the single-page passthrough path', () => {
      expect(schema.safeParse({ page: 5 }).success).toBe(true);
    });

    it('always starts the aggregate walk at page 0, never at a caller offset', async () => {
      mocks.lexwareRequest.mockResolvedValue({ content: [{ id: 'a' }], totalPages: 1 });
      const sc = (await handler({ page: 5, fetchAllPages: true })).structuredContent;
      // Even if the schema were relaxed, the walk must still request page 0 rather
      // than silently returning nothing.
      expect(mocks.lexwareRequest).toHaveBeenCalledWith(
        'GET', '/voucherlist', undefined, expect.objectContaining({ page: 0 }),
      );
      expect(sc.fetchedPages).toBe(1);
      expect(sc.content).toHaveLength(1);
    });
  });

  it('returns an empty list rather than erroring when nothing matches', async () => {
    const result = await handler({ contactName: 'Nonexistent%' });
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent.content).toEqual([]);
    expect(result.structuredContent.filteredCount).toBe(0);
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

  // Regression for the seam the earlier tests missed: withProcessingRetry was tested
  // with an empty response directly, and get_voucher was tested only with 404s, so
  // nothing exercised an empty response THROUGH this handler — where normalizing
  // inside the retry callback dereferenced the null and threw a TypeError.
  it('retries a null response instead of throwing, and returns the voucher once it lands', async () => {
    mocks.lexwareRequest
      .mockResolvedValueOnce(null)
      .mockResolvedValue({ id: VALID_UUID, voucherStatus: 'OPEN', version: 1 });

    const promise = handler({ id: VALID_UUID });
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.isError).toBeUndefined();
    expect(result.structuredContent.voucherStatus).toBe('open');
    expect(mocks.lexwareRequest).toHaveBeenCalledTimes(2);
  });

  it('passes an empty body through rather than inventing a shape, once retries are spent', async () => {
    mocks.lexwareRequest.mockResolvedValue(null);

    const promise = handler({ id: VALID_UUID });
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toBeUndefined(); // null carries no structuredContent
    expect(mocks.lexwareRequest).toHaveBeenCalledTimes(3);
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
