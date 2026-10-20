---
name: open-canvas
description: 打开点染（Dianran）在线或本地画布，并自动连接本地 Canvas Agent。用户要求打开、启动、进入或使用点染画布时使用。
---

# 打开点染画布

默认打开在线版（https://dianran.vercel.app）。只有用户明确要求使用本地项目时，才启动本地前端。

如果当前画布已连接，直接使用现有连接，不重启服务或新建画布。首次打开才按下列流程连接；保留用户现有标签页。开发工作区新增的工具需要配套本地前端和本地 Canvas Agent，已发布的 latest 不代表包含未发布改动。

## 在线版

1. 启动本地 Canvas Agent 并保持运行：

```bash
npx -y @kobinflow/canvas-agent@latest
```

2. 从启动输出取得 `Local URL` 和 `Connect token`。

3. 在 Codex 右侧浏览器打开（token 放在 `#` 之后，不会发送给网站服务器）：

```text
https://dianran.vercel.app/canvas?mode=new#agentUrl=<Local URL>&agentToken=<Connect token>
```

## 本地版

1. 在点染项目中启动前端，并使用 Vite 输出的 `Local` 地址：

```bash
cd web
bun install
bun run dev
```

2. 启动本地 Canvas Agent：

```bash
npx -y @kobinflow/canvas-agent@latest
```

3. 从启动输出取得 `Local URL` 和 `Connect token`，在 Codex 右侧浏览器打开：

```text
<Vite Local 地址>/canvas?mode=new#agentUrl=<Local URL>&agentToken=<Connect token>
```

## MCP 与连接地址

插件在新的 Codex 任务中加载时会自动启动 `npx -y @kobinflow/canvas-agent@latest mcp`（MCP 服务名 `dianran`）。这个 MCP 进程负责提供画布工具，
不提供网页连接服务；上面启动的普通 Canvas Agent 负责提供 `Local URL` 和 `Connect token`。两个进程读取同一份本地配置
（`~/.dianran/canvas-agent.json`），因此不需要用户手动填写地址或 token。

## 打开模式

用户没有明确指定打开方式时，始终使用 `mode=new` 新建画布。只有用户明确要求时才替换为：

- 最近画布：`mode=recent`
- 自己选择：`mode=choose`
