#!/usr/bin/env bash
# [dianran] Publish one of the two Vercel Hobby projects. Refuses any other project name.
#
#   brand/pipeline/deploy.sh prompts   static prompt snapshot -> dianran-prompts
#   brand/pipeline/deploy.sh app       the website            -> dianran
#
# The website is only https://dianran.vercel.app. It reverse-proxies /prompt-sources/*
# to https://dianran-prompts.vercel.app, so prompt publishes do not rebuild the app.
# dianran-next is unused; this script will not deploy it.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCOPE="${VERCEL_SCOPE:-kobingogos-projects}"
WHAT="${1:-}"
die() { echo "ERROR: $*" >&2; exit 1; }

command -v vercel >/dev/null || die "vercel CLI not found"
[ "$WHAT" = "prompts" ] || [ "$WHAT" = "app" ] || die "usage: brand/pipeline/deploy.sh prompts|app"

STAGE="$(mktemp -d)"
cleanup() { rm -rf "$STAGE"; }
trap cleanup EXIT

link_exact() {
    local project="$1"
    vercel link --yes --project "$project" --scope "$SCOPE" >/dev/null
    local name
    name="$(node -p "JSON.parse(require('fs').readFileSync('.vercel/project.json','utf8')).projectName")"
    [ "$name" = "$project" ] || die "refusing to deploy: linked project is $name, expected $project"
}

if [ "$WHAT" = "prompts" ]; then
    [ -f "$ROOT/web/public/prompt-sources/manifest.json" ] || die "missing web/public/prompt-sources/manifest.json"
    cp -a "$ROOT/web/public/prompt-sources/." "$STAGE/"
    cp "$ROOT/brand/pipeline/prompt-host/vercel.json" "$STAGE/vercel.json"
    cd "$STAGE"
    link_exact dianran-prompts
    vercel deploy --prod --yes --scope "$SCOPE"
else
    git -C "$ROOT" archive HEAD | tar -x -C "$STAGE"
    cd "$STAGE"
    link_exact dianran
    vercel deploy --prod --yes --scope "$SCOPE"
fi
