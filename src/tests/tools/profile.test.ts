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
  const { registerProfileTools } = await import('../../tools/profile.js');
  return registerAndCapture(registerProfileTools as (s: unknown) => void);
}

describe('profile tool registry', () => {
  beforeEach(() => {
    mockLexwareRequest.mockReset();
  });

  it('registers exactly the single get_profile tool', async () => {
    const tools = await loadAndRegister();
    expect([...tools.keys()].sort()).toEqual(['lexware_get_profile']);
  });

  describe('lexware_get_profile', () => {
    it('GETs /profile with no body and no query params', async () => {
      // Singleton resource — no id, returns the organization profile of the
      // authenticated account.
      mockLexwareRequest.mockResolvedValue({
        organizationId: 'org-1',
        companyName: 'ACME GmbH',
      });
      const tools = await loadAndRegister();
      const get = getTool(tools, 'lexware_get_profile');
      await get.handler({});
      expect(mockLexwareRequest).toHaveBeenCalledExactlyOnceWith('GET', '/profile');
    });
  });
});
