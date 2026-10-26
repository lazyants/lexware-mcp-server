#!/bin/bash
# Builds the server and runs the read-only smoke test against dist/index.js over
# stdio. Needs no Lexware credentials: no tool call in it reaches the API.
# Record with: asciinema rec --headless --overwrite \
#   --command "bash docs/_attachments/issue-149-read-only-mode/run-smoke.sh" \
#   docs/_attachments/issue-149-read-only-mode/read-only-smoke.cast
set -eu
export GIT_PAGER=cat PAGER=cat
cd "$(dirname "$0")/../../.."

echo "\$ git log --oneline -1"
git log --oneline -1
echo "\$ npm run build"
npm run build --silent
echo "build ok"
echo "\$ node docs/_attachments/issue-149-read-only-mode/drive-read-only-smoke.mjs dist/index.js"
status=0
node docs/_attachments/issue-149-read-only-mode/drive-read-only-smoke.mjs dist/index.js || status=$?
echo "exit code: $status"
exit "$status"
