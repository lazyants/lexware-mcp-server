import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

function runCheck(args: string[], response: string, packagesVersion = '1.2.3') {
  const fixture = mkdtempSync(join(tmpdir(), 'check-versions-'));
  try {
    mkdirSync(join(fixture, 'scripts'));
    copyFileSync(join(repoRoot, 'scripts/check-versions.mjs'), join(fixture, 'scripts/check-versions.mjs'));
    writeFileSync(join(fixture, 'package.json'), JSON.stringify({
      name: '@lazyants/example-mcp-server',
      version: '1.2.3',
    }));
    writeFileSync(join(fixture, 'server.json'), JSON.stringify({
      version: '1.2.3',
      packages: [{ version: packagesVersion }],
    }));
    writeFileSync(join(fixture, 'package-lock.json'), JSON.stringify({
      version: '1.2.3',
      packages: { '': { version: '1.2.3' } },
    }));
    const mock = join(fixture, 'mock-fetch.mjs');
    writeFileSync(mock, `
      globalThis.fetch = async (url) => {
        console.log('NPM_LOOKUP ' + url);
        if (process.env.TEST_NPM_RESPONSE === 'network-error') throw new Error('network unavailable');
        return new Response(null, { status: Number(process.env.TEST_NPM_RESPONSE) });
      };
    `);
    return spawnSync(process.execPath, [
      '--import', pathToFileURL(mock).href,
      join(fixture, 'scripts/check-versions.mjs'), ...args,
    ], {
      cwd: tmpdir(),
      env: { ...process.env, TEST_NPM_RESPONSE: response },
      encoding: 'utf8',
      timeout: 5_000,
    });
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
}

describe('version check publishing gate', () => {
  it('keeps ordinary version sync offline even for released versions', () => {
    const result = runCheck([], 'network-error');
    expect(result.status).toBe(0);
    expect(result.stdout).not.toContain('NPM_LOOKUP');
  });

  it('allows publishing only when npm returns version-not-found', () => {
    const result = runCheck(['--require-unpublished'], '404');
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('https://registry.npmjs.org/%40lazyants%2Fexample-mcp-server/1.2.3');
    expect(result.stdout).toContain('is not published on npm');
  });

  it('rejects a version already published on npm', () => {
    const result = runCheck(['--require-unpublished'], '200');
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('already published; bump the version');
  });

  it.each(['401', '429', '500'])('fails closed on npm HTTP %s', (status) => {
    const result = runCheck(['--require-unpublished'], status);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(`npm returned HTTP ${status}`);
  });

  it('fails closed when the npm request fails', () => {
    const result = runCheck(['--require-unpublished'], 'network-error');
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('network unavailable');
  });

  it('rejects metadata drift before contacting npm', () => {
    const result = runCheck(['--require-unpublished'], '404', '1.2.2');
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('These must match');
    expect(result.stdout).not.toContain('NPM_LOOKUP');
  });
});

