#!/usr/bin/env bash
# [dianran] Twice-daily fast prompt-library update (additive only).
#   fetch (X short window, GitHub upstreams, Civitai) -> usage counts -> merge --additive-only
#   -> 点染精选 -> manifest.generatedAt only when the public snapshot changed
#   -> validate -> one branch/PR per slot -> deploy that commit.
# Nothing is removed here. Destructive maintenance stays in run-weekly.sh.
#
# One run ends in exactly one of:
#   无变化    no new rows, picks membership or covers; no commit, no deploy
#   已发布    commit pushed, dianran.vercel.app manifest matches this commit
#   失败      every fetch failed, or the deploy/smoke check failed
#
# Publishing prompts does not rebuild the website. https://dianran.vercel.app
# proxies /prompt-sources/* to the dianran-prompts project.
#
# Intended schedule (not installed by this repo): twice daily, Asia/Taipei.
#   30 6,18 * * * DIANRAN_PROMPT_PIPELINE_ROOT=/path/to/dianran-prompts /path/to/dianran/brand/pipeline/run-twicedaily.sh >> /var/log/dianran-prompts.log 2>&1
# Run it on one machine. A lock in the resource repository candidates/ refuses an overlapping run.
# Re-running the same slot checks out that open branch first, so a deploy retry keeps
# rows already committed there, then updates the same PR.
#
# Usage:  brand/pipeline/run-twicedaily.sh
# Env:    X_WINDOW_DAYS  X search window in days (default 1.5; since: is a UTC date, so the
#                        lookback is about 1.5–2.5 days)
#         SKIP_X=1       skip X fetch when twscrape is down — other sources still update
# Needs:  node, git, gh (on branch main, in sync with origin/main); vercel logged in;
#         twscrape-x (logged in) unless SKIP_X=1;
#         BLOB_READ_WRITE_TOKEN for usage counts (env or ~/.config/dianran/pipeline.env).
set -euo pipefail

source "$(dirname "${BASH_SOURCE[0]}")/environment.sh"
cd "$ROOT"
START=$(date +%s)
DATE="$(TZ=Asia/Taipei date +%F)"
SLOT="$(TZ=Asia/Taipei date +%H | awk '{print ($1<12)?"am":"pm"}')"
X_WINDOW_DAYS="${X_WINDOW_DAYS:-1.5}"
LOG_DIR="$ROOT/candidates"
mkdir -p "$LOG_DIR"
LOG="$LOG_DIR/twicedaily-$DATE-$SLOT.log"
exec > >(tee -a "$LOG") 2>&1
say() { printf '\n[%s] == %s\n' "$(date +%H:%M:%S)" "$*"; }
die() { echo "ERROR: $*" >&2; exit 1; }
MOVED=0
cleanup() {
    if [ "$MOVED" = 1 ] && [ "$(git branch --show-current 2>/dev/null || true)" != "main" ]; then
        git checkout -q -f main || true
    fi
    rm -rf "$LOCK"
}
LOCK="$LOG_DIR/.twicedaily.lock"
if ! mkdir "$LOCK" 2>/dev/null; then
    old="$(cat "$LOCK/pid" 2>/dev/null || true)"
    if [ -n "$old" ] && kill -0 "$old" 2>/dev/null; then
        die "another run is in progress (pid $old)"
    fi
    rm -rf "$LOCK"
    mkdir "$LOCK"
fi
echo $$ > "$LOCK/pid"
trap cleanup EXIT

