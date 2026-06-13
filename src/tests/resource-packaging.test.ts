import { describe, it, expect, beforeAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const REFERENCE_URI = 'reference://lexware/api';

const here = dirname(fileURLToPath(import.meta.url)); // src/tests
const repoRoot = resolve(here, '..', '..');
const distDir = join(repoRoot, 'dist');

const require = createRequire(import.meta.url);
const pkg = require(join(repoRoot, 'package.json')) as {
  bin: Record<string, string>;
};
const binEntries = Object.entries(pkg.bin);
const binTargets = Object.values(pkg.bin);

// Packaging-level guarantees must be proven against a CLEAN compiled tree, not src:
// a source import would never catch an npm consumer failing to resolve the file, and a
// non-clean dist could ship stale/orphaned compiled files that npm pack would pass.
beforeAll(() => {
  rmSync(distDir, { recursive: true, force: true });
  execFileSync('npm', ['run', 'build'], { cwd: repoRoot, stdio: 'pipe' });
}, 180_000);

describe('compiled dist resource', () => {
  it('exposes REFERENCE_MD with a known token from dist/resources/lexware-reference.js', async () => {
    const compiled = join(distDir, 'resources', 'lexware-reference.js');
    expect(existsSync(compiled)).toBe(true);
    const mod = await import(pathToFileURL(compiled).href);
    expect(typeof mod.REFERENCE_MD).toBe('string');
    expect(mod.REFERENCE_MD).toContain('lexware_create_invoice');
    expect(mod.REFERENCE_URI).toBe(REFERENCE_URI);
  });
});

describe('npm pack packaging', () => {
  it('ships the compiled resource and keeps dist/entry-*.js <-> bin parity', () => {
    const out = execFileSync('npm', ['pack', '--dry-run', '--json'], {
      cwd: repoRoot,
      encoding: 'utf8',
    });
    // Tolerate any leading npm notices before the JSON array.
    const parsed = JSON.parse(out.slice(out.indexOf('['))) as Array<{
      files: Array<{ path: string }>;
    }>;
    const files = parsed[0].files.map((f) => f.path);

    // (i) the compiled resource ships
    expect(files).toContain('dist/resources/lexware-reference.js');

    // (ii) every bin target is built AND shipped
    for (const target of binTargets) {
      expect(existsSync(join(repoRoot, target))).toBe(true);
      expect(files).toContain(target);
    }

    // (iii) no orphan: every shipped dist/entry-*.js has a matching bin target
    const shippedEntries = files.filter((f) => /^dist\/entry-.*\.js$/.test(f));
    expect(shippedEntries.length).toBeGreaterThan(0);
    for (const entry of shippedEntries) {
      expect(binTargets).toContain(entry);
    }
  }, 30_000);
});

describe('every published binary advertises the reference resource', () => {
  it.each(binEntries)(
    '%s exposes %s over stdio',
    async (_binName, relPath) => {
      const absBin = join(repoRoot, relPath);
      expect(existsSync(absBin)).toBe(true);

      // dist/*.js are mode 0644 (no exec bit / usable shebang) — spawn via node.
      const transport = new StdioClientTransport({
        command: process.execPath,
        args: [absBin],
        stderr: 'ignore',
      });
      const client = new Client({ name: 'pack-test', version: '0.0.0' });
      let connected = false;
      try {
        await client.connect(transport); // performs initialize + initialized
        connected = true;
        const { resources } = await client.listResources();
        expect(resources.map((r) => r.uri)).toContain(REFERENCE_URI);
      } finally {
        // The client owns the transport after connect(); tear down via the client.
        // Only fall back to transport.close() if connect() never took ownership.
        if (connected) await client.close();
        else await transport.close();
      }
    },
    15_000,
  );
});
