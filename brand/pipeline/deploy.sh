#!/usr/bin/env bash
# [dianran] Publish one of the two Vercel Hobby projects. Refuses any other project name.
#
#   brand/pipeline/deploy.sh prompts [sha]   static prompt snapshot -> dianran-prompts
#   brand/pipeline/deploy.sh app             the website            -> dianran
#
# prompts publishes the given commit (default HEAD), never a dirty working tree.
# After upload it polls the live site for up to 2 minutes, every 5 seconds, until
# /prompt-sources/manifest.json shows that commit's generatedAt and one cover is
# image/webp. A timeout fails the script; the deployment may still finish later.
# New rows that fail the content gate are not uploaded.
#
# The website is only https://dianran.vercel.app. It reverse-proxies /prompt-sources/*
# to https://dianran-prompts.vercel.app, so prompt publishes do not rebuild the app.
# dianran-next is unused; this script will not deploy it.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCOPE="${VERCEL_SCOPE:-kobingogos-projects}"
WHAT="${1:-}"
REF="${2:-HEAD}"
SMOKE_SECONDS=120
SMOKE_INTERVAL=5
die() { echo "ERROR: $*" >&2; exit 1; }

command -v vercel >/dev/null || die "vercel CLI not found"
command -v curl >/dev/null || die "curl not found"
command -v node >/dev/null || die "node not found"
[ "$WHAT" = "prompts" ] || [ "$WHAT" = "app" ] || die "usage: brand/pipeline/deploy.sh prompts [sha]|app"

STAGE="$(mktemp -d)"
cleanup() { cd "$ROOT"; rm -rf "$STAGE"; }
trap cleanup EXIT

link_exact() {
    local project="$1"
    vercel link --yes --project "$project" --scope "$SCOPE" >/dev/null
    local name
    name="$(node -p "JSON.parse(require('fs').readFileSync('.vercel/project.json','utf8')).projectName")"
    [ "$name" = "$project" ] || die "refusing to deploy: linked project is $name, expected $project"
}

manifest_at() {
    curl -fsS --max-time 20 -H "Cache-Control: no-cache" "$1" 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{try{process.stdout.write(String(JSON.parse(s).generatedAt||""))}catch{}})' || true
}

if [ "$WHAT" = "prompts" ]; then
    SHA="$(git -C "$ROOT" rev-parse --verify "${REF}^{commit}")" || die "bad revision $REF"
    if [ "$REF" = "HEAD" ] && [ -n "$(git -C "$ROOT" status --porcelain -uall -- web/public/prompt-sources)" ]; then
        die "prompt-sources has uncommitted changes; deploy publishes commit $SHA"
    fi
    git -C "$ROOT" fetch -q origin main
    HITS_JSON="$(node "$ROOT/brand/pipeline/content-gate.mjs" "$SHA" origin/main)"
    HITS="$(node -e 'const j=JSON.parse(process.argv[1]); if(j.error){console.error(j.error); process.exit(2)}; process.stdout.write(String(j.hits.length))' "$HITS_JSON")" || die "content gate could not read $SHA"
    if [ "$HITS" != "0" ]; then
        node -e 'const j=JSON.parse(process.argv[1]); for (const h of j.hits) console.error(`${h.library} ${h.id} ${h.reason}`)' "$HITS_JSON" >&2
        die "refusing to publish $SHA: $HITS new item(s) failed the content gate"
    fi

    git -C "$ROOT" archive "$SHA" web/public/prompt-sources | tar -x -C "$STAGE"
    OUT="$STAGE/site"
    mkdir -p "$OUT"
    cp -a "$STAGE/web/public/prompt-sources/." "$OUT/"
    cp "$ROOT/brand/pipeline/prompt-host/vercel.json" "$OUT/vercel.json"
    EXPECT="$(node -e 'process.stdout.write(String(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).generatedAt||""))' "$OUT/manifest.json")"
    [ -n "$EXPECT" ] || die "manifest.json in $SHA has no generatedAt"
    COVER="$(node -e '
const fs=require("fs"), path=require("path");
const dir=process.argv[1];
for (const file of fs.readdirSync(dir)) {
  if (!file.endsWith(".json") || file==="manifest.json") continue;
  const hit=JSON.parse(fs.readFileSync(path.join(dir,file),"utf8")).find((row)=>typeof row.coverUrl==="string" && row.coverUrl.startsWith("/prompt-sources/"));
  if (hit) { process.stdout.write(hit.coverUrl); break; }
}' "$OUT")"
    [ -n "$COVER" ] || die "no local cover in $SHA"

    cd "$OUT"
    link_exact dianran-prompts
    DEPLOY_LOG="$STAGE/deploy.log"
    vercel deploy --prod --yes --scope "$SCOPE" | tee "$DEPLOY_LOG"
    DEPLOY_URL="$(grep -oE 'https://[^[:space:]]+\.vercel\.app' "$DEPLOY_LOG" | grep -v 'dianran-prompts\.vercel\.app$' | head -1 || true)"
    echo "deployed $SHA ($EXPECT)${DEPLOY_URL:+ from $DEPLOY_URL}"

    LIVE="https://dianran.vercel.app/prompt-sources/manifest.json"
    DEADLINE=$((SECONDS + SMOKE_SECONDS))
    MATCHED=""
    while [ "$SECONDS" -lt "$DEADLINE" ]; do
        GOT="$(manifest_at "$LIVE")"
        if [ "$GOT" = "$EXPECT" ]; then
            CODE_TYPE="$(curl -fsS --max-time 20 -H "Cache-Control: no-cache" -o /dev/null -w "%{http_code} %{content_type}" "https://dianran.vercel.app${COVER}" || true)"
            case "$CODE_TYPE" in
                200\ *image/webp*) MATCHED=1; break ;;
            esac
            echo "manifest matches but cover not ready ($COVER -> ${CODE_TYPE:-no response})"
        fi
        remain=$((DEADLINE - SECONDS))
        [ "$remain" -gt 0 ] || break
        if [ "$remain" -lt "$SMOKE_INTERVAL" ]; then sleep "$remain"; else sleep "$SMOKE_INTERVAL"; fi
    done
    [ -n "$MATCHED" ] || die "live manifest did not settle on $EXPECT within ${SMOKE_SECONDS}s (last ${GOT:-empty}); commit $SHA is pushed if this run opened a PR"
    echo "live manifest $EXPECT and cover $COVER ok"
else
    git -C "$ROOT" archive HEAD | tar -x -C "$STAGE"
    cd "$STAGE"
    link_exact dianran
    vercel deploy --prod --yes --scope "$SCOPE"
fi
