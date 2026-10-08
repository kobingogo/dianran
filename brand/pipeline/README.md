# 提示词库周更流水线 / Prompt-library pipeline

Weekly, fully scripted maintenance of the bundled prompt libraries in `web/public/prompt-sources/`.
**No model test runs**: ranking uses popularity, freshness and anonymous on-site usage only. Nothing is published
without a human merging the generated PR.

```bash
BASE_BRANCH=prompt-pipeline brand/pipeline/run-weekly.sh   # until this branch is merged; afterwards just run-weekly.sh
```

| Step | Script | Output |
| --- | --- | --- |
| X fetch (keywords + tiered author watchlist via `twscrape-x`; S/A/B tiers in `config/x-watchlist.json`) | `fetch-x.mjs` | `candidates/x.json` |
| GitHub upstream re-sync (yukkcat/image-prompts registry) | `fetch-github.mjs` | `candidates/github/*.json` |
| Civitai fetch (images, Most Reactions / Week, `nsfw=None`, `withMeta=true`) | `fetch-civitai.mjs` | `candidates/civitai.json` |
| Usage counts (Vercel Blob, see below) | `usage-read.mjs` | `data/usage.json` |
| Merge + metadata + checks + scoring + retire + caps | `merge.mjs` | libraries, `data/scores.json`, `data/retired.json` |
| 点染精选 rebuild | `picks.mjs` | `dianran-picks.json`, `data/picks-archive.json` |
| Prune covers, manifest counts, snapshot time | `finalize.mjs` | `manifest.json` `generatedAt` |
| Chinese changelog / PR body | `changelog.mjs` | `reports/YYYY-MM-DD.md/.json` |

`candidates/` is git-ignored scratch; `data/` and `reports/` are committed.

## 运行节奏 / Cadence

两档节奏，分工不同：

| | 早晚快速更新 `run-twicedaily.sh` | 每周全量维护 `run-weekly.sh` |
|---|---|---|
| 频率 | 每天早晚各一次（cron `30 6,18 * * *`，Asia/Taipei） | 每周一次 |
| X 抓取窗口 | `X_WINDOW_DAYS=1.5`（只看最近 36 小时，和上一轮重叠防漏） | `windowDays=8` |
| merge 模式 | `--additive-only`：只新增候选，不删除任何条目 | 全量：上游移除、下架、限量都执行 |
| 发布方式 | 推分支并开 PR，同时 `deploy.sh prompts` 更新线上快照。不重编网站，不推 main | 只开 PR。合并后手动 `deploy.sh prompts` |
| 熔断 | 单轮新增超过 `MAX_NEW_ITEMS`（默认 60 条）则不提交，留待人工检查 | — |

快速通道的破坏性操作为零。它发布的是静态项目 `dianran-prompts`；网站 `dianran.vercel.app` 把 `/prompt-sources/*` 反代过去，浏览器仍用站内路径。`dianran-next` 不再部署。每周 PR 仍是下架与限量的人工闸门，合并后才执行 `brand/pipeline/deploy.sh prompts`。网站本身用 `brand/pipeline/deploy.sh app` 部署到项目 `dianran`。

## Unified metadata (every record)

`source` (x / github / civitai / dianran), `sourceUrl`, `author`, `postedAt`, `fetchedAt`,
`engagement {likes, bookmarks, reposts}` (null when unknown; Civitai `likes` = all reactions), `authorFollowers`,
`model` (normalised family, e.g. "GPT Image"), `status`. Old fields are untouched, so older app builds keep working.
Pick copies add `pickOf`, `pickLibrary`, `pickedAt`, `pickScore`.

## Filters

X: original posts only, image or video required, prompt text in the post or the author's own reply, a detectable
model, no NSFW / real-person likeness / face-swap (`lib/common.mjs`), no promo/tool-list posts, deduped by prompt.
Civitai: `nsfwLevel None` + `browsingLevel 1`, prompt ≥ 40 chars, ≥ 150 reactions, same content filters.

## Scoring (`config/pipeline.json`)

```
eng   = likes + 2·bookmarks + 3·reposts      (missing bookmarks/reposts imputed from likes: ×0.8 / ×0.12)
score = 0.6·log10(1+eng) + 0.8·log10(1 + 100·eng / max(1000, followers))   (× source multiplier; unknown followers = 20k)
      + 2.0 · 0.5^(age_days / 45)                                            freshness
      + 1.5 · log10(1 + copies_30d + 2·uses_30d)                            on-site usage
```
Records without any engagement data get a per-library prior instead of the engagement term.

## Retirement

* cover file missing / remote cover gone (new records without a downloadable cover are never added)
* source post deleted (X syndication endpoint returns 404 / tombstone) or record removed upstream (GitHub)
* model listed in `config/deprecated-models.json`
* content filter hit (X / Civitai records)
* older than 6 months **and** no on-site usage — only enforced once usage tracking has ≥ 28 days of data
  (until then the report shows how many would be retired)
* caps: X 热门 150, Civitai 热门 120 (lowest scores retired)

Retired ids are kept in `data/retired.json` and never re-added automatically.

## 点染精选

Top scores across all libraries, cap 30, ≤ 8 per model, cover required, deduped by prompt. A current pick stays while
it ranks within the top 45 (hysteresis). `picks.pinned` in `config/pipeline.json` pins ids; dropped hand-made picks
are archived in `data/picks-archive.json`.

## Anonymous usage stats

`web/src/services/usage-stats.ts` counts prompt copy / use (insert into canvas, pick in the prompt picker, save as
asset) per built-in prompt id in localStorage and flushes the batch to `POST /api/usage` about once a day
(sendBeacon, no cookies, disabled for Do-Not-Track and dev builds). `api/usage.js` runs on the `dianran` project and
stores one private blob per batch in the Vercel Blob store (Hobby free tier). No IP, user agent or identifier is
stored. `usage-read.mjs` folds the batches into `usage-agg/totals.json`, deletes the processed raw blobs and writes
`data/usage.json`. It needs `BLOB_READ_WRITE_TOKEN` in `~/.config/dianran/dianran-next.env` (`vercel env pull`). The
same token must be set on the `dianran` project, because that is where `/api/usage` runs. Without it, scoring falls
back to engagement + freshness.

## Requirements

node ≥ 20, `gh` and `vercel` logged in, `twscrape-x` with a logged-in account. `deploy.sh` links a temporary
directory and refuses any project other than `dianran` (app) or `dianran-prompts` (snapshot). Optional
`~/.config/dianran/pipeline.env` with `CIVITAI_API_TOKEN` (Civitai ToS §11.4 asks automated API users to use their
own credentials).
