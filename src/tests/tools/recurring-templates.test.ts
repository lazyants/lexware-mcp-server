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
  const { registerRecurringTemplateTools } = await import('../../tools/recurring-templates.js');
  return registerAndCapture(registerRecurringTemplateTools as (s: unknown) => void);
}

describe('recurring-templates tool registry', () => {
  beforeEach(() => {
    mockLexwareRequest.mockReset();
  });

  it('registers exactly the expected 2 recurring-template tools (read-only resource)', async () => {
    const tools = await loadAndRegister();
    expect([...tools.keys()].sort()).toEqual([
      'lexware_get_recurring_template',
      'lexware_list_recurring_templates',
    ]);
  });

  describe('lexware_list_recurring_templates', () => {
    it('GETs /recurring-templates with page+size query params', async () => {
      mockLexwareRequest.mockResolvedValue({ content: [] });
      const tools = await loadAndRegister();
      const list = getTool(tools, 'lexware_list_recurring_templates');
      await list.handler({ page: 0, size: 25 });
      expect(mockLexwareRequest).toHaveBeenCalledExactlyOnceWith(
        'GET',
        '/recurring-templates',
        undefined,
        { page: 0, size: 25 },
      );
    });

    it('forwards undefined when pagination is omitted (params object is preserved)', async () => {
      mockLexwareRequest.mockResolvedValue({ content: [] });
      const tools = await loadAndRegister();
      const list = getTool(tools, 'lexware_list_recurring_templates');
      await list.handler({});
      // Tool spreads page+size explicitly even when omitted — keys are present
      // with undefined values. The services layer strips them before serializing.
      expect(mockLexwareRequest).toHaveBeenCalledExactlyOnceWith(
        'GET',
        '/recurring-templates',
        undefined,
        { page: undefined, size: undefined },
      );
    });
  });

  describe('lexware_get_recurring_template', () => {
    it('GETs /recurring-templates/{id}', async () => {
      mockLexwareRequest.mockResolvedValue({ id: 'rt-1' });
      const tools = await loadAndRegister();
      const get = getTool(tools, 'lexware_get_recurring_template');
      await get.handler({ id: '745f3319-f473-4d55-9943-fecd942fd76d' });
      expect(mockLexwareRequest).toHaveBeenCalledExactlyOnceWith(
        'GET',
        '/recurring-templates/745f3319-f473-4d55-9943-fecd942fd76d',
      );
    });
  });
});
