---
name: canvas
description: 操作点染当前画布，读取和编辑节点、审阅跨步骤工作流、接入本机 Codex 生图和素材处理。用户要求在点染中创作或处理作品时使用。
---

# 点染 Dianran

你正在帮助用户操作点染（Dianran）网页画布。需要理解或改动画布时，优先使用已配置的 `dianran` MCP 工具；不要让用户手动复制 JSON、URL 或 token。

## 工作流

- 如果用户还没有打开或连接网页画布，使用 `open-canvas` 技能打开点染画布，不要要求用户手动复制 URL 或 token。
- 操作前先用 `canvas_get_state` 读取当前画布；如果用户明确提到选中内容、当前节点或“这个”，先用 `canvas_get_selection`。
- 保存读取返回的 `target`（clientId/projectId/revision），后续写入和工作流预览都携带它；修改后重新读取。网页已切换或修订改变时不要用旧 target 继续。
- 创建单个文本内容优先用 `canvas_create_text_node`。
- 使用已配置模型 API 时，创建生成内容使用 `canvas_generate_text`、`canvas_generate_image`、`canvas_generate_video`、`canvas_generate_audio`。这些工具不代表本机 Codex 原生生图。
- 需要把提示词、配置和生成节点串成流程时，使用 `canvas_create_generation_flow` 或项目已有的流程工具。
- 需要批量增删改、移动、连接节点或设置视口时，使用 `canvas_apply_ops`。
- 不要模拟鼠标点击，不要要求用户手动复制 JSON。
- 写入画布的操作会由网页侧边栏做二次确认，按当前工具结果继续推进即可。

## 本机 Codex 与工作流

先用 `canvas_get_capabilities` 核对 `native.models`、`native.capabilities` 和 `actions`。本机 Codex 仅支持已登记的图片能力；视频使用模型 API。模型可选不等于已成功验证，不猜测模型名称，不自动回退到 API。

用户选择本机生图时，用 `canvas_create_node` 创建 config 节点，metadata 设置 `generationMode: image`、`generationSource: codex`、`codexModel: 用户明确选择的本机模型`、`prompt` 和 `composerContent`。引用真实图片/文字节点可通过连线及 draftReferenceIds 接入。每步一个原生任务，数量、比例等要求写入提示词。

调用 `canvas_preview_workflow`，传入真实配置/处理节点的 nodeIds；需要串联下游时设置 includeDownstream。该工具仅打开预览，不提交生成；让用户在网页确认执行，不再同时调用单步生成。生成身份与结果存入任务中心，原图保存后才继续下游。

## 画布素材处理

内置 `dianran-image-tools` 提供 removeBackground、upscale、crop、resize、convert 和 export 节点；先查询 actions 以确认当前网页实际支持的动作。通过 canvas_create_node 创建已启用的节点类型，连接已保存的图片；处理参数放在 metadata.pluginActionParameters。不要把处理结果写回原图。

- crop：x、y、width、height 使用原图像素，宽高为正整数，范围不能越界。
- resize：width、height、fit（contain 或 cover）和六位十六进制 background。
- convert：format（png/jpeg/webp）、quality（0–1）和六位十六进制 background；JPEG 会合成背景。
- removeBackground / upscale：参数为空。首次执行下载模型到浏览器，在本地处理；upscale 使用 2 倍超分模型。
- export：网页节点提供原文件打包下载；它是交付操作，不是生成步骤。

处理节点同样通过 canvas_preview_workflow 审阅后执行，可串联本机生图或 API 视频步骤。失败、断线或状态未知先查询原请求/任务；处理已完成但保存失败，只重新保存原结果，不重新处理或生成。刷新中断的本地推理没有可恢复的运行进程，需要用户重新审阅后发起新任务。

## 风格

- 页面文案和画布节点内容默认使用中文。
- 生成节点、配置节点和提示词节点要保持结构清晰，方便用户继续编辑。
- 批量创建节点时注意给节点留出间距，不要堆叠在同一个位置。
- 图片、视频、音频等媒体节点默认保留原始比例；只有用户明确要求自由变形时才改变比例。
- 生成流程尽量少而清楚，优先让用户一眼能看懂节点关系。
