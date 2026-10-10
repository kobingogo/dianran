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
#   待人工    content gate or MAX_NEW_ITEMS; PR kept, not deployed
#   失败      every fetch failed, or the deploy/smoke check failed
#
# Publishing prompts does not rebuild the website. https://dianran.vercel.app
# proxies /prompt-sources/* to the dianran-prompts project.
#
# Intended schedule (not installed by this repo): twice daily, Asia/Taipei.
#   30 6,18 * * * /path/to/dianran/brand/pipeline/run-twicedaily.sh >> /var/log/dianran-prompts.log 2>&1
# Run it on one machine. A lock in brand/pipeline/candidates refuses an overlapping run.
# Re-running the same slot checks out that open branch first, so a deploy retry keeps
# rows already committed there, then updates the same PR.
#
# Usage:  brand/pipeline/run-twicedaily.sh
# Env:    X_WINDOW_DAYS  X search window in days (default 1.5; since: is a UTC date, so the
#                        lookback is about 1.5–2.5 days)
#         MAX_NEW_ITEMS  hold the run (PR, no deploy) above this many kept additions (default 60)
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
PIPELINE_ENV="${PIPELINE_ENV:-$HOME/.config/dianran/pipeline.env}"
if [ -f "$PIPELINE_ENV" ]; then set -a; . "$PIPELINE_ENV"; set +a; fi
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

for bin in node git gh vercel; do command -v "$bin" >/dev/null || die "$bin not found"; done
[ "$(git branch --show-current)" = "main" ] || die "run-twicedaily.sh must run on main"
[ -z "$(git status --porcelain --untracked-files=no)" ] || die "working tree has uncommitted changes; commit or stash first"
git fetch -q origin main
[ "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)" ] || die "local main is behind or ahead of origin/main; sync first"
MAIN_SHA="$(git rev-parse HEAD)"

# Same slot updates the open PR when that branch still contains current main.
# A merged or diverged slot gets a numeric suffix instead of rewriting history.
pick_parent() {
    BRANCH="prompts/auto-$DATE-$SLOT"
    PARENT="$MAIN_SHA"
    local n=2 tip state
    while git fetch -q origin "$BRANCH" 2>/dev/null; do
        tip="$(git rev-parse "origin/$BRANCH")"
        if git merge-base --is-ancestor "$MAIN_SHA" "$tip"; then
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
[ -d brand/node_modules/sharp ] || (cd brand && npm ci --no-audit --no-fund)

mark() { echo "$2" > "$LOG_DIR/fetch-$1.status"; }
say "fetch: X (window ${X_WINDOW_DAYS}d)"
if [ "${SKIP_X:-}" = "1" ]; then echo "skipped"; rm -f "$LOG_DIR/x.json"; mark x skip
else node brand/pipeline/fetch-x.mjs && mark x ok || { echo "X fetch failed — continuing without X candidates"; rm -f "$LOG_DIR/x.json"; mark x fail; }; fi
say "fetch: GitHub upstreams"
rm -rf "$LOG_DIR/github" "$LOG_DIR/github.json"
node brand/pipeline/fetch-github.mjs && mark github ok || { echo "GitHub fetch failed — upstream libraries unchanged"; mark github fail; }
say "fetch: Civitai"
node brand/pipeline/fetch-civitai.mjs && mark civitai ok || { echo "Civitai fetch failed — continuing"; rm -f "$LOG_DIR/civitai.json"; mark civitai fail; }

word() { case "$1" in ok) echo 成功 ;; fail) echo 失败 ;; skip) echo 跳过 ;; unavailable) echo 不可用 ;; *) echo 未跑 ;; esac; }
X_STATUS="$(cat "$LOG_DIR/fetch-x.status")"
GH_STATUS="$(cat "$LOG_DIR/fetch-github.status")"
CV_STATUS="$(cat "$LOG_DIR/fetch-civitai.status")"
FETCH_LINE="X $(word "$X_STATUS")，GitHub $(word "$GH_STATUS")，Civitai $(word "$CV_STATUS")"
if [ "$X_STATUS" != ok ] && [ "$GH_STATUS" != ok ] && [ "$CV_STATUS" != ok ]; then
    printf '抓取：%s\n结果：失败（全部抓取失败，未发布）\n' "$FETCH_LINE"
    exit 1
fi

say "usage counts"
node brand/pipeline/usage-read.mjs || echo "usage read failed — continuing without usage"
USAGE_STATUS="$(node -e 'const s=require(process.argv[1]).status; process.stdout.write(s==="ok"?"ok":s==="unavailable"?"unavailable":"fail")' "$ROOT/brand/pipeline/data/usage.json")"
FETCH_LINE="$FETCH_LINE，用量 $(word "$USAGE_STATUS")"
say "merge (additive only: new candidates in, nothing removed)"
node brand/pipeline/merge.mjs --additive-only
say "点染精选"
node brand/pipeline/picks.mjs
say "finalize (prune covers, manifest counts, snapshot time only when the public library changed)"
node brand/pipeline/finalize.mjs "$DATE"

say "validate IDs, manifest counts and image references"
node --test brand/pipeline/prompt-key.test.mjs
node brand/pipeline/validate.mjs

