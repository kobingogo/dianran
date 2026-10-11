# 提示词代码与资源仓库

点染仓库保留 `brand/pipeline/` 采集、评分、发布脚本及 `.github/workflows/prompt-pipeline.yml`；[dianran-prompts](https://github.com/kobingogo/dianran-prompts) 保存 `prompt-sources/`、`data/`、`reports/`。临时 `candidates/` 不提交。主仓库不再携带生成快照，旧版本资源仍可从 Git 历史恢复。

前端继续使用同源 `/prompt-sources/*`；Vite、Vercel 和 Docker Nginx 配置转发至资源站点。Docker 尚未进行本轮实际部署验证。Cloudflare 离线准备工具读取独立资源目录，不代表已完成云端迁移。

`DIANRAN_PROMPT_PIPELINE_ROOT` 必须指向干净、独立的资源 Git 根目录。采集不会清理点染开发工作区。早晚运行基于 `codex/prompt-published` 已发布提交，以增量方式保留已有条目；有可见变化才部署，线上 manifest 时间及一张 WebP 封面核对成功后才快进更新发布基线。资源 main 与发布基线分叉、线上版本不一致时停止，不 force-push。每周删除与容量清理只生成待审 PR。

`PROMPT_BASELINE_COMMIT` 为首次建立发布分支的锚点 `be9af54d6c1b176452fa989922d0cb8c6af0c2b7`。真实验收后的线上 `generatedAt` 为 `2026-10-11T16:07:59.832Z`，对应资源提交及发布分支 `4e0f411b8fe29d28b646e22be86e29829cf375d9`；不能用旧周更整包替换后续已发布补采。

云端使用台北 06:30／18:30 的 GitHub schedule 及手动执行，PR #4 合并后生效。首次真实运行验证 X Cookie、三源采集与资源仓库推送／PR 权限，新增 237 条；Vercel 项目级 Token 在额外账号读取处失败，修复分支改为校验项目后按项目／团队 ID 部署，已通过 [真实云端发布](https://github.com/kobingogo/dianran/actions/runs/38155319193) 及站点 manifest、封面字节比对。修复 PR #6 尚待合并，之后仍需观察定时任务。凭据不保存进资源、日志或 Artifact，账户库位于 runner 临时目录。

用户已确认取消内容词、NSFW／真人相关过滤、每轮 60 条新增门槛及 Civitai 严格排序拒收；原时间、互动、有效提示词、媒体、封面和去重条件保留，每周容量规则保留。详情与操作入口见 [流水线说明](../brand/pipeline/README.md)。
