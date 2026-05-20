import { describe, it, expect, vi, beforeEach } from 'vitest';
import { generateKeyPairSync, createSign } from 'node:crypto';
import { registerAndCapture, getTool } from './_helpers.js';

const { mockLexwareRequest, mockGetWebhookPublicKey } = vi.hoisted(() => ({
  mockLexwareRequest: vi.fn(),
  mockGetWebhookPublicKey: vi.fn(),
}));

vi.mock('../../services/lexware.js', () => ({
  lexwareRequest: mockLexwareRequest,
  lexwareDownload: vi.fn(),
  getWebhookPublicKey: mockGetWebhookPublicKey,
}));

async function loadAndRegister() {
  const { registerEventSubscriptionTools } = await import('../../tools/event-subscriptions.js');
  return registerAndCapture(registerEventSubscriptionTools as (s: unknown) => void);
}

describe('event-subscriptions tool registry', () => {
  beforeEach(() => {
    mockLexwareRequest.mockReset();
    mockGetWebhookPublicKey.mockReset();
  });

  it('registers exactly the expected 5 event-subscription tools (incl. webhook verifier)', async () => {
    const tools = await loadAndRegister();
    expect([...tools.keys()].sort()).toEqual([
      'lexware_create_event_subscription',
      'lexware_delete_event_subscription',
      'lexware_get_event_subscription',
      'lexware_list_event_subscriptions',
      'lexware_verify_webhook_signature',
    ]);
  });

  describe('lexware_create_event_subscription', () => {
    it('POSTs /event-subscriptions with only the documented fields (no body pass-through)', async () => {
      mockLexwareRequest.mockResolvedValue({ id: 'es-1' });
      const tools = await loadAndRegister();
      const create = getTool(tools, 'lexware_create_event_subscription');
      // The tool reconstructs the body from explicit fields rather than
      // forwarding params.body — protects against callers accidentally
      // POSTing extra/unknown fields to Lexware.
      await create.handler({
        eventType: 'contact.changed',
        callbackUrl: 'https://example.com/hook',
      });
      expect(mockLexwareRequest).toHaveBeenCalledExactlyOnceWith(
        'POST',
        '/event-subscriptions',
        { eventType: 'contact.changed', callbackUrl: 'https://example.com/hook' },
      );
    });
  });

  describe('lexware_list_event_subscriptions', () => {
    it('GETs /event-subscriptions with no body and no query params', async () => {
      mockLexwareRequest.mockResolvedValue([]);
      const tools = await loadAndRegister();
      const list = getTool(tools, 'lexware_list_event_subscriptions');
      await list.handler({});
      expect(mockLexwareRequest).toHaveBeenCalledExactlyOnceWith('GET', '/event-subscriptions');
    });
  });

  describe('lexware_get_event_subscription', () => {
    it('GETs /event-subscriptions/{id}', async () => {
      mockLexwareRequest.mockResolvedValue({ id: 'es-1' });
      const tools = await loadAndRegister();
      const get = getTool(tools, 'lexware_get_event_subscription');
      await get.handler({ id: '745f3319-f473-4d55-9943-fecd942fd76d' });
      expect(mockLexwareRequest).toHaveBeenCalledExactlyOnceWith(
        'GET',
        '/event-subscriptions/745f3319-f473-4d55-9943-fecd942fd76d',
      );
    });
  });

  describe('lexware_delete_event_subscription', () => {
    it('DELETEs /event-subscriptions/{id}', async () => {
      mockLexwareRequest.mockResolvedValue('');
      const tools = await loadAndRegister();
      const del = getTool(tools, 'lexware_delete_event_subscription');
      await del.handler({ id: 'es-9' });
      expect(mockLexwareRequest).toHaveBeenCalledExactlyOnceWith(
        'DELETE',
        '/event-subscriptions/es-9',
      );
    });
  });

  describe('lexware_verify_webhook_signature', () => {
    // Use a generated RSA keypair so we can sign a real payload and assert that
    // the verifier returns `verified: true` — and also `false` for a tampered
    // payload. This is the only end-to-end crypto test in the suite; it locks
    // in the algorithm (RSA-SHA512) and base64 signature encoding.
    const { privateKey, publicKey } = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });

    function signPayload(payload: string): string {
      const s = createSign('RSA-SHA512');
      s.update(payload);
      s.end();
      return s.sign(privateKey, 'base64');
    }

    it('returns verified=true and algorithm=RSA-SHA512 for a matching signature', async () => {
      mockGetWebhookPublicKey.mockResolvedValue(publicKey);
      const tools = await loadAndRegister();
      const verify = getTool(tools, 'lexware_verify_webhook_signature');
      const payload = '{"eventType":"contact.changed","eventDate":"2026-01-01T00:00:00Z"}';
      const signature = signPayload(payload);
      const result = (await verify.handler({ payload, signature })) as {
        structuredContent: { verified: boolean; algorithm: string };
      };
      expect(result.structuredContent.verified).toBe(true);
      expect(result.structuredContent.algorithm).toBe('RSA-SHA512');
      expect(mockGetWebhookPublicKey).toHaveBeenCalledOnce();
      // Verifier MUST NOT issue any HTTP requests — the public key is fetched
      // via getWebhookPublicKey() (cached) and signature verification is pure crypto.
      expect(mockLexwareRequest).not.toHaveBeenCalled();
    });

    it('returns verified=false when the payload is tampered with', async () => {
      mockGetWebhookPublicKey.mockResolvedValue(publicKey);
      const tools = await loadAndRegister();
      const verify = getTool(tools, 'lexware_verify_webhook_signature');
      const originalPayload = '{"eventType":"contact.changed"}';
      const tamperedPayload = '{"eventType":"contact.deleted"}';
      const signature = signPayload(originalPayload);
      const result = (await verify.handler({
        payload: tamperedPayload,
        signature,
      })) as { structuredContent: { verified: boolean } };
      expect(result.structuredContent.verified).toBe(false);
    });
  });
});