ADDED="$(node -p "require('$LOG_DIR/merge-report.json').added.length")"
REJECTED="$(node -p "(require('$LOG_DIR/merge-report.json').contentRejected||[]).length")"
CHANGED="$(node -p "require('$LOG_DIR/finalize.json').changed ? 'true' : 'false'")"
VERSION="$(node -p "require('$LOG_DIR/finalize.json').version")"
ADDED_LINE="$(node -e '
const r=require(process.argv[1]);
const parts=Object.entries(r.perLibrary||{}).filter(([,v])=>v.added).map(([k,v])=>k+" +"+v.added);
process.stdout.write(String(r.added.length)+(parts.length?"（"+parts.join("，")+"）":""));
' "$LOG_DIR/merge-report.json")"
CONTENT_LINE="$(node -e '
const rows=require(process.argv[1]).contentRejected||[];
if (!rows.length) { process.stdout.write("无"); process.exit(0); }
const shown=rows.slice(0,20).map((r)=>`${r.library} ${r.title||r.id}（${r.reason}）${r.sourceUrl||""}`).join("\n");
const more=rows.length>20?"\n另有 "+(rows.length-20)+" 条":"";
process.stdout.write("命中 "+rows.length+" 条，未写入库\n"+shown+more);
' "$LOG_DIR/merge-report.json")"
say "new items this run: $ADDED (limit $MAX_NEW_ITEMS); content held: $REJECTED; public changed: $CHANGED"

back_to_main() {
    if [ "$(git branch --show-current)" != "main" ]; then
        git checkout -q -f main
    else
        git reset -q -- web/public/prompt-sources brand/pipeline/data || true
        git checkout -q -- web/public/prompt-sources brand/pipeline/data || true
        git clean -fd -- web/public/prompt-sources >/dev/null || true
    fi
    MOVED=0
}

HOLD=""
[ "$REJECTED" = "0" ] || HOLD="内容命中 ${REJECTED} 条"
if [ "$ADDED" -gt "$MAX_NEW_ITEMS" ]; then
    HOLD="${HOLD:+$HOLD；}新增 ${ADDED} 条，超过 ${MAX_NEW_ITEMS}"
fi

write_status() {
    local result="$1" publish="$2"
    STATUS_FILE="$LOG_DIR/status-$DATE-$SLOT.txt"
    {
        printf '快照：%s\n' "$VERSION"
        printf '新增：%s\n' "$ADDED_LINE"
        printf '抓取：%s\n' "$FETCH_LINE"
        printf '内容：%s\n' "$CONTENT_LINE"
        printf '发布：%s\n' "$publish"
        printf '结果：%s\n' "$result"
    } | tee "$STATUS_FILE"
    if [ -n "${DIANRAN_PIPELINE_RESULT_FILE:-}" ]; then
        node --input-type=module - "$DIANRAN_PIPELINE_RESULT_FILE" "$result" "$VERSION" "$ADDED" "$FETCH_LINE" <<'NODE'
import { writeFileSync, renameSync } from "node:fs";
const [file, result, snapshot, added, sources] = process.argv.slice(2);
const status = result.startsWith("待人工") ? "held" : result.startsWith("无变化") ? "unchanged" : result === "已发布" ? "published" : "failed";
writeFileSync(`${file}.tmp`, JSON.stringify({ status, snapshot, added: Number(added), sources }));
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
    if brand/pipeline/deploy.sh prompts "$sha"; then
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
    [ "$PARENT" != "$MAIN_SHA" ] && SLOT_SHA="$(git rev-parse HEAD)"
    back_to_main
    if [ -n "$HOLD" ]; then
        write_status "待人工（${HOLD}，未发布）" "未发布"
        if [ -n "$SLOT_SHA" ]; then gh pr edit "$BRANCH" --body-file "$STATUS_FILE" >/dev/null || true; fi
        exit 0
    fi
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
if [ -n "$HOLD" ]; then
    write_status "待人工（${HOLD}，未发布）" "未发布"
else
    write_status "已提交，正在发布" "部署中"
fi
git add -- web/public/prompt-sources brand/pipeline/data
git commit -q -m "chore(prompts): 提示词库增量更新 $DATE $SLOT" -m "$(cat "$STATUS_FILE")"
COMMIT="$(git rev-parse HEAD)"
back_to_main
git push -q -u origin "$BRANCH"
TITLE="提示词库增量 $DATE $SLOT"
[ -n "$HOLD" ] && TITLE="$TITLE（待人工）"
PR_URL="$(open_pr "$TITLE")"
echo "PR: $PR_URL"
if [ -n "$HOLD" ]; then
    write_status "待人工（${HOLD}，未发布）" "未发布"
    gh pr edit "$BRANCH" --title "$TITLE" --body-file "$STATUS_FILE" >/dev/null
    exit 0
fi
publish_commit "$COMMIT" "$TITLE" "已发布" "已发布，线上 manifest 已核对"

ELAPSED=$(( $(date +%s) - START ))
say "done in $((ELAPSED / 60))m $((ELAPSED % 60))s"
echo "log: $LOG"
