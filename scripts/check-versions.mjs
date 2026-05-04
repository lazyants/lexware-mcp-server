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
const cmp = compareSemver(registryVersion, packagesVersion);
if (cmp < 0) {
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

function compareSemver(a, b) {
  if (a === b) return 0;
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0);
  }
  return 0;
}
