#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p .playwright-cli output/playwright/evidence
CLI=(npx --yes --package=@playwright/cli@0.1.22 playwright-cli)
active_session=""
server_pid=""
cleanup() {
    if [ -n "$active_session" ]; then "${CLI[@]}" -s="$active_session" close >/dev/null 2>&1 || true; fi
    if [ -n "$server_pid" ]; then kill "$server_pid" 2>/dev/null || true; fi
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
for test in copy reliability workflow video-recovery delivery agent-plan retry creation-tools; do
    active_session="dianran-ci-$test"
    "${CLI[@]}" -s="$active_session" open http://127.0.0.1:4317/ >/dev/null
    if ! "${CLI[@]}" -s="$active_session" run-code --filename "output/playwright/$test-regression.js" --raw >".playwright-cli/$test.result.json"; then
        cat ".playwright-cli/$test.result.json"
        exit 1
    fi
    node -e 'const fs=require("node:fs"); const result=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); if(!result) throw new Error("No result"); console.log(process.argv[1],JSON.stringify(result));' ".playwright-cli/$test.result.json"
    "${CLI[@]}" -s="$active_session" close >/dev/null
    active_session=""
done
