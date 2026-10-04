<p align="center">
  <img src="web/public/logo-color.svg" width="96" alt="点染 Dianran" />
</p>

<h1 align="center">点染 Dianran</h1>

<p align="center"><b>一点灵感，染成画面。</b><br/>节点式 AI 创作画布：生图、视频、文本在一张画布上连续推演。</p>

<p align="center"><a href="#english">English</a> · by KobinFlow</p>

---

## 点染是什么

「点染」取自国画技法：**点**是画布上的一个个节点，**染**是 AI 的生成与渲染。你在画布上放下提示词、参考图、视频和文字节点，用连线把它们串起来，一步步把灵感“染”成完整的作品。

- **节点画布**：多画布项目，节点拖拽缩放、连线、分组、小地图、撤销重做、导入导出。
- **AI 创作**：浏览器直连你自己配置的 OpenAI 兼容或 Gemini 接口，支持文生图、图生图、参考图编辑、文本、音频和视频生成。
- **画布助手**：围绕选中的节点对话、生图，并把结果插回画布。
- **工作台**：独立的生图工作台、视频工作台、素材库和提示词库。
- **节点插件**：Markdown、SVG、HTML、3D 全景、便利贴等官方插件随站点发布，也可以通过 URL 安装第三方插件。
- **自定义调用脚本**：自定义生图、视频接口的调用方式，适配各类中转站和自建服务。
- **数据在本地**：API Key、画布、素材和生成记录都保存在你自己的浏览器（IndexedDB）里，不经过任何服务器；可选 WebDAV 同步。

## 快速开始

### 在线使用

打开部署好的站点，点击右上角「配置」→「渠道」，填入 `Base URL` 和 `API Key`，点「拉取模型」并为模型指定用途（生图 / 视频 / 文本 / 音频），然后回到首页点「新建画布」。

如果接口报跨域（CORS）错误，在自己电脑上运行 `npx @basketikun/canvas-proxy@latest`，再到「配置」→「本地代理」填 `http://127.0.0.1:23210` 并打开。

### 本地开发

```bash
git clone https://github.com/kobingogo/dianran.git
cd dianran/web
bun install
bun run dev        # http://localhost:3000
bun run build      # 产物在 web/dist
```

### 部署

- **Vercel**：直接导入本仓库即可，根目录的 `vercel.json` 已配置好（`cd web && bun install && bun run build`，输出 `web/dist`）。
- **Docker**：`docker compose -f docker-compose.local.yml up -d --build`，默认端口 3000。

### 可选配置（构建时环境变量）

| 变量 | 作用 | 默认 |
|---|---|---|
| `VITE_DOC_URL` | 顶栏和画布菜单里的「文档」链接 | 空（不显示按钮） |
| `VITE_HOMEPAGE_URL` | 产品主页链接 | 空 |
| `VITE_VERSION_CHECK_URL` / `VITE_CHANGELOG_URL` | 远程版本检查用的 VERSION 与 CHANGELOG 地址 | 空（只显示站内更新日志） |
| `VITE_PLUGIN_REGISTRY_URL` | 官方插件清单地址，填 `none` 关闭插件市场 | 站内 `/plugin-market/official-plugins.json` |
| `VITE_ANALYTICS_GA4_ID` / `VITE_ANALYTICS_BAIDU_ID` | 统计（默认关闭） | 空 |

## 品牌与二次开发约定

- 品牌常量集中在 `web/src/constant/brand.ts`，品牌文案在 `web/src/i18n/brand-overrides.ts`（覆盖上游语言包），版本号和更新日志在 `brand/VERSION`、`brand/CHANGELOG.md`。
- logo、图标、分享图由 `brand/render.mjs` 生成，首页示例图由 `brand/showcase.mjs` 生成：`cd brand && bun install && bun run render.mjs && bun run showcase.mjs`。
- 官方节点插件预构建在 `web/public/plugin-market/`，更新方法：`cd plugins/canvas/registry && npm install && npm run build && cp dist/* ../../../web/public/plugin-market/`。
- 浏览器存储名（IndexedDB `infinite-canvas`、`infinite-canvas:*` 键）和插件运行时全局名 `InfiniteCanvasRuntime` 沿用上游，**不要改**，否则已有用户数据和已编译插件会失效。
- 同步上游：`git fetch upstream && git merge upstream/main`（在单独分支上做，通过 PR 合入）。

## 开源协议

[MIT](LICENSE)。点染基于开源项目 [infinite-canvas](https://github.com/basketikun/infinite-canvas)（MIT）二次开发，原始版权声明保留在 [LICENSE](LICENSE) 中，详见 [NOTICE](NOTICE)。

---

<a id="english"></a>

## English

**Dianran (点染)** is a node-based AI creative canvas. Place prompt, image, video and text nodes on an infinite board, connect them, and iterate — generations become a continuous creative flow. Everything (API keys, canvases, assets) stays in your browser; requests go straight from the browser to the OpenAI-compatible or Gemini endpoint you configure.

```bash
git clone https://github.com/kobingogo/dianran.git
cd dianran/web && bun install && bun run dev
```

Licensed under MIT. Based on [infinite-canvas](https://github.com/basketikun/infinite-canvas) (MIT); the original copyright notice is retained in [LICENSE](LICENSE). See [NOTICE](NOTICE).
