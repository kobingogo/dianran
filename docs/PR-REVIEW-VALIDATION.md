# PR 整合验证记录

基线：`origin/phase6-composer`，提交 `19ada4e`。本地分支 `review/pr-integration`。

## 实际检查

| 检查 | 结果 |
|---|---|
| Git 祖先关系 | #3 → #4（含 prompt-pipeline）→ #5 → #6 → #7 |
| main 与最终分支合并树 | `git merge-tree --write-tree origin/main origin/phase6-composer` 成功，无文本冲突 |
| GitHub CI | 没有 Actions 工作流，各 PR checks 为空 |
| 前端 `npm run typecheck` | 原基线、修复后均通过 |
| 前端 `npm run build` | 原基线、修复后均通过；有现有静态/动态导入拆包提示 |
| 前端 `bun test` | 修复前后均 23 pass / 0 fail / 145 断言 |
| canvas-agent `npm test` | 126 pass / 0 fail |
| `node --test brand/pipeline/prompt-key.test.mjs` | 2 pass；中文内容与长前缀不再碰撞 |
| 提示词完整性 | 9 库、1424 条；本地封面/参考路径存在，无外站图片 URL；修复后库内 ID 唯一 |
| 浏览器复制粘贴 | 2 节点 → 4 节点；复制组带成员，副本组 ID 正确，原视频 task 保留，副本不带 task/loading |
| 浏览器组副本 | 4 节点 → 6 节点；原 task 保留，副本不带 task/loading |

环境：Node 22.23.3；系统没有 Bun，使用临时 `npx --package=bun` 的 Bun 1.4.2 安装锁定依赖及执行前端测试；canvas-agent 使用 npm ci 和项目原生 npm test。未改锁文件。

浏览器使用 Playwright CLI 独立 session `dianran-review`，开发服务 `http://127.0.0.1:4317`。构造没有真实渠道凭据的节点，不进行模型调用。原节点刷新后因缺少配置变成 error，但保留 task；复制检查涵盖可恢复任务身份，不等同于真实远端生成验收。

## 浏览器回归复现

保存的 [回归脚本](../output/playwright/copy-regression.js) 自动建立专用测试画布，执行键盘复制粘贴和右键组副本，并断言节点数量、组归属、原任务保留及副本任务清理。

```bash
cd web
npm run dev -- --host 127.0.0.1 --port 4317
```

在仓库根目录、独立终端中使用可用的 playwright-cli：

```bash
playwright-cli -s=dianran-review open http://127.0.0.1:4317/
playwright-cli -s=dianran-review run-code --filename output/playwright/copy-regression.js
playwright-cli -s=dianran-review close
```

脚本应只在独立测试浏览器执行，会向该浏览器 IndexedDB 创建 fixture 项目。无需真实 API Key，不连接真实 Agent。它使用 Vite 模块入口，仅用于开发服务器验证。

## 本轮没有验证的内容

- 真实服务商返回、扣费、模型所有附件能力、自定义调用脚本。
- 完整 1440/390 × 深浅主题流程、真实手机软键盘、跨域视频截帧。
- 真实本地 Agent 的跨会话重启恢复、外部 WebDAV 服务与 Docker 构建/路径。
- 全部提示词的图片语义匹配、原帖可访问性与授权。
- canvas-agent 依赖扫描的实际可达性；npm audit 报告 7 项，应单独评估，不将扫描结果视为利用证据。

上述内容与既有 PROGRESS 报告分别记录，没有将历史生产截图或模拟响应当成本轮独立验收。

## 远端状态

本轮仅本地修复与计划交付，5 个 PR 均已关联当前聊天。没有向 GitHub 发评论、关闭 PR、合并 main、force push 或发布部署。按 AGENTS.md，最终合并方案需用户明确批准，详见 [开发计划](DEVELOPMENT-PLAN.md) 的合并章节。
