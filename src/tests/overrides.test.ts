import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Regression guard for the npm-audit gate. Asserts BOTH layers so it cannot be
// fooled by a stale lockfile:
//   (a) the manifest declaration is present and pinned, and
//   (b) every resolved entry in the committed lockfile satisfies the floor.
// Checking only resolved versions would still pass after someone deletes the
// `overrides` block (until the lock is regenerated); checking only the
// declaration would miss a lockfile that drifted below the floor.
//
// NOTE: a pin that was correct when written can rot in place. `fast-uri ^3.1.2`
// and `hono ^4.12.25` both kept resolving INSIDE their advisory ranges as those
// ranges were extended by later GHSAs, so the gate went red on an untouched
// `main` while every PR still showed a stale green check. Refreshing a pin is a
// one-line edit: each entry below states its floor once and both layers derive
// from it.
//
// SCOPE — what `overrides` can and cannot do. npm honours `overrides` only from
// the INSTALL ROOT, never from an installed dependency's manifest. So this file
// guards THIS repository's resolution (and therefore its CI audit gate); it does
// not by itself dictate what an `npx @lazyants/lexware-mcp-server` consumer gets.
// Measured from a real `npm pack` + install into an empty project (2026-07-27):
// consumers resolve hono 4.12.32, fast-uri 3.1.4 and body-parser 2.3.0 — all
// patched, because the SDK's/express's own ranges already permit the fixed
// versions — but @hono/node-server 1.19.15, which is NOT patched.
// That last one cannot be fixed from here: GHSA-frvp-7c67-39w9 covers < 2.0.5,
// i.e. every 1.x with no 1.x patch, while the SDK declares ^1.19.9. Only an SDK
// release widening that range fixes it for consumers. Runtime exposure is nil
// either way (stdio-only; the hono code is never imported), but consumers' own
// `npm audit` will flag it. Tracked as a follow-up issue.

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

const lock = readJson('package-lock.json');
const lockPackages = (lock.packages ?? {}) as Record<string, { version?: string }>;

/** All resolved versions for a dependency name across every nesting level. */
function resolvedVersions(name: string): { path: string; version: string }[] {
  const re = new RegExp(`(^|/)node_modules/${name}$`);
  return Object.entries(lockPackages)
    .filter(([path, meta]) => re.test(path) && typeof meta.version === 'string')
    .map(([path, meta]) => ({ path, version: meta.version as string }));
}

interface Pin {
  name: string;
  /** Lowest safe version: the manifest declares `^<floor>`, every resolved entry must be >= it. */
  floor: string;
  /** Advisory the pin answers; shown in the test title. */
  advisory: string;
  /** Manifest section carrying the pin. */
  declaredIn: 'overrides' | 'dependencies';
}

const PINS: Pin[] = [
  {
    name: 'qs',
    floor: '6.15.2',
    advisory: 'GHSA-q8mj-m7cp-5q26 DoS',
    declaredIn: 'overrides',
  },
  {
    // Advisory range grew to <= 4.12.26 (GHSA-w62v-xxxg-mg59, GHSA-hvrm-45r6-mjfj,
    // GHSA-xgm2-5f3f-mvvc), so the previous ^4.12.25 pin resolved inside it.
    name: 'hono',
    floor: '4.12.27',
    advisory: 'GHSA-xrhx-7g5j-rcj5 et al.',
    declaredIn: 'overrides',
  },
  {
    // Advisory range 3.0.0-3.1.3; 3.1.4 is the first 3.x outside it. Stay on
    // 3.x — `ajv` declares `fast-uri: ^3.0.1`.
    name: 'fast-uri',
    floor: '3.1.4',
    advisory: 'GHSA-v2hh-gcrm-f6hx, GHSA-4c8g-83qw-93j6 host confusion',
    declaredIn: 'overrides',
  },
  {
    // Forced MAJOR against the SDK's declared `^1.19.9`. Safe because this
    // server only ever uses StdioServerTransport: following the ESM import
    // graph from src/server.ts (sdk/server/mcp.js + /stdio.js) reaches no hono
    // code at all — only sdk/server/streamableHttp.js imports it, and nothing
    // we load imports that. Revisit if the HTTP transport is ever adopted.
    // Floor is 2.0.10, NOT the 2.0.5 of the path-traversal advisory alone:
    // GHSA-9mqv-5hh9-4cgg (WebSocket-handshake memory-leak DoS) covers
    // <= 2.0.9, so a ^2.0.5 pin would itself sit inside a live range.
    name: '@hono/node-server',
    floor: '2.0.10',
    advisory: 'GHSA-frvp-7c67-39w9 path traversal, GHSA-9mqv-5hh9-4cgg DoS',
    declaredIn: 'overrides',
  },
  {
    name: 'body-parser',
    floor: '2.3.0',
    advisory: 'GHSA-v422-hmwv-36x6 DoS via invalid limit',
    declaredIn: 'overrides',
  },
  {
    // Dev-only (eslint -> minimatch), so it never reaches the `--omit=dev` gate
    // — but it rotted the same way: the previous ^5.0.6 pin sat inside
    // GHSA-mh99-v99m-4gvg (<= 5.0.7). Guarded here so it cannot rot unnoticed.
    name: 'brace-expansion',
    floor: '5.0.8',
    advisory: 'GHSA-mh99-v99m-4gvg, GHSA-3jxr-9vmj-r5cp ReDoS',
    declaredIn: 'overrides',
  },
  {
    // Patched by raising the direct dependency rather than by an override.
    name: 'form-data',
    floor: '4.0.6',
    advisory: 'GHSA-hmw2-7cc7-3qxx CRLF injection',
    declaredIn: 'dependencies',
  },
];

describe('security overrides (npm-audit gate regression guard)', () => {
  // A plain loop rather than `describe.each`, which quotes and truncates
  // interpolated titles ("'fast-uri' ('GHSA-v2hh-gcrm-f6hx, GHSA-4c8g-83…')").
  for (const { name, floor, advisory, declaredIn } of PINS) {
    describe(`${name} (${advisory})`, () => {
      it(`declares ^${floor} in package.json ${declaredIn}`, () => {
        const declarations = (pkg[declaredIn] ?? {}) as Record<string, string>;
        expect(declarations[name]).toBe(`^${floor}`);
      });

      it(`resolves every lockfile entry to >= ${floor}`, () => {
        const entries = resolvedVersions(name);
        // Always assert presence: a pinned package that stops resolving means this
        // guard silently stopped guarding, which is the exact failure mode it exists
        // to catch. Verified 2026-07-27 that all seven resolve, and that the MCP SDK
        // declares no optionalDependencies -- hono, @hono/node-server, express and
        // ajv are all regular deps, so none of these is conditionally installed.
        expect(entries.length, `${name} is pinned but resolves nowhere`).toBeGreaterThan(0);
        for (const { path, version } of entries) {
          expect(gte(version, floor), `${path} resolved ${name} ${version} < ${floor}`).toBe(true);
        }
      });
    });
  }
});