for bin in node git gh vercel curl; do command -v "$bin" >/dev/null || die "$bin not found"; done
[ "$(git branch --show-current)" = "main" ] || die "run-twicedaily.sh must run on main"
[ -z "$(git status --porcelain -uall)" ] || die "working tree has uncommitted changes; commit or stash first"
git fetch -q origin main
[ "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)" ] || die "local main is behind or ahead of origin/main; sync first"
MAIN_SHA="$(git rev-parse HEAD)"
PUBLISHED_BRANCH="codex/prompt-published"
BASE_SHA="$MAIN_SHA"
if git fetch -q origin "$PUBLISHED_BRANCH" 2>/dev/null; then
    BASE_SHA="$(git rev-parse "origin/$PUBLISHED_BRANCH")"
    if git merge-base --is-ancestor "$BASE_SHA" "$MAIN_SHA"; then BASE_SHA="$MAIN_SHA"
    else git merge-base --is-ancestor "$MAIN_SHA" "$BASE_SHA" || die "main 与已发布基线分叉，请人工合并后再采集"; fi
elif [ -n "${DIANRAN_PROMPT_BASELINE_COMMIT:-}" ]; then
    git fetch -q origin "$DIANRAN_PROMPT_BASELINE_COMMIT"
    BASE_SHA="$(git rev-parse "${DIANRAN_PROMPT_BASELINE_COMMIT}^{commit}")"
    git merge-base --is-ancestor "$MAIN_SHA" "$BASE_SHA" || die "初始发布基线不包含 main"
fi
# Never rebuild from an older main when a previous unmerged snapshot is online.
BASE_VERSION="$(git show "$BASE_SHA:prompt-sources/manifest.json" | node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>process.stdout.write(JSON.parse(s).generatedAt||""))')"
LIVE_VERSION="$(curl -fsS https://dianran.vercel.app/prompt-sources/manifest.json | node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>process.stdout.write(JSON.parse(s).generatedAt||""))')"
[ "$BASE_VERSION" = "$LIVE_VERSION" ] || die "已发布基线与线上版本不一致；请设置 DIANRAN_PROMPT_BASELINE_COMMIT 为已核验的线上提交"
if ! git show-ref --verify --quiet "refs/remotes/origin/$PUBLISHED_BRANCH"; then
    git push -q origin "$BASE_SHA:refs/heads/$PUBLISHED_BRANCH"
fi

# Same slot updates the open PR when that branch still contains current main.
# A merged or diverged slot gets a numeric suffix instead of rewriting history.
pick_parent() {
    BRANCH="prompts/auto-$DATE-$SLOT"
    PARENT="$BASE_SHA"
    local n=2 tip state
    while git fetch -q origin "$BRANCH" 2>/dev/null; do
        tip="$(git rev-parse "origin/$BRANCH")"
        if git merge-base --is-ancestor "$BASE_SHA" "$tip"; then
            state="$(gh pr view "$BRANCH" --json state -q .state 2>/dev/null || echo OPEN)"
            if [ "$state" = "OPEN" ]; then PARENT="$tip"; return; fi
        fi
        BRANCH="prompts/auto-$DATE-$SLOT-$n"
        n=$((n + 1))
        [ "$n" -le 20 ] || die "too many existing slots for $DATE $SLOT"
    done
}
pick_parent
if [ "$PARENT" != "$MAIN_SHA" ]; then
    say "continue open slot $BRANCH"
    git checkout -q -B "$BRANCH" "$PARENT"
    MOVED=1
fi

export X_WINDOW_DAYS
[ -d "$CODE_ROOT/brand/node_modules/sharp" ] || (cd "$CODE_ROOT/brand" && npm ci --no-audit --no-fund)

mark() { echo "$2" > "$LOG_DIR/fetch-$1.status"; }
say "fetch: X (window ${X_WINDOW_DAYS}d)"
if [ "${SKIP_X:-}" = "1" ]; then echo "skipped"; rm -f "$LOG_DIR/x.json"; mark x skip
else
    if node "$CODE_ROOT/brand/pipeline/fetch-x.mjs"; then
        X_FETCH_STATUS="$(node -e 'const r=require(process.argv[1]); process.stdout.write(r.stats.errors.length ? "partial" : "ok")' "$LOG_DIR/x.json")"
        mark x "$X_FETCH_STATUS"
    else echo "X fetch failed — continuing without X candidates"; rm -f "$LOG_DIR/x.json"; mark x fail; fi
