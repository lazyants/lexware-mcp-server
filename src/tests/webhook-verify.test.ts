import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { generateKeyPairSync, createSign } from 'node:crypto';
import { createServer } from '../server.js';
import { registerEventSubscriptionTools } from '../tools/event-subscriptions.js';
import { __resetWebhookKeyCache } from '../services/lexware.js';

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
