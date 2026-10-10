# @infinite-canvas/plugin-sdk

Infinite Canvas 画布节点插件的 **TypeScript SDK**。插件作者只写节点 UI 与逻辑,类型、JSX、运行时桥接、构建全部由 SDK 提供;产物仍是宿主加载器现有契约的 ESM(React external,宿主单例)。

## 提供什么

| 能力 | 说明 |
| --- | --- |
| **完整类型** | `CanvasPlugin` / `CanvasNodeDefinition` / `CanvasNodeContext` / `CanvasAgentOp` / `CanvasTheme` / `CanvasNodeData` … 全部有提示 |
| `definePlugin(...)` | 给插件对象(或工厂)补全类型;对象形式无需再 `const { React } = runtime` |
| automatic JSX | `jsxImportSource` 指向本包,TSX 自动转发到宿主 React,**不打包第二份 React** |
| 类型化 hooks | `import { useState, useEffect, useMemo, useRef, ... }`,运行时转发宿主 React |
| `buildPlugin(...)` | 统一 esbuild 构建,插件 `build.mjs` 只需一行 |

## 最小插件

```tsx
// src/index.tsx
import { definePlugin, useState } from "@infinite-canvas/plugin-sdk";
import type { CanvasNodeContentProps } from "@infinite-canvas/plugin-sdk";

function Content({ ctx }: CanvasNodeContentProps) {
    const [n, setN] = useState(0);
    return (
        <button onMouseDown={(e) => e.stopPropagation()} onClick={() => setN((v) => v + 1)} style={{ color: ctx.theme.node.text }}>
            {ctx.node.title}: {n}
        </button>
    );
}

export default definePlugin({
    id: "my-plugin",
    name: "我的插件",
    version: "1.0.0",
    nodes: [
        {
            type: "my-plugin:node",
            title: "示例",
            icon: "✨",
            defaultSize: { width: 240, height: 160 },
            Content,
        },
    ],
});
```

```js
// build.mjs
import { buildPlugin } from "@infinite-canvas/plugin-sdk/build";
await buildPlugin(import.meta.url);
```

`npm run build` 产出 `dist/<目录名>.js` 并同步到 `web/public/plugins/`。

## 依赖接入

插件 `package.json`:

```json
{
    "type": "module",
    "scripts": { "build": "node build.mjs", "dev": "node build.mjs --watch", "typecheck": "tsc --noEmit" },
    "devDependencies": {
        "@infinite-canvas/plugin-sdk": "file:../sdk",
        "@types/react": "19.1.12",
        "typescript": "^5"
    }
}
```

插件 `tsconfig.json` 关键项:`"jsx": "react-jsx"`、`"jsxImportSource": "@infinite-canvas/plugin-sdk"`、`"moduleResolution": "bundler"`。

## 设计约束

- **React 单例**:JSX 与 hooks 惰性读取 `globalThis.InfiniteCanvasRuntime.React`(宿主在加载插件前注入),react 全程 external,绝不打包第二份。
- **重依赖**:three、marked 等在源码里 `await import("https://esm.sh/...")` 动态加载,esbuild 自动 external,不进 bundle。
- **类型真源**:`src/types.ts` 是宿主 `web/src/types/canvas-plugin.ts` 公开契约的镜像;宿主契约变更时同步此处。


## 可审阅的图片处理动作

节点定义可提供 `workflowAction`，包含 id、version、title、description、validate 与 execute。validate 接收未知参数并返回扁平的字符串/数字/布尔对象；execute 接收原图 Blob 数组、冻结参数和进度回调，返回与输入逐张对应的图片 Blob 数组。不要覆盖输入文件；结果由宿主另存为图片节点、登记任务并保存回执后交给下游。

节点按钮调用 `ctx.previewWorkflow(parameters)` 打开审阅，不直接执行。宿主核对已授权源码 SHA-256 和动作版本；插件更新、停用或参数变化后要求重新预览。保存失败只重试原结果；刷新中断且没有保存输出时，不自动重新运行。当前动作契约只支持图片输入/输出，不支持任意脚本步骤；ZIP 交付使用独立的手动下载节点。

点染随应用提供「素材处理」：去背景、AI 放大 2 倍、裁剪、尺寸适配、PNG/JPEG/WebP 转换与原图 ZIP。选中已保存的图片，在工具栏点击「素材处理」创建并连接工具节点。去背景和放大在浏览器 Worker 内处理，首次下载模型与推理运行时；其余动作使用浏览器图像编码。网络、浏览器能力或设备内存不足时报告失败，保留原图。已保存作品随画布备份；尚未保存的处理回执留在当前浏览器来源中。

模型来源：[ORMBG ONNX](https://huggingface.co/onnx-community/ormbg-ONNX)、[Swin2SR 2×](https://huggingface.co/Xenova/swin2SR-lightweight-x2-64)。当前为工作区开发版本，需配套更新前端与 Canvas Agent；尚未发布新版插件包。
