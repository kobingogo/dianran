# 提示词库周更流水线 / Prompt-library pipeline

Weekly, fully scripted maintenance of the bundled prompt libraries in `web/public/prompt-sources/`.
**No model test runs**: ranking uses popularity, freshness and anonymous on-site usage only. The weekly run
opens a PR and does not deploy; after it merges, publish with `brand/pipeline/deploy.sh prompts`. The
twice-daily run publishes on its own when the snapshot actually changed and the content gate is clear.

```bash
brand/pipeline/run-twicedaily.sh          # morning/evening; publishes when the snapshot changed
brand/pipeline/run-weekly.sh              # weekly PR only
brand/pipeline/deploy.sh prompts          # after the weekly PR merges
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

## 网页手动采集并发布

设置中的内置来源「采集并发布」通过带 Token 的本地 Agent 启动固定的 `run-twicedaily.sh`，统一采集全部内置库，再发布共享提示词快照。每行按钮触发的是同一条完整流水线，不是只采集该行；来源开关只控制当前浏览器的展示与缓存。自定义 JSON 来源仍由浏览器直接读取。自动刷新只下载已发布数据，不触发采集发布。

维护者须在**独立且干净的仓库**中更新本轮脚本，保持 `main` 与远端同步，并具备上文列出的 GitHub、Vercel、X 等登录环境。启动本轮 Agent 时设置 `DIANRAN_PROMPT_PIPELINE_ROOT=/绝对路径/独立采集仓库`；网页配置该 Agent 的地址与 Token。未配置、脚本版本不支持回执或存在未提交/未跟踪文件时拒绝启动，不清理开发目录。此功能依赖本机维护者环境，不是任意访问者可调用的公共采集 API。

例如，在开发仓库运行本轮 Agent 源码（前端也须更新到本轮版本）：

```bash
cd canvas-agent
DIANRAN_PROMPT_PIPELINE_ROOT=/绝对路径/独立采集仓库 npm run dev
```

网页显示采集进度和各源抓取结果，区分已发布、无变化、待人工、失败和结果未知。现有内容关、新增阈值、采集与部署超时均沿用原脚本。`DIANRAN_PIPELINE_RESULT_FILE` 仅供 Agent 传入固定回执位置，脚本以 JSON 返回最终结果；只有回执完整且当前站点的 `manifest.generatedAt` 一致才刷新缓存并报告完成。无变化不发布；待人工不报告成功。

提交前浏览器持久保存任务身份，Agent 按同一身份复用回执；断线后再次点击只恢复原任务。Agent 重启后，未完成回执标记为结果未知，需人工核对流水线日志和线上状态，不自动重新采集或发布。任务记录保存在 `~/.dianran/prompt-pipeline-jobs/`，不向网页暴露登录凭据或原始脚本日志。

## 运行节奏 / Cadence

两档节奏，分工不同：

| | 早晚快速更新 `run-twicedaily.sh` | 每周全量维护 `run-weekly.sh` |
|---|---|---|
| 频率 | 每天早晚各一次（cron `30 6,18 * * *`，Asia/Taipei） | 每周一次 |
| X 抓取窗口 | `X_WINDOW_DAYS=1.5`（`since:` 按 UTC 日期截断，实际大约 1.5–2.5 天） | `windowDays=8` |
| merge 模式 | `--additive-only`：只新增候选，不删除任何条目 | 全量：上游移除、下架、限量都执行 |
| 发布方式 | 有可见变化才提交并 `deploy.sh prompts <提交>`。同一档重跑更新同一个未合并 PR | 只开 PR。合并后手动 `deploy.sh prompts` |
| 不发布 | 条目、精选名单和封面都没变；新条目被内容关命中；新增超过 `MAX_NEW_ITEMS`（默认 60）；三个抓取源都失败 | 内容关命中的新条目不写入库 |

一次早晚运行只落在一种结果上：`无变化`、`已发布`、`待人工`、`失败`。日志最后一行是这句结果，PR 正文同一段。`generatedAt` 只有在条目、精选名单或封面变化时才前进，浏览器才重新拉库。

`deploy.sh prompts` 发布的是某次提交，不是工作区里没提交的文件。上传后最多等 2 分钟、每 5 秒看一次 https://dianran.vercel.app/prompt-sources/manifest.json ，时间一致且一张封面返回 `image/webp` 才算发布成功。超时视为这次失败，分支保留。

快速通道的破坏性操作为零。它发布的是静态项目 `dianran-prompts`；网站 `dianran.vercel.app` 把 `/prompt-sources/*` 反代过去，浏览器仍用站内路径。`dianran-next` 不再部署。每周 PR 仍是下架与限量的人工闸门，合并后才执行 `brand/pipeline/deploy.sh prompts`。网站本身用 `brand/pipeline/deploy.sh app` 部署到项目 `dianran`。仓库不安装 cron；要无人值守时，在一台已登录的机器上挂上面的 crontab。

## Unified metadata (every record)

`source` (x / github / civitai / dianran), `sourceUrl`, `author`, `postedAt`, `fetchedAt`,
`engagement {likes, bookmarks, reposts}` (null when unknown; Civitai `likes` = all reactions), `authorFollowers`,
`model` (normalised family, e.g. "GPT Image"), `status`. Old fields are untouched, so older app builds keep working.
Pick copies add `pickOf`, `pickLibrary`, `pickedAt`, `pickScore`.

## Filters

X: original posts only, image or video required, prompt text in the post or the author's own reply, a detectable
model, no NSFW / real-person likeness / face-swap (`lib/common.mjs`), no promo/tool-list posts, deduped by prompt.
Civitai: `nsfwLevel None` + `browsingLevel 1`, prompt ≥ 40 chars, ≥ 150 reactions, same content filters.
GitHub upstream adds used to skip only an `nsfw` tag. Every new row, from any source, now passes `contentReject` before it is written; a hit is left out of the library and listed on the run.

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

`web/src/services/usage-stats.ts` keeps built-in prompt copy / use counters in localforage and flushes via
`POST /api/usage` at the existing 20-hour / 40-event thresholds. It sends no cookies and stays disabled for DNT
and development builds. A stable random batch identity is persisted before sending; only a matching successful
receipt removes that batch. Failed or uncertain sends retain the same identity, while new interactions stay
separate. No sendBeacon queue result is treated as an acknowledgement.

API protocol 2 reports its availability. Missing, disabled or older APIs stop reporting for that session instead
of fabricating success. The frontend and `api/usage.js` must be deployed together. The API writes each identity
once into a private Blob; conflicting payloads are refused. `usage-read.mjs` stores processed identities alongside
`usage-agg/totals.json` before deleting raw batches, preventing duplicate counts if deletion fails or an uncertain
client retries later. Batch identity records are not silently trimmed. Existing rate/count/batch limits remain.

Only built-in prompt IDs, copy/use counts, UTC day and batch identity are stored. No creation prompts, files,
API Keys, IPs, user agents or user identifiers are uploaded. These incomplete interaction counts do not represent
generation success, artwork quality or user counts. Ranking remains popularity + freshness + these interactions.
The aggregation needs `BLOB_READ_WRITE_TOKEN` in `~/.config/dianran/dianran-next.env` (`vercel env pull`); the same
token must be configured for the `dianran` project. Without it, scoring falls back to engagement + freshness.

## Requirements

node ≥ 20, `gh` and `vercel` logged in, `twscrape-x` with a logged-in account. `deploy.sh` links a temporary
directory and refuses any project other than `dianran` (app) or `dianran-prompts` (snapshot). Optional
`~/.config/dianran/pipeline.env` with `CIVITAI_API_TOKEN` (Civitai ToS §11.4 asks automated API users to use their
own credentials).