fi
say "fetch: GitHub upstreams"
rm -rf "$LOG_DIR/github" "$LOG_DIR/github.json"
node "$CODE_ROOT/brand/pipeline/fetch-github.mjs" && mark github ok || { echo "GitHub fetch failed — upstream libraries unchanged"; mark github fail; }
say "fetch: Civitai"
node "$CODE_ROOT/brand/pipeline/fetch-civitai.mjs" && mark civitai ok || { echo "Civitai fetch failed — continuing"; rm -f "$LOG_DIR/civitai.json"; mark civitai fail; }

word() { case "$1" in ok) echo 成功 ;; partial) echo 部分失败 ;; fail) echo 失败 ;; skip) echo 跳过 ;; unavailable) echo 不可用 ;; *) echo 未跑 ;; esac; }
X_STATUS="$(cat "$LOG_DIR/fetch-x.status")"
GH_STATUS="$(cat "$LOG_DIR/fetch-github.status")"
CV_STATUS="$(cat "$LOG_DIR/fetch-civitai.status")"
FETCH_LINE="X $(word "$X_STATUS")，GitHub $(word "$GH_STATUS")，Civitai $(word "$CV_STATUS")"
if [ "$X_STATUS" != ok ] && [ "$X_STATUS" != partial ] && [ "$GH_STATUS" != ok ] && [ "$CV_STATUS" != ok ]; then
    printf '抓取：%s\n结果：失败（全部抓取失败，未发布）\n' "$FETCH_LINE"
    exit 1
fi

say "usage counts"
node "$CODE_ROOT/brand/pipeline/usage-read.mjs" || echo "usage read failed — continuing without usage"
USAGE_STATUS="$(node -e 'const s=require(process.argv[1]).status; process.stdout.write(s==="ok"?"ok":s==="unavailable"?"unavailable":"fail")' "$ROOT/data/usage.json")"
FETCH_LINE="$FETCH_LINE，用量 $(word "$USAGE_STATUS")"
say "merge (additive only: new candidates in, nothing removed)"
node "$CODE_ROOT/brand/pipeline/merge.mjs" --additive-only
say "点染精选"
node "$CODE_ROOT/brand/pipeline/picks.mjs"
say "finalize (prune covers, manifest counts, snapshot time only when the public library changed)"
node "$CODE_ROOT/brand/pipeline/finalize.mjs" "$DATE"

say "validate IDs, manifest counts and image references"
node --test "$CODE_ROOT/brand/pipeline/prompt-key.test.mjs"
node "$CODE_ROOT/brand/pipeline/validate.mjs"

ADDED="$(node -p "require('$LOG_DIR/merge-report.json').added.length")"
CHANGED="$(node -p "require('$LOG_DIR/finalize.json').changed ? 'true' : 'false'")"
VERSION="$(node -p "require('$LOG_DIR/finalize.json').version")"
ADDED_LINE="$(node -e '
const r=require(process.argv[1]);
const parts=Object.entries(r.perLibrary||{}).filter(([,v])=>v.added).map(([k,v])=>k+" +"+v.added);
process.stdout.write(String(r.added.length)+(parts.length?"（"+parts.join("，")+"）":""));
' "$LOG_DIR/merge-report.json")"
say "new items this run: $ADDED; public changed: $CHANGED"

back_to_main() {
    if [ "$(git branch --show-current)" != "main" ]; then
        git checkout -q -f main
    else
        git reset -q -- prompt-sources data reports || true
        git checkout -q -- prompt-sources data reports || true
        git clean -fd -- prompt-sources data reports >/dev/null || true
    fi
    MOVED=0
}

