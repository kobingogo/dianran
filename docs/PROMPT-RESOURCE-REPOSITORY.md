# 提示词代码与资源仓库

点染仓库保留 `brand/pipeline/` 采集、评分、发布脚本及 `.github/workflows/prompt-pipeline.yml`；[dianran-prompts](https://github.com/kobingogo/dianran-prompts) 保存 `prompt-sources/`、`data/`、`reports/`。临时 `candidates/` 不提交。主仓库不再携带生成快照，旧版本资源仍可从 Git 历史恢复。

前端继续使用同源 `/prompt-sources/*`；Vite、Vercel 和 Docker Nginx 配置转发至资源站点。Docker 尚未进行本轮实际部署验证。Cloudflare 离线准备工具读取独立资源目录，不代表已完成云端迁移。

`DIANRAN_PROMPT_PIPELINE_ROOT` 必须指向干净、独立的资源 Git 根目录。采集不会清理点染开发工作区。早晚运行基于 `codex/prompt-published` 已发布提交，以增量方式保留已有条目；有可见变化才部署，线上 manifest 时间及一张 WebP 封面核对成功后才快进更新发布基线。资源 main 与发布基线分叉、线上版本不一致时停止，不 force-push。每周删除与容量清理只生成待审 PR。

本轮核验线上 `generatedAt` 为 `2026-10-10T04:54:01.243Z`，对应资源提交 `be9af54d6c1b176452fa989922d0cb8c6af0c2b7`。`PROMPT_BASELINE_COMMIT` 为首次建立发布分支的锚点，不能用旧周更整包替换后续已发布补采。

云端使用台北 06:30／18:30 的 GitHub schedule 及手动执行，合入默认分支后生效。已检查 Secrets 名称 `PROMPT_RESOURCE_TOKEN`、`PROMPT_VERCEL_TOKEN`、`TWITTER_COOKIES` 存在；本机资源 Token 可读取资源仓库，Vercel Token 可读取资源项目，本机 X 账户库存在有效 Cookie 字段。上述检查不证明云端 Cookie 仍有效、推送／部署权限可用；须由真实 Actions 执行验证。凭据不保存进资源、日志或 Artifact，账户库位于 runner 临时目录。

用户已确认取消内容词、NSFW／真人相关过滤、每轮 60 条新增门槛及 Civitai 严格排序拒收；原时间、互动、有效提示词、媒体、封面和去重条件保留，每周容量规则保留。详情与操作入口见 [流水线说明](../brand/pipeline/README.md)。
