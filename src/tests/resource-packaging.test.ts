import { describe, it, expect, beforeAll } from 'vitest';
import { execSync } from 'node:child_process';
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

// The two npm invocations below go through a shell (execSync), which is what makes
// this file run on Windows. There `npm` is `npm.cmd`, and `execFileSync('npm', …)`
// cannot find it — CreateProcess does not apply PATHEXT, so it fails with
// "spawnSync npm ENOENT" before any test runs. Naming `npm.cmd` explicitly does not
// help either: since the CVE-2024-27980 fix (Node 18.20.2 / 20.12.2) spawning a .cmd
// or .bat WITHOUT a shell throws EINVAL outright.
//
// KEEP BOTH COMMANDS AS STRING LITERALS. They are constants today, so nothing
// interpolated ever reaches the shell. If a path or version ever needs to be passed
// in, do not template it into these strings — switch that call to execFileSync with
// an argv array (and, on win32, resolve npm's cli.js and run it via process.execPath)
// rather than quoting by hand.
//
// execSync over execFileSync + `shell: true`: the latter is DEP0190-deprecated for
// exactly this shape, since it concatenates the argv array into the shell string
// unescaped — same exposure, plus a warning on every run.

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
  execSync('npm run build', { cwd: repoRoot, stdio: 'pipe' });
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
    const out = execSync('npm pack --dry-run --json', {
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
