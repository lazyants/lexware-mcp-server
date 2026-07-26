#!/usr/bin/env node
// Detects release drift between the last tagged release and the current
// tip. Two distinct drift modes, deliberately not folded into one
// invariant -- a version bump alone permanently disarms a single-invariant
// check (verified: bump package.json with no matching tag, keep committing
// to src/, and a "version already changed" check exits 0 forever).
//
//   Mode A -- forgot to bump: shippable paths changed since the last
//     release tag AND package.json's version still equals the version that
//     was recorded IN package.json AT that tag. FAILS the build (exit 1),
//     unless --warn-only is passed.
//   Mode B -- bumped but never released: package.json's version matches no
//     existing tag at all. This is the normal state between merging a
//     version-bump PR and publishing the GitHub Release that triggers
//     `publish-registry.yml`, so it is a `::warning::` annotation only and
//     always exits 0.
//
// The two conditions are mutually exclusive by construction: Mode A
// requires the version to equal one specific recorded value, Mode B
// requires it to match none at all. A version reverted to an OLDER,
// already-tagged value satisfies neither -- that combination is out of
// scope (documented, not a crash): the script falls through to "no drift
// detected" for it rather than raising.
//
// Dependency-free by design -- this runs with no `npm ci` step, so only
// Node built-ins are used.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const WARN_ONLY = process.argv.includes('--warn-only');

// Paths that actually ship in the npm tarball -- mirrors package.json's
// `files` field (`dist`, generated from `src` minus `src/tests`, plus
// these three). A change confined to `src/tests` or `package-lock.json`
// never needs a release, so both are excluded/omitted here per D11.
const SHIPPABLE_PATHSPECS = [
  'src',
  ':(exclude)src/tests',
  'package.json',
  'server.json',
  'README.md',
  'LICENSE',
  'logo.png',
];

// The first tag in this repo's history (v1.0.1) landed 10 commits in. A
// repo with far more commits than that and zero tags reachable from HEAD is
// much more likely to be a `--no-tags` clone (verified: a full-depth
// `--no-tags` clone is NOT reported as shallow, so the shallow guard alone
// misses it) than a genuinely pre-release repo. This threshold only
// misfires on a repo that racks up more commits than this before its own
// first release -- documented here rather than silently assumed.
const SUSPICIOUS_COMMIT_COUNT_WITH_NO_TAGS = 20;

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8' }).trim();
}

function fail(message) {
  console.error(`::error::${message}`);
  process.exit(1);
}

function warn(message) {
  console.log(`::warning::${message}`);
}

function readVersionAt(ref) {
  return JSON.parse(git(['show', `${ref}:package.json`])).version;
}

// --- Guard 1: shallow clone --------------------------------------------
// `git fetch --depth=1` (the checkout default) reports 0 tags AND
// `is-shallow-repository: true`. Left unguarded, `git describe` below would
// throw "no tags can describe" and get read as "no releases yet" -- a false
// all-clear on a repo that actually has releases. Fail loudly instead of
// silently passing.
if (git(['rev-parse', '--is-shallow-repository']) === 'true') {
  fail(
    'This checkout is shallow. check-release-drift.mjs needs full commit ' +
      'and tag history to compare against the last release -- re-run with ' +
      '`fetch-depth: 0` on actions/checkout.',
  );
}

// --- Locate the last release tag reachable from HEAD --------------------
let lastTag;
try {
  lastTag = git(['describe', '--tags', '--abbrev=0']);
} catch {
  // --- Guard 2: full-depth clone taken with `--no-tags` ------------------
  // Not caught by guard 1 (verified NOT flagged shallow). A repo this deep
  // with zero tags is far more likely to be missing tags than pre-release.
  const commitCount = Number(git(['rev-list', '--count', 'HEAD']));
  if (commitCount > SUSPICIOUS_COMMIT_COUNT_WITH_NO_TAGS) {
    fail(
      `No tags are reachable from HEAD, but HEAD has ${commitCount} commits ` +
        `(> ${SUSPICIOUS_COMMIT_COUNT_WITH_NO_TAGS}). This looks like a clone ` +
        'taken with `--no-tags` rather than a genuinely pre-release repo -- ' +
        're-run with full tag history (do not pass `--no-tags` to fetch).',
    );
  }
  console.log(
    `No tags reachable from HEAD, and only ${commitCount} commit(s) exist -- ` +
      'treating this as a pre-release repo with nothing to compare against.',
  );
  process.exit(0);
}

const currentVersion = JSON.parse(readFileSync('package.json', 'utf8')).version;
const taggedVersion = readVersionAt(lastTag);

// --- Mode B: bumped but never released -----------------------------------
// Checked against every tag, not just the latest -- a bump that happens to
// match an OLDER tag's version is covered by the "out of scope" note above,
// not by this branch.
const allTags = git(['tag', '--list']).split('\n').filter(Boolean);
const versionIsTagged = allTags.some((tag) => {
  try {
    return readVersionAt(tag) === currentVersion;
  } catch {
    return false; // tag predates package.json, or it was moved/renamed
  }
});
if (!versionIsTagged) {
  warn(
    `package.json version ${currentVersion} matches no existing tag. This is ` +
      'the expected state between merging a version-bump PR and publishing ' +
      'the GitHub Release -- if that release is overdue, publish it.',
  );
}

// --- Mode A: forgot to bump -----------------------------------------------
if (currentVersion === taggedVersion) {
  const changed = git(['diff', '--name-only', `${lastTag}..HEAD`, '--', ...SHIPPABLE_PATHSPECS]);
  if (changed) {
    const message =
      `Shippable paths changed since ${lastTag} (which shipped version ` +
      `${taggedVersion}), but package.json is still at ${currentVersion}. Bump ` +
      `the version.\n\nChanged shippable files:\n${changed}`;
    if (WARN_ONLY) {
      warn(message);
    } else {
      fail(message);
    }
  }
}

console.log(`No release drift detected (last release: ${lastTag} @ ${taggedVersion}, current: ${currentVersion}).`);
