#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(resolve(repoRoot, 'package.json'), 'utf8'));
const srv = JSON.parse(readFileSync(resolve(repoRoot, 'server.json'), 'utf8'));

const npmVersion = pkg.version;
const packagesVersion = srv.packages?.[0]?.version;
const registryVersion = srv.version;

if (!npmVersion || !packagesVersion || !registryVersion) {
  console.error(
    `[check-versions] FAIL: missing version field — ` +
      `package.json#/version=${npmVersion}, ` +
      `server.json#/packages[0].version=${packagesVersion}, ` +
      `server.json#/version=${registryVersion}.`
  );
  process.exit(1);
}

const errors = [];
const warnings = [];

// HARD: package.json#/version must match server.json#/packages[0].version.
// This protects npm publish — the package version on the registry listing
// must match the actual published artifact on npm.
if (npmVersion !== packagesVersion) {
  errors.push(
    `package.json#/version (${npmVersion}) !== server.json#/packages[0].version (${packagesVersion}). ` +
      `These must match: the MCP Registry listing references this exact npm version.`
  );
}

// SOFT: server.json#/version (the registry version) should be >= packages[0].version.
// Registry-only republishes bump only the root version (see commit 01618d8 for the
// precedent — root 1.0.1 with packages[0] still 1.0.0). CLAUDE.md documents that
// these CAN differ. We only warn on regressions.
if (compareSemver(registryVersion, packagesVersion) < 0) {
  warnings.push(
    `server.json#/version (${registryVersion}) < server.json#/packages[0].version (${packagesVersion}). ` +
      `Registry version should never be older than the npm version it references.`
  );
}

for (const w of warnings) console.warn(`[check-versions] WARN: ${w}`);

if (errors.length) {
  for (const e of errors) console.error(`[check-versions] FAIL: ${e}`);
  process.exit(1);
}

console.log(
  `[check-versions] OK — npm=${npmVersion}, packages[0]=${packagesVersion}, registry=${registryVersion}`
);

// Semver compare per https://semver.org/spec/v2.0.0.html §11.
// Without prerelease handling, `2.0.0-rc.1` would compare equal to `2.0.0`
// and a regression like registry=2.0.0-rc.1 vs packages[0]=2.0.0 would
// silently pass the soft check.
function compareSemver(a, b) {
  if (a === b) return 0;
  const [coreA, preA = ''] = splitVersion(a);
  const [coreB, preB = ''] = splitVersion(b);
  for (let i = 0; i < 3; i++) {
    if (coreA[i] !== coreB[i]) return coreA[i] - coreB[i];
  }
  // Equal core: §11 — version with prerelease has lower precedence than without.
  if (preA === '' && preB === '') return 0;
  if (preA === '') return 1;
  if (preB === '') return -1;
  return comparePrerelease(preA, preB);
}

function splitVersion(v) {
  // §10: build metadata (`+...`) is ignored for precedence.
  const stripped = v.replace(/\+.*$/, '');
  const [core, ...rest] = stripped.split('-');
  const parts = core.split('.').map((p) => {
    if (!/^(0|[1-9]\d*)$/.test(p)) {
      throw new Error(`[check-versions] malformed core segment "${p}" in version "${v}"`);
    }
    return parseInt(p, 10);
  });
  while (parts.length < 3) parts.push(0);
  return [parts.slice(0, 3), rest.join('-')];
}

// §11 prerelease compare: identifier-by-identifier, numeric < alpha,
// numerics compared as numbers, alphas lexically (ASCII), shorter set
// loses on a tie when all preceding identifiers match.
function comparePrerelease(a, b) {
  const ai = a.split('.');
  const bi = b.split('.');
  const len = Math.max(ai.length, bi.length);
  for (let i = 0; i < len; i++) {
    if (ai[i] === undefined) return -1;
    if (bi[i] === undefined) return 1;
    const an = /^\d+$/.test(ai[i]);
    const bn = /^\d+$/.test(bi[i]);
    if (an && bn) {
      const diff = parseInt(ai[i], 10) - parseInt(bi[i], 10);
      if (diff !== 0) return diff;
    } else if (an !== bn) {
      return an ? -1 : 1;
    } else if (ai[i] !== bi[i]) {
      return ai[i] < bi[i] ? -1 : 1;
    }
  }
  return 0;
}