write_status() {
    local result="$1" publish="$2"
    PR_URL="${PR_URL:-}"
    STATUS_FILE="$LOG_DIR/status-$DATE-$SLOT.txt"
    {
        printf '快照：%s\n' "$VERSION"
        printf '新增：%s\n' "$ADDED_LINE"
        printf '抓取：%s\n' "$FETCH_LINE"
        printf '发布：%s\n' "$publish"
        printf '结果：%s\n' "$result"
    } | tee "$STATUS_FILE"
    if [ -n "${DIANRAN_PIPELINE_RESULT_FILE:-}" ]; then
        node --input-type=module - "$DIANRAN_PIPELINE_RESULT_FILE" "$result" "$VERSION" "$ADDED" "$FETCH_LINE" "${PR_URL:-}" "${DIANRAN_PIPELINE_RUN_URL:-}" <<'NODE'
import { writeFileSync, renameSync } from "node:fs";
const [file, result, snapshot, added, sources, prUrl, runUrl] = process.argv.slice(2);
const status = result.startsWith("待人工") ? "held" : result.startsWith("无变化") ? "unchanged" : result === "已发布" ? "published" : "failed";
writeFileSync(`${file}.tmp`, JSON.stringify({ status, snapshot, added: Number(added), sources, prUrl, runUrl }));
renameSync(`${file}.tmp`, file);
NODE
    fi
}

open_pr() {
    local title="$1" url state
    if url="$(gh pr view "$BRANCH" --json url -q .url 2>/dev/null)"; then
        state="$(gh pr view "$BRANCH" --json state -q .state)"
        if [ "$state" = "OPEN" ]; then
            gh pr edit "$BRANCH" --title "$title" --body-file "$STATUS_FILE" >/dev/null
            echo "$url"
            return
        fi
    fi
    gh pr create --base main --head "$BRANCH" --title "$title" --body-file "$STATUS_FILE"
}

publish_commit() {
    local sha="$1" title="$2" ok_result="$3" ok_publish="$4"
    say "publish $sha"
    if "$CODE_ROOT/brand/pipeline/deploy.sh" prompts "$sha"; then
        git push -q origin "$sha:refs/heads/$PUBLISHED_BRANCH"
        write_status "$ok_result" "$ok_publish"
        gh pr edit "$BRANCH" --title "$title" --body-file "$STATUS_FILE" >/dev/null
    else
        write_status "失败（部署或线上核对未通过，未确认发布）" "部署失败，分支 $BRANCH 已保留"
        gh pr edit "$BRANCH" --title "$title（发布失败）" --body-file "$STATUS_FILE" >/dev/null || true
        exit 1
    fi
}

if [ "$CHANGED" != "true" ]; then
    SLOT_SHA=""
    [ "$PARENT" != "$BASE_SHA" ] && SLOT_SHA="$(git rev-parse HEAD)"
    back_to_main
    if [ -n "$SLOT_SHA" ]; then
        write_status "已提交，正在重新发布本档" "部署中"
        TITLE="提示词库增量 $DATE $SLOT"
        PR_URL="$(open_pr "$TITLE")"
        echo "PR: $PR_URL"
        publish_commit "$SLOT_SHA" "$TITLE" "已发布" "重新发布本档已有提交，线上 manifest 已核对"
        exit 0
    fi
    write_status "无变化" "未发布"
    exit 0
fi

if [ "$PARENT" = "$MAIN_SHA" ]; then
    git checkout -q -B "$BRANCH"
    MOVED=1
fi
write_status "已提交，正在发布" "部署中"
git add -- prompt-sources data
git commit -q -m "chore(prompts): 提示词库增量更新 $DATE $SLOT" -m "$(cat "$STATUS_FILE")"
COMMIT="$(git rev-parse HEAD)"
back_to_main
git push -q -u origin "$BRANCH"
TITLE="提示词库增量 $DATE $SLOT"
PR_URL="$(open_pr "$TITLE")"
echo "PR: $PR_URL"
publish_commit "$COMMIT" "$TITLE" "已发布" "已发布，线上 manifest 已核对"

ELAPSED=$(( $(date +%s) - START ))
say "done in $((ELAPSED / 60))m $((ELAPSED % 60))s"
echo "log: $LOG"
