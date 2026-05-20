import { describe, it, expect, vi, beforeEach } from 'vitest';
import { registerAndCapture, getTool } from './_helpers.js';

const { mockLexwareRequest } = vi.hoisted(() => ({
  mockLexwareRequest: vi.fn(),
}));

vi.mock('../../services/lexware.js', () => ({
  lexwareRequest: mockLexwareRequest,
  lexwareDownload: vi.fn(),
}));

async function loadAndRegister() {
  const { registerPostingCategoryTools } = await import('../../tools/posting-categories.js');
  return registerAndCapture(registerPostingCategoryTools as (s: unknown) => void);
}

describe('posting-categories tool registry', () => {
  beforeEach(() => {
    mockLexwareRequest.mockReset();
  });

  it('registers exactly the single list_posting_categories tool', async () => {
    const tools = await loadAndRegister();
    expect([...tools.keys()].sort()).toEqual(['lexware_list_posting_categories']);
  });

  describe('lexware_list_posting_categories', () => {
    it('GETs /posting-categories with no body and no query params', async () => {
      mockLexwareRequest.mockResolvedValue([
        { id: 'pc-1', name: 'Erlöse', type: 'income' },
      ]);
      const tools = await loadAndRegister();
      const list = getTool(tools, 'lexware_list_posting_categories');
      await list.handler({});
      expect(mockLexwareRequest).toHaveBeenCalledExactlyOnceWith('GET', '/posting-categories');
    });
  });
});
