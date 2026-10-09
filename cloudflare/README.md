# Cloudflare 本地迁移准备

本目录与当前 Vercel 网站、素材发布流水线隔离。包含 Worker Static Assets/R2 只读路由、离线资源发布包工具及本地行为检查；没有上传、凭据读取、云资源创建、DNS 或部署步骤。现有 Vercel 配置、统计服务、定时与内容门禁保持原样。

## 本地验证

```bash
node --test cloudflare/tests/*.test.mjs
```

6 项纯本地检查覆盖确定提交与脏工作区隔离、SHA256/包内容、真实大库JSON、引用缺件与符号链接拒绝、R2 路径/缓存/HEAD/ETag、资源缺件/未配置状态及统计 JSON 停用。测试使用隔离 Git fixture 和内存绑定，不登录、不访问真实 R2。

## 离线准备官方素材

默认只输出 SHA256 资源清单，不创建包、不上传：

```bash
node cloudflare/scripts/prepare-prompts.mjs --ref HEAD
```

确定要准备的提交后，显式指定一个不存在的本地目录才生成发布包：

```bash
node cloudflare/scripts/prepare-prompts.mjs --ref <已审阅提交> --write-dir /tmp/dianran-prompt-release
```

包包含 `release-manifest.json` 和 `snapshots/<提交SHA>/` 下的原始资源。只读取指定 Git 提交的 `web/public/prompt-sources/`，不会混入未提交数据、个人素材、Key 或 Agent 历史。路径只允许顶层 JSON/Markdown 与 covers 内 WebP；Git 符号链接、源库缺件与本地封面缺件均拒绝。输出目录已存在时拒绝覆盖。

这只是离线打包，**不替代既有内容门禁、人工审阅或发布批准**；没有自动调用已有 Vercel 发布命令。上传器、完整远端验证、素材版本切换与回退仍待实现/用户环境验收。

## 准备已有前端产物

本次没有执行构建。用户或 CI 已生成 `web/dist` 后，可以用下面命令复制一份 Cloudflare 专用发布目录：

```bash
node cloudflare/scripts/prepare-site.mjs
```

脚本只复制已有产物到 `cloudflare/site`，排除已外置的 prompt-sources 与 api；目标已存在时拒绝覆盖。它不会修改 `web/dist` 或原 Docker/Vercel 构建流程。尚无产物时应由用户/CI执行项目已有构建。

## 配置与路由

`wrangler.jsonc` 是未绑定真实环境的模板；bucket 与 `PROMPT_SNAPSHOT` 是明确占位值。前端使用 ASSETS 的 SPA 回退；仅 `/prompt-sources`、`/prompt-sources/*`、`/api`、`/api/*` 优先进入 Worker，避免现有静态快照遮住 R2，也避免未知资源/API被 SPA 返回为 200 HTML。[官方路由顺序](https://developers.cloudflare.com/workers/static-assets/routing/worker-script/)、[SPA 回退](https://developers.cloudflare.com/workers/static-assets/routing/single-page-application/)。

- `/prompt-sources/<资源>` 仅 GET/HEAD，读取 `snapshots/<PROMPT_SNAPSHOT>/<资源>`；非法路径400、缺件404、未配置503，均为 JSON。
- 响应缓存头沿用库 JSON 现有60秒与封面一年不可变设置；不把 R2 binding 当作自动边缘缓存。实际 Cache API策略与真实命中验证仍待后续实现/验收。未新增自动重试、超时、并发或文件大小参数。
- `/api/usage` GET 返回 `{ok:true,enabled:false,protocol:2}`；POST 返回503，明确停用统计，不接受或丢弃批次。其他 API 返回 JSON 404。
- 不提供 R2 上传、通用对象读取、AI API 代理、本机 Agent 服务或个人云同步接口。

本地 Wrangler/R2 模拟与真实边缘平台行为仍需独立验证；此轮纯函数测试不证明部署成功。若使用 `getPlatformProxy` 扩展绑定测试，显式关闭远程绑定，隔离持久化目录；模拟与真实环境可能存在差异。[官方本地绑定说明](https://developers.cloudflare.com/workers/wrangler/api/)。

## 待用户环境与后续实现

需要确定账号、R2可用性、正式/预览bucket和授权方式，配置Secrets及实际资源绑定后，才能上传/部署。正式域名需要已激活Cloudflare zone和实际Worker；此模板不包含生产路由或域名。[Custom Domain要求](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/)。

上线前仍需：完整素材版本发布与回退、真实R2/Static Assets验收、预览与生产隔离、费用方案、正式来源授权和旧站浏览器作品转移。当前统计仅明确停用；迁移Vercel Blob批次去重/汇总及历史累计仍是CF05待办。不得将本目录准备工作记为CF01–CF06全部上线完成。
