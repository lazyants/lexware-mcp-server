import { describe, it, expect, vi, beforeEach } from 'vitest';
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
  const { registerArticleTools } = await import('../../tools/articles.js');
  return registerAndCapture(registerArticleTools as (s: unknown) => void);
}

describe('articles tool registry', () => {
  beforeEach(() => {
    mockLexwareRequest.mockReset();
  });

  it('registers exactly the expected 5 article tools', async () => {
    const tools = await loadAndRegister();
    expect([...tools.keys()].sort()).toEqual([
      'lexware_create_article',
      'lexware_delete_article',
      'lexware_get_article',
      'lexware_list_articles',
      'lexware_update_article',
    ]);
  });

  describe('lexware_list_articles', () => {
    it('GETs /articles with pagination + filter params', async () => {
      mockLexwareRequest.mockResolvedValue({ content: [] });
      const tools = await loadAndRegister();
      const list = getTool(tools, 'lexware_list_articles');
      await list.handler({
        page: 1,
        size: 50,
        articleNumber: 'ART-001',
        gtin: '4006381333931',
        type: 'PRODUCT',
      });
      expectRequest(mockLexwareRequest, {
        method: 'GET',
        url: '/articles',
        body: undefined,
        params: {
          page: 1,
          size: 50,
          articleNumber: 'ART-001',
          gtin: '4006381333931',
          type: 'PRODUCT',
        },
      });
    });
  });

  describe('lexware_get_article', () => {
    it('GETs /articles/{id}', async () => {
      mockLexwareRequest.mockResolvedValue({ id: 'a-1' });
      const tools = await loadAndRegister();
      const get = getTool(tools, 'lexware_get_article');
      await get.handler({ id: 'a-1' });
      expect(mockLexwareRequest).toHaveBeenCalledExactlyOnceWith(
        'GET',
        '/articles/a-1',
      );
    });
  });

  describe('lexware_create_article', () => {
    it('POSTs /articles with body payload', async () => {
      mockLexwareRequest.mockResolvedValue({ id: 'a-new', version: 0 });
      const tools = await loadAndRegister();
      const create = getTool(tools, 'lexware_create_article');
      const body = {
        title: 'Widget',
        type: 'PRODUCT',
        unitName: 'piece',
        unitPrice: { currency: 'EUR', netAmount: 10, grossAmount: 11.9, taxRatePercentage: 19 },
      };
      await create.handler({ body });
      expect(mockLexwareRequest).toHaveBeenCalledExactlyOnceWith(
        'POST',
        '/articles',
        body,
      );
    });
  });

  describe('lexware_update_article', () => {
    it('PUTs /articles/{id} with version-bearing body for optimistic locking', async () => {
      mockLexwareRequest.mockResolvedValue({ id: 'a-2', version: 3 });
      const tools = await loadAndRegister();
      const update = getTool(tools, 'lexware_update_article');
      const body = {
        version: 2,
        title: 'Widget v2',
        type: 'PRODUCT',
        unitPrice: { currency: 'EUR', netAmount: 12, grossAmount: 14.28, taxRatePercentage: 19 },
      };
      await update.handler({ id: 'a-2', body });
      expect(mockLexwareRequest).toHaveBeenCalledExactlyOnceWith(
        'PUT',
        '/articles/a-2',
        body,
      );
    });
  });

  describe('lexware_delete_article', () => {
    it('DELETEs /articles/{id}', async () => {
      // DELETE responses are typically 204 with empty body.
      mockLexwareRequest.mockResolvedValue('');
      const tools = await loadAndRegister();
      const del = getTool(tools, 'lexware_delete_article');
      await del.handler({ id: 'a-3' });
      expect(mockLexwareRequest).toHaveBeenCalledExactlyOnceWith(
        'DELETE',
        '/articles/a-3',
      );
    });

    it('returns a non-structuredContent result for the empty 204 body', async () => {
      // formatResponse only sets structuredContent for objects — an empty
      // string from DELETE must NOT be promoted to structuredContent
      // (that would break MCP clients that try to parse it).
      mockLexwareRequest.mockResolvedValue('');
      const tools = await loadAndRegister();
      const del = getTool(tools, 'lexware_delete_article');
      const result = (await del.handler({ id: 'a-3' })) as {
        structuredContent?: unknown;
      };
      expect(result.structuredContent).toBeUndefined();
    });
  });
});
