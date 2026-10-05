# 点染 Dianran Codex / ZCode 插件

让 Codex / ZCode 可以打开并操作点染画布。插件本身只包含两样东西：

- `skills/`：告诉 Codex 如何打开画布（`open-canvas`）和如何使用画布工具（`canvas`）；
- `.mcp.json`：注册名为 `dianran` 的 MCP 服务，命令是 `npx -y @kobinflow/canvas-agent@latest mcp`。

## 安装（Codex）

```bash
codex plugin marketplace add kobingogo/dianran        # 读取本仓库根目录的 .agents/plugins/marketplace.json（marketplace 名 dianran-local）
codex plugin add dianran@dianran-local
```

也可以先 `git clone https://github.com/kobingogo/dianran.git`，再 `codex plugin marketplace add "$(pwd)"`（Windows PowerShell 用 `"$PWD"`）。
在分支合并到 main 之前，可加 `--ref <分支名>` 指定分支。

## 安装（ZCode）

- 打开 **Settings → Plugin Management → Discover**，点击右上角 **`+`** 添加 marketplace；
- 选择本仓库目录下的 `plugins/dianran`（或仓库根目录），即可发现并安装 `dianran` 插件。

安装后新建一个任务，然后输入：

```text
帮我打开并连接到点染画布
```
