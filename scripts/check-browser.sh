#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p .playwright-cli output/playwright/evidence
runtime_dir=$(mktemp -d)
server_pid=""
cleanup() {
    if [ -n "$server_pid" ]; then kill "$server_pid" 2>/dev/null || true; fi
    rm -rf "$runtime_dir"
}
trap cleanup EXIT
if curl --fail --silent http://127.0.0.1:4317/ >/dev/null; then
    echo "Port 4317 is already in use; stop the test server before running this check." >&2
    exit 1
fi
(cd web && exec node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 4317 --strictPort) >.playwright-cli/vite.log 2>&1 &
server_pid=$!
# Wait for this process to serve; do not attach tests to another user's development server.
while ! curl --fail --silent http://127.0.0.1:4317/ >/dev/null; do
    kill -0 "$server_pid" 2>/dev/null || { cat .playwright-cli/vite.log; exit 1; }
    sleep 1
done
# Reuse the pinned Playwright dependency, awaiting each fixture directly. The CLI
# returns before a snippet completes when its beforeunload modal state appears.
npm install --prefix "$runtime_dir" --no-save --package-lock=false --no-audit --no-fund @playwright/cli@0.1.22
node scripts/browser-regressions.mjs "$runtime_dir"
