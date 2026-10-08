<p align="center">
  <img src="web/public/logo-color.svg" width="88" alt="点染 Dianran" />
</p>

<h1 align="center">点染 Dianran</h1>
<p align="center"><b>一点灵感，染成画面。</b><br />本地优先的 AI 创作工作台，让生成、参考与迭代连成一条创作流程。</p>
<p align="center">
  <a href="https://dianran.vercel.app/">在线体验</a> ·
  <a href="#快速开始">快速开始</a> ·
  <a href="docs/content/docs/">使用文档</a> ·
  <a href="CHANGELOG.md">更新日志</a> ·
  <a href="#english">English</a>
</p>

## 从灵感到作品

从首页写下描述、选择模型和参数，进入生图或视频工作台；把结果用作下一轮参考，或送入画布继续编辑、分支和整理。简单任务直接生成，多步骤创作按需连接本地 Agent。

- **统一创作输入**：首页、工作台与画布共用 Composer，支持附件、`@` 引用和模型能力对应的参数。
- **图片与视频工作台**：查看批次结果、保存素材、重试失败任务，让本轮结果成为下一轮输入。
- **可追溯的画布迭代**：用素材、配置与结果节点组织作品；保留原结果及生成快照，支持分组、复制、撤销和 ZIP 导入导出。
- **提示词与素材库**：搜索、筛选提示词，收藏素材并带入创作。
- **按需扩展**：连接自己的 OpenAI 兼容或 Gemini 渠道，使用节点插件、自定义调用脚本与本地 Canvas Agent。

工作流、模板及创作辅助的新能力仍在验收中，具体范围见 [待验收清单](docs/content/docs/progress/pending-test.mdx)；后续安排见 [开发计划](docs/DEVELOPMENT-PLAN.md)。模型能否使用、实际参数与费用以所配置渠道为准。

## 快速开始

需要 **Node.js 22** 和 **Bun**，以及你自己的 AI 渠道与 API Key。

```bash
git clone https://github.com/kobingogo/dianran.git
cd dianran/web
bun install --frozen-lockfile
bun run dev
```

打开 `http://localhost:3000`，在「设置 → 渠道」填写 `Base URL` 和 `API Key`，获取或添加模型并指定用途。然后回到首页，写下描述、选择参数并提交。

浏览器请求被 CORS 拦截时，可在本机启动代理：

```bash
npx @kobinflow/canvas-proxy@latest
```

在「设置 → 本地代理」启用 `http://127.0.0.1:23210`。更多说明见 [Canvas Proxy](canvas-proxy/README.md)。需要 Codex / Claude Code 协作时，按 [Canvas Agent](canvas-agent/README.md) 连接本地服务；直接生图和视频不依赖 Agent。

## 自部署与开发

- **静态构建**：在 `web/` 运行 `bun run build`，产物位于 `web/dist`；托管时配置单页应用路由回退。
- **Vercel**：导入仓库，沿用根目录 [vercel.json](vercel.json)。它同时安装前端与可选提示词统计 API 的依赖。
- **Docker**：在根目录运行 `docker compose -f docker-compose.local.yml up -d --build`，默认端口 `3000`；生产静态资源路径仍需部署验收。
- **检查**：在 `web/` 运行 `bun run typecheck`、`bun test`；完整 CI 与浏览器复现步骤见 [验收记录](docs/WORKFLOW-RELIABILITY-VALIDATION.md)。

## 数据与隐私

画布、素材与生成记录主要保存在浏览器本地。API Key 也保存在浏览器，生成请求直达你配置的渠道；开启本地代理或 Agent 后，请求按相应服务的路径处理。可选 WebDAV 用于同步，项目没有内置云账户或云作品库。

部署方可配置匿名提示词使用统计与站点分析；提示词统计只发送提示词 ID、次数和日期，不发送创作提示词、素材或 Key。具体实现与配置见 [提示词流水线](brand/pipeline/README.md)。

## 开源与致谢

点染由 **KobinFlow** 维护，基于 [infinite-canvas](https://github.com/basketikun/infinite-canvas) 发展，感谢原作者与开源贡献者。采用 [MIT License](LICENSE)，保留原始版权与许可声明，来源说明见 [NOTICE](NOTICE)。

<a id="english"></a>

## English

**Dianran (点染)** is a local-first AI creative workbench maintained by KobinFlow. Start with an idea, generate images or videos with your own provider, reuse results as references, and continue iterating on a canvas. Connect a local Canvas Agent when you need assisted workflows.

Run `bun install --frozen-lockfile` and `bun run dev` inside `web/`, then open `http://localhost:3000`. Configure your provider's Base URL, API key and models in Settings. Canvases, assets and generation history are primarily stored in your browser; generation requests go to your configured provider. Optional local services, WebDAV and deployment analytics follow their own data paths.

New workflow and creation-assistance features are undergoing validation. See the [pending tests](docs/content/docs/progress/pending-test.mdx). Licensed under [MIT](LICENSE), based on [infinite-canvas](https://github.com/basketikun/infinite-canvas); original copyright notices are retained.
