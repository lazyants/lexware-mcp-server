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
  const { registerCountryTools } = await import('../../tools/countries.js');
  return registerAndCapture(registerCountryTools as (s: unknown) => void);
}

describe('countries tool registry', () => {
  beforeEach(() => {
    mockLexwareRequest.mockReset();
  });

  it('registers exactly the single list_countries tool', async () => {
    const tools = await loadAndRegister();
    expect([...tools.keys()].sort()).toEqual(['lexware_list_countries']);
  });

  describe('lexware_list_countries', () => {
    it('GETs /countries with no body and no query params', async () => {
      // Global enumeration endpoint — returns countries with their tax
      // classifications. No pagination per Lexware docs.
      mockLexwareRequest.mockResolvedValue([
        { countryCode: 'DE', taxClassification: 'de' },
        { countryCode: 'AT', taxClassification: 'intraCommunity' },
      ]);
      const tools = await loadAndRegister();
      const list = getTool(tools, 'lexware_list_countries');
      await list.handler({});
      expect(mockLexwareRequest).toHaveBeenCalledExactlyOnceWith('GET', '/countries');
    });
  });
});
