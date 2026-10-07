#!/usr/bin/env bash
# [dianran] Twice-daily fast prompt-library update (additive only).
#   fetch (X short window, GitHub upstreams, Civitai) -> usage counts -> merge --additive-only
#   -> 点染精选 -> refresh manifest.generatedAt -> validate -> branch + PR -> deploy prompts.
# Only NEW candidates are added; nothing is ever removed here. Destructive maintenance
# (retire stale/broken, upstream removals, caps) stays in run-weekly.sh, which still
# opens a PR for human review and does not deploy.
#
# Publishing prompts does not rebuild or redeploy the website. The site at
# https://dianran.vercel.app proxies /prompt-sources/* to the dianran-prompts project.
#
# Intended schedule: twice daily, morning and evening (Asia/Taipei). Example crontab
# on a machine whose system timezone is Asia/Taipei:
#   30 6,18 * * * /path/to/dianran/brand/pipeline/run-twicedaily.sh >> /var/log/dianran-prompts.log 2>&1
# (cron runs in server timezone — convert the hours if the server is not on Asia/Taipei.)
#
# Usage:  brand/pipeline/run-twicedaily.sh
# Env:    X_WINDOW_DAYS  X search window in days (default 1.5; overlaps the previous run so nothing is missed)
#         MAX_NEW_ITEMS  abort the push if a run adds more than this (default 60; anomaly guard)
#         SKIP_X=1       skip X fetch when twscrape is down — other sources still update
# Needs:  node, git, gh (on branch main, in sync with origin/main); vercel logged in;
#         twscrape-x (logged in) unless SKIP_X=1;
#         BLOB_READ_WRITE_TOKEN for usage counts (env or ~/.config/dianran/pipeline.env).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"
START=$(date +%s)
DATE="$(TZ=Asia/Taipei date +%F)"
SLOT="$(TZ=Asia/Taipei date +%H | awk '{print ($1<12)?"am":"pm"}')"
X_WINDOW_DAYS="${X_WINDOW_DAYS:-1.5}"
MAX_NEW_ITEMS="${MAX_NEW_ITEMS:-60}"
LOG_DIR="$ROOT/brand/pipeline/candidates"
mkdir -p "$LOG_DIR"
LOG="$LOG_DIR/twicedaily-$DATE-$SLOT.log"
exec > >(tee -a "$LOG") 2>&1
# Optional secrets/overrides (e.g. CIVITAI_API_TOKEN, BLOB_READ_WRITE_TOKEN), never committed.
PIPELINE_ENV="${PIPELINE_ENV:-$HOME/.config/dianran/pipeline.env}"
if [ -f "$PIPELINE_ENV" ]; then set -a; . "$PIPELINE_ENV"; set +a; fi
say() { printf '\n[%s] == %s\n' "$(date +%H:%M:%S)" "$*"; }
die() { echo "ERROR: $*" >&2; exit 1; }

for bin in node git gh vercel; do command -v "$bin" >/dev/null || die "$bin not found"; done
[ "$(git branch --show-current)" = "main" ] || die "run-twicedaily.sh must run on main (it pushes directly)"
[ -z "$(git status --porcelain --untracked-files=no)" ] || die "working tree has uncommitted changes; commit or stash first"
git fetch -q origin main
[ "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)" ] || die "local main is behind origin/main; pull first"

export X_WINDOW_DAYS
[ -d brand/node_modules/sharp ] || (cd brand && npm ci --no-audit --no-fund)

say "fetch: X (window ${X_WINDOW_DAYS}d)"
if [ "${SKIP_X:-}" = "1" ]; then echo "skipped"; rm -f "$LOG_DIR/x.json"; else node brand/pipeline/fetch-x.mjs || { echo "X fetch failed — continuing without X candidates"; rm -f "$LOG_DIR/x.json"; }; fi
say "fetch: GitHub upstreams"
rm -rf "$LOG_DIR/github" "$LOG_DIR/github.json"
node brand/pipeline/fetch-github.mjs || echo "GitHub fetch failed — upstream libraries unchanged"
say "fetch: Civitai"
node brand/pipeline/fetch-civitai.mjs || { echo "Civitai fetch failed — continuing"; rm -f "$LOG_DIR/civitai.json"; }

say "usage counts"
node brand/pipeline/usage-read.mjs || echo "usage read failed — continuing without usage"
say "merge (additive only: new candidates in, nothing removed)"
node brand/pipeline/merge.mjs --additive-only
say "点染精选"
node brand/pipeline/picks.mjs
say "finalize (prune covers, manifest counts, snapshot time)"
node brand/pipeline/finalize.mjs "$DATE"

say "validate IDs, manifest counts and image references"
node --test brand/pipeline/prompt-key.test.mjs
node brand/pipeline/validate.mjs

ADDED="$(node -p "require('$LOG_DIR/merge-report.json').added.length")"
say "new items this run: $ADDED (limit $MAX_NEW_ITEMS)"
[ "$ADDED" -le "$MAX_NEW_ITEMS" ] || die "added $ADDED items exceeds limit $MAX_NEW_ITEMS — left uncommitted for human review"

if git diff --quiet -- web/public/prompt-sources brand/pipeline/data && [ -z "$(git ls-files --others --exclude-standard -- web/public/prompt-sources brand/pipeline/data)" ]; then
    say "no prompt changes"
else
    BRANCH="prompts/auto-$DATE-$SLOT"
    say "commit $BRANCH, open PR, publish prompt snapshot"
    git checkout -q -b "$BRANCH"
    git add web/public/prompt-sources brand/pipeline/data
    git commit -q -m "chore(prompts): 提示词库增量更新 $DATE $SLOT" -m "Additive-only fast path (brand/pipeline/run-twicedaily.sh). Destructive maintenance stays in the weekly PR."
    git push -q -u origin "$BRANCH"
    gh pr create --base main --head "$BRANCH" --title "提示词库增量 $DATE $SLOT" --body "早晚增量。只新增，已在本机校验。线上提示词由本脚本发布到 dianran-prompts；主站 https://dianran.vercel.app/prompt-sources 反代过去。合并这个 PR 让 git 与线上快照一致。" || gh pr view "$BRANCH" --json url -q .url
    brand/pipeline/deploy.sh prompts || DEPLOY_FAIL=1
    git checkout -q main
    [ -z "${DEPLOY_FAIL:-}" ] || die "prompt deploy failed; PR branch is $BRANCH"
fi

ELAPSED=$(( $(date +%s) - START ))
say "done in $((ELAPSED / 60))m $((ELAPSED % 60))s"
echo "log: $LOG"
