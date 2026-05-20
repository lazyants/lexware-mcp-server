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
  const { registerPrintLayoutTools } = await import('../../tools/print-layouts.js');
  return registerAndCapture(registerPrintLayoutTools as (s: unknown) => void);
}

describe('print-layouts tool registry', () => {
  beforeEach(() => {
    mockLexwareRequest.mockReset();
  });

  it('registers exactly the single list_print_layouts tool', async () => {
    const tools = await loadAndRegister();
    expect([...tools.keys()].sort()).toEqual(['lexware_list_print_layouts']);
  });

  describe('lexware_list_print_layouts', () => {
    it('GETs /print-layouts with no body and no query params', async () => {
      // Global enumeration endpoint, no pagination/filters per Lexware docs.
      mockLexwareRequest.mockResolvedValue([
        { id: 'pl-1', name: 'Default Layout', isDefault: true, type: 'invoice' },
      ]);
      const tools = await loadAndRegister();
      const list = getTool(tools, 'lexware_list_print_layouts');
      await list.handler({});
      expect(mockLexwareRequest).toHaveBeenCalledExactlyOnceWith('GET', '/print-layouts');
    });
  });
});
