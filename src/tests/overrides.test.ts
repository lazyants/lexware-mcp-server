import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Regression guard for the npm-audit gate (GHSA-q8mj-m7cp-5q26 `qs` DoS and the
// `hono` GHSAs). Asserts BOTH layers so it cannot be fooled by a stale lockfile:
//   (a) the `overrides` declarations are present and pinned, and
//   (b) every resolved entry in the committed lockfile satisfies the floor.
// Checking only resolved versions would still pass after someone deletes the
// `overrides` block (until the lock is regenerated); checking only the
// declaration would miss a lockfile that drifted below the floor.

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));

function readJson(relPath: string): Record<string, unknown> {
  return JSON.parse(readFileSync(REPO_ROOT + relPath, 'utf8'));
}

/** Compare two plain `x.y.z` semver strings; returns true when `a >= b`. */
function gte(a: string, b: string): boolean {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const da = pa[i] ?? 0;
    const db = pb[i] ?? 0;
    if (da !== db) return da > db;
  }
  return true;
}

const pkg = readJson('package.json');
const overrides = (pkg.overrides ?? {}) as Record<string, string>;

const lock = readJson('package-lock.json');
const lockPackages = (lock.packages ?? {}) as Record<string, { version?: string }>;

/** All resolved versions for a dependency name across every nesting level. */
function resolvedVersions(name: string): { path: string; version: string }[] {
  const re = new RegExp(`(^|/)node_modules/${name}$`);
  return Object.entries(lockPackages)
    .filter(([path, meta]) => re.test(path) && typeof meta.version === 'string')
    .map(([path, meta]) => ({ path, version: meta.version as string }));
}

describe('security overrides (npm-audit gate regression guard)', () => {
  describe('qs (GHSA-q8mj-m7cp-5q26 DoS)', () => {
    it('declares the pinned override in package.json', () => {
      expect(overrides.qs).toBe('^6.15.2');
    });

    it('resolves every lockfile entry to >= 6.15.2', () => {
      const entries = resolvedVersions('qs');
      expect(entries.length).toBeGreaterThan(0);
      for (const { path, version } of entries) {
        expect(gte(version, '6.15.2'), `${path} resolved qs ${version} < 6.15.2`).toBe(true);
      }
    });
  });

  describe('hono (GHSA-xrhx-7g5j-rcj5 et al.)', () => {
    it('declares the pinned override in package.json', () => {
      expect(overrides.hono).toBe('^4.12.25');
    });

    it('resolves every lockfile entry to >= 4.12.25', () => {
      const entries = resolvedVersions('hono');
      // hono may be absent from the production tree; if present it must be patched.
      for (const { path, version } of entries) {
        expect(gte(version, '4.12.25'), `${path} resolved hono ${version} < 4.12.25`).toBe(true);
      }
    });
  });

  describe('form-data (GHSA-hmw2-7cc7-3qxx CRLF injection)', () => {
    it('declares the patched floor as a direct dependency', () => {
      const deps = (pkg.dependencies ?? {}) as Record<string, string>;
      expect(deps['form-data']).toBe('^4.0.6');
    });

    it('resolves every lockfile entry to >= 4.0.6', () => {
      const entries = resolvedVersions('form-data');
      expect(entries.length).toBeGreaterThan(0);
      for (const { path, version } of entries) {
        expect(gte(version, '4.0.6'), `${path} resolved form-data ${version} < 4.0.6`).toBe(true);
      }
    });
  });
});
