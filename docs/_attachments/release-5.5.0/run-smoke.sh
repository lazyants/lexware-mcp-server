#!/usr/bin/env bash
# Post-publish smoke for @lazyants/lexware-mcp-server 5.5.0: install the tarball from npm into an
# empty directory and drive it with drive-smoke.mjs. Recorded with asciinema as release evidence.
set -euo pipefail
export GIT_PAGER=cat PAGER=cat
HERE="$(cd "$(dirname "$0")" && pwd)"
INSTALL="$(mktemp -d)"
trap 'rm -rf "$INSTALL"' EXIT

echo "\$ npm view @lazyants/lexware-mcp-server dist-tags.latest"
npm view @lazyants/lexware-mcp-server dist-tags.latest
echo
echo "\$ npm install @lazyants/lexware-mcp-server@5.5.0   (into an empty temp dir)"
(cd "$INSTALL" && npm init -y >/dev/null && npm install --no-audit --no-fund @lazyants/lexware-mcp-server@5.5.0 </dev/null 2>&1 | tail -2)
PKG="$INSTALL/node_modules/@lazyants/lexware-mcp-server"
echo "installed version: $(node -p "require('$PKG/package.json').version")"
echo "locked hono:       $(node -p "require('$INSTALL/node_modules/hono/package.json').version")"
echo
echo "\$ node drive-smoke.mjs .../dist/index.js"
node "$HERE/drive-smoke.mjs" "$PKG/dist/index.js" </dev/null
