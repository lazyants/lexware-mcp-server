import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { generateKeyPairSync, createSign } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { createServer } from '../server.js';
import { registerEventSubscriptionTools } from '../tools/event-subscriptions.js';
import { __resetWebhookKeyCache, getWebhookPublicKey } from '../services/lexware.js';

// GOTCHA: vi.mock is hoisted above top-level const declarations.
// Use vi.hoisted() to share the mock fn between test bodies and the factory.
const { mockHttpsGet } = vi.hoisted(() => ({ mockHttpsGet: vi.fn() }));

vi.mock('node:https', () => ({ get: mockHttpsGet }));

const { publicKey, privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

function sign(payload: string): string {
  const signer = createSign('RSA-SHA512');
  signer.update(payload);
  signer.end();
  return signer.sign(privateKey, 'base64');
}

type ToolHandler = (params: { payload: string; signature: string }) => Promise<{
  content: Array<{ type: string; text: string }>;
  structuredContent?: { verified: boolean; algorithm: string };
}>;

function captureVerifyTool(): ToolHandler {
  const server = createServer('test');
  let captured: ToolHandler | undefined;
  const orig = server.registerTool;
  server.registerTool = ((...args: any[]) => {
    if (args[0] === 'lexware_verify_webhook_signature') {
      captured = args[2] as ToolHandler;
    }
    return (orig as (...a: unknown[]) => unknown).apply(server, args);
  }) as typeof server.registerTool;
  registerEventSubscriptionTools(server);
  if (!captured) throw new Error('verify tool not registered');
  return captured;
}

describe('lexware_verify_webhook_signature', () => {
  const originalEnv = process.env.LEXWARE_WEBHOOK_PUBLIC_KEY;

  beforeEach(() => {
    process.env.LEXWARE_WEBHOOK_PUBLIC_KEY = publicKey;
    __resetWebhookKeyCache();
  });

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.LEXWARE_WEBHOOK_PUBLIC_KEY = originalEnv;
    } else {
      delete process.env.LEXWARE_WEBHOOK_PUBLIC_KEY;
    }
    __resetWebhookKeyCache();
  });

  it('verifies a matching payload + signature', async () => {
    const handler = captureVerifyTool();
    const payload = '{"eventType":"invoice.created","resourceId":"abc-123"}';
    const signature = sign(payload);
    const result = await handler({ payload, signature });
    expect(result.structuredContent).toEqual({ verified: true, algorithm: 'RSA-SHA512' });
  });

  it('rejects a tampered payload', async () => {
    const handler = captureVerifyTool();
    const payload = '{"eventType":"invoice.created","resourceId":"abc-123"}';
    const signature = sign(payload);
    const tampered = payload.replace('abc-123', 'xyz-999');
    const result = await handler({ payload: tampered, signature });
    expect(result.structuredContent?.verified).toBe(false);
  });

  it('rejects a tampered signature', async () => {
    const handler = captureVerifyTool();
    const payload = '{"eventType":"invoice.created","resourceId":"abc-123"}';
    const signature = sign(payload);
    const sigBytes = Buffer.from(signature, 'base64');
    sigBytes[0] ^= 0xff;
    const tampered = sigBytes.toString('base64');
    const result = await handler({ payload, signature: tampered });
    expect(result.structuredContent?.verified).toBe(false);
  });

  it('reports algorithm constant in output', async () => {
    const handler = captureVerifyTool();
    const payload = '{}';
    const signature = sign(payload);
    const result = await handler({ payload, signature });
    expect(result.structuredContent?.algorithm).toBe('RSA-SHA512');
  });
});

// The suite above always sets LEXWARE_WEBHOOK_PUBLIC_KEY, which short-circuits
// getWebhookPublicKey() before it ever touches node:https — so none of it
// exercises fetchAndValidatePublicKey. These tests mock node:https directly and
// drive the REAL fetch/cache path, with no env override in play.

type FakeReq = EventEmitter & { setTimeout: (ms: number, cb: () => void) => void; destroy: (err?: Error) => void };
type FakeRes = EventEmitter & { statusCode: number; resume: () => void };

function fakeReq(): FakeReq {
  const req = new EventEmitter() as FakeReq;
  req.setTimeout = vi.fn();
  req.destroy = vi.fn();
  return req;
}

function fakeRes(statusCode: number): FakeRes {
  const res = new EventEmitter() as FakeRes;
  res.statusCode = statusCode;
  res.resume = vi.fn();
  return res;
}

// Queues one httpsGet(url, cb) response. By the time cb(res) returns, the SUT
// has synchronously registered its res 'data'/'end' listeners (for the 200
// path), so emitting right after cb(res) is safe and needs no microtask hop.
function queueHttpsResponse(statusCode: number, body?: string): void {
  mockHttpsGet.mockImplementationOnce((_url: string, cb: (res: FakeRes) => void) => {
    const req = fakeReq();
    const res = fakeRes(statusCode);
    cb(res);
    if (statusCode === 200) {
      res.emit('data', Buffer.from(body ?? ''));
      res.emit('end');
    }
    return req;
  });
}

describe('getWebhookPublicKey (real fetch path, no env override)', () => {
  beforeEach(() => {
    delete process.env.LEXWARE_WEBHOOK_PUBLIC_KEY;
    mockHttpsGet.mockReset();
    __resetWebhookKeyCache();
  });

  afterEach(() => {
    __resetWebhookKeyCache();
  });

  it('rejects on a non-200 response', async () => {
    queueHttpsResponse(404);
    await expect(getWebhookPublicKey()).rejects.toThrow(/HTTP 404/);
    expect(mockHttpsGet).toHaveBeenCalledOnce();
  });

  it('rejects on an invalid PEM body', async () => {
    queueHttpsResponse(200, 'this is not a PEM-encoded key');
    await expect(getWebhookPublicKey()).rejects.toThrow(/invalid PEM/);
  });

  it('clears the cache on rejection so the next call retries', async () => {
    queueHttpsResponse(404);
    await expect(getWebhookPublicKey()).rejects.toThrow(/HTTP 404/);
    expect(mockHttpsGet).toHaveBeenCalledTimes(1);

    queueHttpsResponse(200, publicKey);
    await expect(getWebhookPublicKey()).resolves.toBe(publicKey);
    expect(mockHttpsGet).toHaveBeenCalledTimes(2);
  });

  it('shares one in-flight fetch across concurrent callers', async () => {
    queueHttpsResponse(200, publicKey);

    const [first, second] = await Promise.all([getWebhookPublicKey(), getWebhookPublicKey()]);

    expect(first).toBe(publicKey);
    expect(second).toBe(publicKey);
    expect(mockHttpsGet).toHaveBeenCalledOnce();
  });
});
