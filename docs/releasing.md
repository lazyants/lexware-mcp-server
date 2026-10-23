# Releasing

Maintainer procedure for publishing a new version to npm and the MCP Registry. Users of the server
do not need this; see the [README](../README.md) instead.

## Preparing a version is not publishing it

Merging a version bump to `main` only *prepares* a release. Nothing reaches npm or the MCP Registry
until a GitHub Release is created (step 3 below).

The `Release drift guard` workflow ([`release-drift.yml`](../.github/workflows/release-drift.yml))
runs [`scripts/check-release-drift.mjs`](../scripts/check-release-drift.mjs) on every push to
`main`, weekly, and on demand. It needs full commit and tag history and fails on a shallow or
`--no-tags` clone. It reports two states:

- **Forgot to bump — fails.** Shippable paths (`src` except `src/tests`, `package.json`,
  `server.json`, `README.md`, `LICENSE`, `logo.png`) changed since the last release tag, but
  `package.json` still has the version recorded at that tag. Merging a version bump clears it.
  Changes under `docs/` are not shippable paths.
- **Bumped but not released — warning only.** The `package.json` version matches no release tag.
  This is the expected state between merging the bump and publishing the GitHub Release. The job
  stays green, so a green guard with this warning means "prepared, not published".

## Release steps

Releases ship via the GitHub Release event. Maintainer flow:

1. Bump the version in `package.json`, `package-lock.json`, and `server.json` (`npm version <x.y.z> --no-git-tag-version` updates the first two together). `npm run check-versions` hard-fails unless `package.json#/version`, `server.json#/packages[0].version`, and both `package-lock.json` version fields (root and `packages[""]`) all agree. `server.json#/version` is checked more loosely: it must be present, but it is only compared against `packages[0].version` as a regression check — it may legitimately be *ahead* (registry-only republishes bump just that field), so a value left behind at the previous release passes with a `WARN:` line and no failure. For an ordinary release both should move together, so read the script's output rather than trusting its exit code. `CHANGELOG.md` is not checked at all.
2. Update `CHANGELOG.md`.
3. Commit, and **merge the version bump to `main` before creating the release**. Then create the tag yourself, on a SHA you have checked, and only then create the release from it:

   ```bash
   V=X.Y.Z && PR=<release-pr-number> &&
     SHA="$(gh pr view "$PR" --json mergeCommit -q .mergeCommit.oid)" && test -n "$SHA" &&
     git fetch origin main && git merge-base --is-ancestor "$SHA" origin/main &&
     PKG="$(git show "$SHA:package.json")" &&
     test "$(printf '%s' "$PKG" | node -pe 'JSON.parse(require("fs").readFileSync(0,"utf8")).version')" = "$V" &&
     CL="$(git show "$SHA:CHANGELOG.md")" &&
     printf '%s\n' "$CL" | awk -v v="$V" 'index($0,"## ["v"]")==1{f=1;next} /^## \[/{f=0} /^\[[0-9]+\.[0-9]+\.[0-9]+\]:/{f=0} f' > "/tmp/notes-v$V.md" &&
     grep -q '[^[:space:]]' "/tmp/notes-v$V.md" &&
     git tag -a "v$V" "$SHA" -m "v$V" &&
     git push origin "v$V" &&
     gh release create "v$V" --verify-tag --notes-file "/tmp/notes-v$V.md"
   ```

   The failure this prevents: with no existing tag, `gh release create` places one on the **tip of the default branch**, so running it while the bump is still on a release branch tags the *previous* release's commit. The workflow then publishes whatever version it finds in that commit's `package.json`, and you get a `vX.Y.Z` GitHub Release that silently republishes the old version. Since 5.2.0 the publish workflow itself refuses to continue when `GITHUB_REF_NAME` is not `v<package.json version>` (#103), so a mis-tagged release now fails before `npm publish` rather than silently republishing. That guard fires only once the workflow is already running, though — the sequence above is what stops the wrong commit being tagged in the first place, so keep using it rather than relying on the workflow to catch the mistake.

   Each element is load-bearing:

   - **`gh pr view … .mergeCommit.oid`** names the release PR's own squash commit. Do not substitute `git rev-parse origin/main` — that is merely whatever is on `main` at the moment you look, so an unrelated merge landing in the gap gets tagged and shipped instead. `gh` exits 0 and prints nothing for an unmerged PR, hence the explicit `test -n`.
   - **The `&&` chain** stops on the first failure instead of falling through to the irreversible step. Both `git show` calls are assigned to a variable rather than piped directly, so their exit status is actually checked — a pipeline reports only its *last* command's status unless `pipefail` is set, which is not assumed here.
   - **`git merge-base --is-ancestor`** proves the commit is actually reachable from `main`. Mere existence is not enough — a commit can be present locally because some other branch was fetched, and if its version files happen to match it would otherwise sail through every remaining check.
   - **The version test reads `package.json` out of the target commit**, not the working tree, which would still show the right version while `$SHA` pointed elsewhere.
   - **The `awk`** lifts that version's section out of the commit's `CHANGELOG.md` for `--notes-file`. Without it the release body is whatever `--notes-from-tag` finds in the annotation — for this flow, the literal string `vX.Y.Z`, which is a poor release note for any version and an actively misleading one for a major carrying a breaking change. It stops at the next `## [` heading *or* at the first link-reference definition, because the oldest entry in the file has no heading after it and would otherwise swallow the entire link-reference block. `grep -q` rather than `test -s` guards the result: a section that is empty apart from its blank line still produces a one-byte file, which `test -s` accepts.
   - **`--verify-tag`** makes `gh` abort rather than invent a tag if the push did not land — the guard against `gh` falling back to the tip-of-default-branch behavior described above.

   If `gh release create` fails after the tag is already pushed, do not rerun the whole block — it will stop at `git tag`, which is correct. Rerun only the final command.
4. The `Publish to npm + MCP Registry` workflow runs automatically: it `npm publish`es with provenance, polls the registry until the tarball is available, then pushes the matching `server.json` to the MCP Registry via `mcp-publisher`.

The workflow skips `npm publish` cleanly if the version is already on npm (cutover guard for releases that were partially published manually).

## Publishing auth — npm Trusted Publishing (no token)

Publishing uses **npm Trusted Publishing** via OIDC — there is **no `NPM_TOKEN` secret**. The workflow's `id-token: write` permission is exchanged for a short-lived, one-shot publish token at publish time, using the trusted-publisher binding configured for `@lazyants/lexware-mcp-server` in the npm web UI. The only setup required is that trusted-publisher binding on npm; nothing needs to be stored in repository secrets.
