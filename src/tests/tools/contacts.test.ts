import { describe, it, expect, vi, beforeEach } from 'vitest';
import { z } from 'zod';
import { registerAndCapture, getTool, expectRequest } from './_helpers.js';

const { mockLexwareRequest } = vi.hoisted(() => ({
  mockLexwareRequest: vi.fn(),
}));

vi.mock('../../services/lexware.js', () => ({
  lexwareRequest: mockLexwareRequest,
  lexwareDownload: vi.fn(),
  lexwareUpload: vi.fn(),
}));

async function loadAndRegister() {
  const { registerContactTools } = await import('../../tools/contacts.js');
  return registerAndCapture(registerContactTools as (s: unknown) => void);
}

describe('contacts tool registry', () => {
  beforeEach(() => {
    mockLexwareRequest.mockReset();
  });

  it('registers exactly the expected 5 contact tools', async () => {
    const tools = await loadAndRegister();
    expect([...tools.keys()].sort()).toEqual([
      'lexware_create_contact',
      'lexware_deeplink_contact',
      'lexware_get_contact',
      'lexware_list_contacts',
      'lexware_update_contact',
    ]);
  });

  describe('lexware_list_contacts', () => {
    it('GETs /contacts with pagination + filter query params', async () => {
      mockLexwareRequest.mockResolvedValue({ content: [] });
      const tools = await loadAndRegister();
      const list = getTool(tools, 'lexware_list_contacts');
      await list.handler({ page: 0, size: 25, customer: true, name: 'ACME' });
      expectRequest(mockLexwareRequest, {
        method: 'GET',
        url: '/contacts',
        body: undefined,
        params: { page: 0, size: 25, customer: true, name: 'ACME' },
      });
    });

    it('no longer exposes the undocumented `archived` filter (removed in #65)', async () => {
      const tools = await loadAndRegister();
      const list = getTool(tools, 'lexware_list_contacts');
      const schema = z.object(list.schemaShape as z.ZodRawShape);
      const jsonSchema = z.toJSONSchema(schema, { io: 'input' }) as {
        properties?: Record<string, unknown>;
      };
      expect(jsonSchema.properties).not.toHaveProperty('archived');
      expect(Object.keys(jsonSchema.properties ?? {})).toEqual(
        expect.arrayContaining(['email', 'name', 'number', 'customer', 'vendor']),
      );
      // Non-strict Zod strips the now-unknown key before it reaches the handler.
      expect(schema.parse({ archived: true, name: 'ACME' })).not.toHaveProperty('archived');
    });

    it('forwards undefined filters as undefined (services strips them)', async () => {
      mockLexwareRequest.mockResolvedValue({ content: [] });
      const tools = await loadAndRegister();
      const list = getTool(tools, 'lexware_list_contacts');
      await list.handler({});
      // The tool itself spreads the whole params object — the services layer
      // is responsible for stripping undefined keys (covered separately in
      // `lexware-client.test.ts`). Here we just assert the raw shape.
      expect(mockLexwareRequest).toHaveBeenCalledExactlyOnceWith(
        'GET',
        '/contacts',
        undefined,
        {},
      );
    });
  });

  describe('lexware_get_contact', () => {
    it('GETs /contacts/{id}', async () => {
      mockLexwareRequest.mockResolvedValue({ id: 'abc' });
      const tools = await loadAndRegister();
      const get = getTool(tools, 'lexware_get_contact');
      await get.handler({ id: '745f3319-f473-4d55-9943-fecd942fd76d' });
      expect(mockLexwareRequest).toHaveBeenCalledExactlyOnceWith(
        'GET',
        '/contacts/745f3319-f473-4d55-9943-fecd942fd76d',
      );
    });
  });

  describe('lexware_create_contact', () => {
    it('POSTs /contacts with the body payload', async () => {
      mockLexwareRequest.mockResolvedValue({ id: 'c-1', version: 0 });
      const tools = await loadAndRegister();
      const create = getTool(tools, 'lexware_create_contact');
      const body = {
        version: 0,
        roles: { customer: {} },
        company: { name: 'ACME' },
      };
      await create.handler({ body });
      expect(mockLexwareRequest).toHaveBeenCalledExactlyOnceWith(
        'POST',
        '/contacts',
        body,
      );
    });
  });

  describe('lexware_update_contact', () => {
    it('PUTs /contacts/{id} with optimistic-lock version in body', async () => {
      mockLexwareRequest.mockResolvedValue({ id: 'c-2', version: 2 });
      const tools = await loadAndRegister();
      const update = getTool(tools, 'lexware_update_contact');
      const body = { version: 1, roles: { customer: {} }, company: { name: 'ACME-v2' } };
      await update.handler({ id: 'c-2', body });
      expect(mockLexwareRequest).toHaveBeenCalledExactlyOnceWith(
        'PUT',
        '/contacts/c-2',
        body,
      );
    });

    it('surfaces a 409 optimistic-lock conflict as a tool error', async () => {
      // `services/lexware.ts` translates HTTP 409 → `Error('Lexware API [409]: ...')`
      // (covered in `lexware-client.test.ts`). The tool handler must NOT rethrow —
      // it must wrap the error via `toolError` so MCP clients see a structured
      // failure rather than a transport-level crash.
      mockLexwareRequest.mockRejectedValue(
        new Error('Lexware API [409]: Optimistic locking failure: version mismatch'),
      );
      const tools = await loadAndRegister();
      const update = getTool(tools, 'lexware_update_contact');
      const result = (await update.handler({
        id: 'c-2',
        body: { version: 1 },
      })) as { isError?: boolean; content: Array<{ text: string }> };
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toMatch(/Lexware API \[409\].*Optimistic locking failure/);
    });
  });

  describe('lexware_deeplink_contact', () => {
    it('returns a /permalink/contacts/view URL without hitting the API', async () => {
      const tools = await loadAndRegister();
      const deeplink = getTool(tools, 'lexware_deeplink_contact');
      const result = (await deeplink.handler({ id: 'c-3' })) as {
        structuredContent: { deeplink: string; url: string };
      };
      // Per Lexware docs: contacts use `view/`, not `edit/`.
      expect(result.structuredContent.deeplink).toBe(
        'https://app.lexware.de/permalink/contacts/view/c-3',
      );
      // `url` is retained as a deprecated backward-compat alias for `deeplink`.
      expect(result.structuredContent.url).toBe(
        'https://app.lexware.de/permalink/contacts/view/c-3',
      );
      expect(mockLexwareRequest).not.toHaveBeenCalled();
    });
  });
});
