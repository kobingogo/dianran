# 提示词库周更流水线 / Prompt-library pipeline

采集脚本保留在点染主仓库，资源位于独立的 [kobingogo/dianran-prompts](https://github.com/kobingogo/dianran-prompts) 仓库。本机示例路径：`/Users/bingo/workspace/dianran-prompts`。目录职责与搬迁细节见 [技术方案](../../docs/PROMPT-RESOURCE-REPOSITORY.md)。

Weekly, fully scripted maintenance of `prompt-sources/` in the independent resource repository.
**No model test runs**: ranking uses popularity, freshness and anonymous on-site usage only. The weekly run
opens a PR and does not deploy; after it merges, publish with `brand/pipeline/deploy.sh prompts`. The
twice-daily run publishes qualified changes automatically; there is no per-run addition gate or cumulative publication cap.

```bash
export DIANRAN_PROMPT_PIPELINE_ROOT=/绝对路径/dianran-prompts
# 以下命令在点染主仓库运行，Git 提交与 PR 进入资源仓库。
brand/pipeline/run-twicedaily.sh          # morning/evening; publishes when the snapshot changed
brand/pipeline/run-weekly.sh              # weekly PR only
brand/pipeline/deploy.sh prompts          # after the weekly PR merges
```

| Step | Script | Output |
| --- | --- | --- |
| X fetch (twscrape-x: 9 keyword groups; RedFox is explicit opt-in) | `fetch-x.mjs` | `candidates/x.json` |
| GitHub upstream re-sync (yukkcat/image-prompts registry) | `fetch-github.mjs` | `candidates/github/*.json` |
| Civitai fetch (images, Most Reactions / Week, `withMeta=true`) | `fetch-civitai.mjs` | `candidates/civitai.json` |
| Usage counts (Vercel Blob, see below) | `usage-read.mjs` | `data/usage.json` |
| Merge + metadata + integrity checks + scoring + weekly retire/caps | `merge.mjs` | libraries, `data/scores.json`, `data/retired.json` |
| 点染精选 rebuild | `picks.mjs` | `dianran-picks.json`, `data/picks-archive.json` |
| Prune covers, manifest counts, snapshot time | `finalize.mjs` | `manifest.json` `generatedAt` |
| Chinese changelog / PR body | `changelog.mjs` | `reports/YYYY-MM-DD.md/.json` |

资源仓库包含 `prompt-sources/`、`data/` 和 `reports/`；`candidates/` 是忽略的临时目录。Vercel 只发布 `prompt-sources/`。依赖安装在点染主仓库 `brand/`，脚本与配置不复制到资源仓库。

## 网页手动采集并发布

设置中的内置来源「采集并发布」通过带 Token 的本地 Agent 启动固定的 `run-twicedaily.sh`，统一采集全部内置库，再发布共享提示词快照。每行按钮触发的是同一条完整流水线，不是只采集该行；来源开关只控制当前浏览器的展示与缓存。自定义 JSON 来源仍由浏览器直接读取。自动刷新只下载已发布数据，不触发采集发布。

维护者须更新**点染主仓库脚本**，另行克隆**独立提示词资源仓库**并保持资源仓库 `main` 与远端同步，具备 GitHub、Vercel、X 等登录环境。启动 Agent 时设置 `DIANRAN_PROMPT_PIPELINE_ROOT` 指向资源仓库根目录；网页配置该 Agent 的地址与 Token。源码 Agent 自动定位主仓库脚本；已安装的 Agent 包须额外设置 `DIANRAN_PROMPT_PIPELINE_CODE_ROOT` 指向包含本轮脚本的点染主仓库。资源仓库缺少清单、不是独立 Git 根目录或存在未提交/未跟踪文件时拒绝启动。主仓库的开发改动不会被采集清理。此功能依赖本机维护者环境，不是公共采集 API。

例如，在开发仓库运行本轮 Agent 源码（前端也须更新到本轮版本）：

```bash
cd canvas-agent
DIANRAN_PROMPT_PIPELINE_ROOT=/Users/bingo/workspace/dianran-prompts npm run dev
```

网页显示采集进度、资源 PR、云端运行链接和各源抓取结果，区分已发布、无变化、失败和结果未知。满足规则的候选直接入库，不设置跨轮累计发布上限；`DIANRAN_PIPELINE_RESULT_FILE` 仅供 Agent 传入固定回执位置，脚本以 JSON 返回最终结果；只有回执完整且当前站点的 `manifest.generatedAt` 一致才刷新缓存并报告完成。无变化不发布。

提交前浏览器持久保存任务身份，Agent 按同一身份复用回执；断线后再次点击只恢复原任务。Agent 重启后，未完成回执标记为结果未知，需人工核对流水线日志和线上状态，不自动重新采集或发布。任务记录保存在 `~/.dianran/prompt-pipeline-jobs/`，不向网页暴露登录凭据或原始脚本日志。

## 首次初始化

已创建的资源仓库直接 `git clone https://github.com/kobingogo/dianran-prompts.git` 即可。`init-resources.mjs` 只供首次搬迁准备：目标目录必须不存在，复制后保留原文件，不自动提交、推送或删除。主仓库移走资源不会清除旧 Git 历史。

Vite 开发服务、两份 Vercel 配置及 Docker Nginx 均使用 `/prompt-sources/*` 代理到资源静态站点；其他托管平台需配置相同代理，不再依赖主仓库内置快照。

## 运行节奏 / Cadence

两档节奏，分工不同：

| | 早晚快速更新 `run-twicedaily.sh` | 每周全量维护 `run-weekly.sh` |
|---|---|---|
| 频率 | 每天早晚各一次（cron `30 6,18 * * *`，Asia/Taipei） | 每周一次 |
| X 抓取窗口 | `X_WINDOW_DAYS=1.5`（`since:` 按 UTC 日期截断，实际大约 1.5–2.5 天） | `windowDays=8` |
| merge 模式 | `--additive-only`：新增候选与筛选上游更新，不删除已有条目 | 全量：上游移除、下架、限量都执行 |
| 发布方式 | 资源或统计记录变化时提交资源 PR；有可见变化才 `deploy.sh prompts <提交>`。同一档重跑更新同一个未合并 PR | 只开 PR。合并后手动 `deploy.sh prompts` |
| 不发布 | 条目、精选名单和封面都没变；三个抓取源都失败 | 满足采集规则的条目自动入库并发布 |

一次早晚运行只落在一种结果上：`无变化`、`已发布`或`失败`。日志最后一行是这句结果，PR 正文同一段。`generatedAt` 只有在条目、精选名单或封面变化时才前进，浏览器才重新拉库。

`deploy.sh prompts` 发布的是某次提交，不是工作区里没提交的文件。上传后最多等 2 分钟、每 5 秒看一次 https://dianran.vercel.app/prompt-sources/manifest.json ，时间一致且一张封面返回 `image/webp` 才算发布成功。超时视为这次失败，分支保留。

增量模式保留已有条目，Git 分支和 PR 都在资源仓库；PR 尚未合并时也可发布该分支提交。它发布的是静态项目 `dianran-prompts`；网站 `dianran.vercel.app` 把 `/prompt-sources/*` 反代过去，浏览器仍用站内路径。`dianran-next` 不再部署。每周 PR 仍是下架与限量的人工闸门，合并后才执行 `brand/pipeline/deploy.sh prompts`。网站本身用 `brand/pipeline/deploy.sh app` 部署到项目 `dianran`。本机脚本不安装 cron；云端由下述 GitHub Actions 定时运行，工作流合入默认分支后才会生效。

## Unified metadata (every record)

`source` (x / github / civitai / dianran), `sourceUrl`, `author`, `postedAt`, `fetchedAt`,
`engagement {likes, bookmarks, reposts}` (null when unknown; Civitai `likes` = all reactions), `authorFollowers`,
`model` (normalised family, e.g. "GPT Image"), `status`. Old fields are untouched, so older app builds keep working.
Pick copies add `pickOf`, `pickLibrary`, `pickedAt`, `pickScore`.

## Filters

X: original posts only, image or video required, prompt text in the post or the author's own reply, a detectable model, and prompt deduplication. Existing time/engagement/length and visual-prompt quality checks remain. There is no sensitive-word, author-blacklist, real-person or face-swap filter.
Civitai: images with prompt ≥ 40 chars and ≥ 150 reactions; no local safety-level rejection or NSFW query restriction. API visibility still depends on the service and account.
GitHub upstream: sync prompt records and download covers without content-word filtering.
No candidate quarantine, review queue, approval endpoint or deployment content gate is used. View counts have no configured admission threshold.

## Scoring (`config/pipeline.json`)

```
eng   = likes + 2·bookmarks + 3·reposts      (only X posts impute missing bookmarks/reposts from likes: ×0.8 / ×0.12)
score = 0.6·log10(1+eng) + 0.8·log10(1 + 100·eng / max(1000, followers))   (× source multiplier; unknown followers = 20k)
      + 2.0 · 0.5^(age_days / 45)                                            freshness
      + 1.5 · log10(1 + copies_30d + 2·uses_30d)                            on-site usage
```
Records without any engagement data get a per-library prior instead of the engagement term.

## Retirement

* cover file missing / remote cover gone (new records without a downloadable cover are never added)
* source post deleted (X syndication endpoint returns 404 / tombstone) or record removed upstream (GitHub)
* model listed in `config/deprecated-models.json`
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

node ≥ 20, Python ≥ 3.10, `gh` and `vercel` authenticated, and an authorized twscrape X account pool configured. `deploy.sh` links a temporary
directory and refuses any project other than `dianran` (app) or `dianran-prompts` (snapshot). Optional
`~/.config/dianran/pipeline.env` with `CIVITAI_API_TOKEN` (Civitai ToS §11.4 asks automated API users to use their
own credentials).

## twscrape-x 与云端维护

默认 `X_PROVIDER=twscrape`，调用仓库内 `twscrape-x` 入口（底层 twscrape 0.20.1），不依赖 Codex 或模型推理。保留 9 组完整搜索表达式、每组最多 40 条及各组原有点赞门槛；日常脚本回看 1.5 天，直接采集默认 8 天，since 按 UTC 日期截断。39 位作者仅参与评分，`collectAuthors=false` 禁止额外作者搜索。正文不足时最多 12 次作者回复补查，每次最多 20 条；搜索/回复沿用 20/5 分钟超时。账号暂时限流时在现有超时内等待恢复；无有效登录账户时立即失败。日常回执显示 X「部分失败」并保留已取得的合格候选，不将部分查询失败误报为全部成功。

本机初始化：

```bash
python3 -m venv ~/.local/share/dianran/twscrape
~/.local/share/dianran/twscrape/bin/pip install -r brand/pipeline/requirements-x.txt
# 在私有配置目录运行，交互输入含 auth_token 和 ct0 的 Cookie；不要写入仓库。
mkdir -p ~/.config/dianran/twscrape
(cd ~/.config/dianran/twscrape && ~/.local/share/dianran/twscrape/bin/twscrape add_cookie maintainer)
chmod 600 ~/.config/dianran/twscrape/accounts.db
```

可用 `TWSCRAPE_DB` / `TWSCRAPE_PYTHON` 指定私有账户库和 Python；云端通过 `TWITTER_COOKIES` Secret 注入 Cookie，账户库留在 runner 临时目录。该登录态不保存进候选、Git、日志或 Actions Artifact。本机已复用现有浏览器登录态初始化私有账户库，无需每次读取浏览器。

```bash
DIANRAN_PROMPT_PIPELINE_ROOT=/绝对路径/dianran-prompts bash -c 'source brand/pipeline/environment.sh; node brand/pipeline/fetch-x.mjs'
```

RedFox 保留显式备选 `X_PROVIDER=redfox` 和 `REDFOX_API_KEY`；其回复、分页与搜索操作符未完成真实验收。`--replay-search` 专用于已保存 RedFox 样本，`--verify-search` 只跑当前提供方第一组查询，不合并或发布。

Civitai 继续使用公共 REST API 的 Most Reactions / Week、4 页 × 100 条。接受结构有效的页面，逐条按图片类型、提示词至少 40 字符和互动至少 150 次筛选，在本地按互动排序；不再因服务端非严格降序而拒收有效页面。HTTP/结构错误沿用原有重试次数，无有效页面时报告失败。

工作流位于**点染代码仓库** `.github/workflows/prompt-pipeline.yml`，随采集脚本维护，使用 GitHub 托管 Ubuntu 机器。UTC `30 10,22 * * *` 对应台北每天 06:30、18:30；定时可能延迟。工作流支持 GitHub 手动执行和页面经本地 Agent 触发。仅 schedule/workflow_dispatch 执行，不运行 PR 中的采集代码。共享 concurrency group 不取消正在执行的任务；GitHub 替换或取消排队任务时，页面将显示失败及运行链接。

部署前配置点染仓库 Actions Secrets：

- `TWITTER_COOKIES`：含 `auth_token`、`ct0` 的 X Cookie，仅供维护者采集；失效后需更新。
- `PROMPT_RESOURCE_TOKEN`：仅限资源仓库的 Contents、Pull requests 写权限，用于推送与 PR；点染代码使用 Actions 自带只读 Token。
- `PROMPT_VERCEL_TOKEN`：资源项目部署凭据。
- 可选 `CIVITAI_API_TOKEN`、`BLOB_READ_WRITE_TOKEN`。

首次设置 Actions Variable `PROMPT_BASELINE_COMMIT` 为已核验的线上资源提交；本轮核验的已发布提交为 `be9af54d6c1b176452fa989922d0cb8c6af0c2b7`。脚本先核对线上 manifest，再建立资源仓库 `codex/prompt-published` 基线分支。以后只在资源发布核对通过时，以普通快进推送更新基线；不合并 main、不 force-push。main 与基线分叉或线上版本不一致时拒绝继续。跨天仍从该基线采集，不丢失已发布的条目；新条目不再受累计数量上限限制。

页面云端模式：维护者 Agent 设置 `DIANRAN_PROMPT_PIPELINE_GITHUB_REPO=kobingogo/dianran`，并确保 `gh` 对该仓库有 Actions 读写权限。不再要求本机资源目录。先保存 UUID 再提交 workflow_dispatch，以运行标题关联身份；请求不确定、断线、Agent 重启都只查询原任务，不重复 dispatch。最终从 Actions 的 `prompt-pipeline-result` Artifact 读取回执，网页仍需核对自己的资源快照。Artifacts 使用 GitHub 默认保留周期；记录过期或缺失时不会重新采集，显示失败/未知供人工核对。

## 首版入库与发布

满足现有时间、互动数、有效提示词、媒体及去重条件的候选直接进入入库流程，不按敏感词、短裙、泳装、真人/换脸或作者黑名单剔除；不生成待审清单。封面下载失败、重复、提示词无效等仍不会入库。Civitai 不设置每轮新增 60 条门槛；早晚发布也不设置跨轮累计新增上限。每周维护仍保留原有库容量与下架规则，只开 PR 供审阅。历史待审清单仅为旧验证记录，不会自动转换成新候选；需按新规则重新采集完整条目后入库。
