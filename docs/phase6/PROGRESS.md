# phase6 P0 — 统一 Composer 交付进度

## 范围与状态

实现者：Codex，单人实现。分支 `phase6-composer`，继承 `phase5-redesign`；PR 按要求以 `phase4-fixes` 为 base，因此包含 phase5 基础提交。水墨视觉 token、IndexedDB `infinite-canvas`、既有存储键、画布核心结构及 MIT 两行版权保留。

- [x] 首页、桌面与手机共用 Composer：生图/视频模式，保留现有 Agent 助手入口；「在画布中创作」作为结果落点开关，另有新建空白画布入口。
- [x] `+` / `@` / 模型 / 比例 / 画质或清晰度 / 张数或时长 / 更多 / 提交在同一输入区域；模型不跳页面，每个 chip 打开对应弹层，手机使用底部面板。
- [x] 能力驱动：共用能力表、参数解析与请求规划；合法值保留，非法值吸附并提示，未知能力保留说明。
- [x] 草稿交接：生图/视频独立草稿经 localforage 持久化；附件有身份、可预览/排序/移除；上传、粘贴、素材引用去重；提交携带身份、附件、参数快照，消费后清除命令，返回/刷新不重放。
- [x] 生成快照：请求与结果冻结本轮提示词、参数、参考身份；结果「本轮参数」可查看，不保存 API Key。
- [x] 费用/速度：显示真实调用次数及渠道计费说明，删除固定倍率与伪精确耗时。
- [x] 结果闭环：图片作参考、转视频；视频当前帧作参考；图片/视频送入已有或新建画布。落点开关仅在提交时建项目，成功结果自动入画布。
- [x] 送入画布只创建结果节点，保留提示词与实际参数 metadata，不添加输入/配置/关系；同结果向同项目送入可去重，保持原始比例并放到已有节点右侧。
- [x] 手机提交始终位于独立底栏，参数横向滚动，结果区独立滚动；移除「在左侧」文案，结果按钮不再遮住「送入画布」。
- [x] 适配器：Sora 单张参考改为 `input_reference`，不发 `mode/first_frame/last_frame`；SiliconFlow 多图编辑、Sora 尾帧与首尾帧的多余附件在提交前明确阻止静默丢弃。沿用视频 7 张收集上限，未新增超时/重试/并发阈值。
- [x] 文档：检查并更新 TODO、Pending Tests、Unreleased；正式功能说明等用户验收后更新。
- [x] 本地 typecheck/build/相关测试/Playwright 截图。
- [x] 实现提交 `cf7cac1` 已推送 `phase6-composer`；PR [#7](https://github.com/kobingogo/dianran/pull/7)，base `phase4-fixes`，当前可合并但未执行合并。
- [x] Production：[dianran-next.vercel.app](https://dianran-next.vercel.app)，项目 `dianran-next`，状态 Ready。独立部署目录 `/tmp/dr-next-phase6`；未操作 `dianran` 项目。
- [x] Production 冒烟：1440 / 390 的首页、生图、视频共 6 页均 HTTP 200，各页恰好一个 Composer、渠道计费提示可见，运行时错误 0；截图为 `production-*-light.png`。

## 费用显示决策

生图 N 张按当前工作台执行方式显示 N 次生成请求；视频显示一次创建任务，轮询不计作生成请求。当前渠道配置没有可匹配单价，因此只显示「费用由所选渠道计费」，不展示金额。删除「约 2×」「约 2–4×」及固定秒数/分钟区间，没有建立同渠道、同模型、同参数历史估算时不显示精确耗时；生成中的已等待时长仍来自真实计时。

## 送入画布决策

默认只送最终图片/视频，连同本轮提示词摘要、实际参数和来源身份存入 metadata。快速出图用户拿结果继续使用，无需先理解输入节点、配置节点和关系。弹窗明确说明未携带完整过程，避免暗示工作流已经同步；「连同创作过程」与画布深度统一保留为 P1/P2 TODO。

## 4K 与视频参数

- Gemini 3：标准 → `imageSize=1K`，高清 → `imageSize=2K`；显式 1K/2K/4K 覆盖画质，回显「输出 4K」。切换比例保留显式档位，切到无档位模型会回到合法比例预设并提示。极端比例以只供 Gemini aspect-only 规划使用的尺寸标记保留档位身份；这些标记像素不发给 Gemini，实际像素请求的既有校验限制未改。
- 单测覆盖 Gemini 能力表全部比例 × 3 档，浏览器实际拦截验证 `1:8 + imageSize=4K`。通用高清不等于 4K，也不新增未核实的原生分辨率能力。
- 视频当前能力表无 4K，所有入口不提供视频 4K，也未接入可灵。Veo 4/6/8 秒；Sora 4/8/12 秒；Relay 5/6/8/10 秒。Sora 1080p 档注明真实 1792×1024 / 1024×1792。

## 验证与体积

- `cd web && bun run typecheck`：通过。
- `cd web && bun run build`：通过。
- `cd web && bun test`：17 pass，0 fail，118 断言。未触及 canvas-agent，本轮不重复其测试。
- Playwright：1440×900、390×844，浅色/深色四组；隔离 headless 浏览器，无关闭用户窗口或标签页。
- 使用模拟渠道响应与本地图片/视频 fixture，没有真实付费调用。每组：首页 3 张 = 3 次请求；模型在原地切换；合法比例吸附；Veo/Sora/Relay 时长集正确；视频一次创建任务；Sora 请求字段正确；Gemini 1:8 4K；视频送入画布仅 1 节点、0 关系，metadata 无 Key；返回不重发。另验收自动图片落点、空开关不建项目、Enter/输入法不提交、Ctrl+Enter 单次提交、刷新恢复草稿、缩至 390×550 时提交可达。浏览器运行时错误 0。
- 首屏显式入口 JS（HTML 的主入口 + React vendor）：**1,446,193 B，gzip 475,384 B**。主入口本身 1,161,787 B；不能把主入口单独与 phase5 总量比较。
- 对比 phase5 PROGRESS 的 1,271,261 B：增加 174,932 B（约 13.8%）。本机保留的 phase5 dist 同口径为 1,277,674 B，较它增加约 13.2%。新增首页可用的参数控件带来体积增长，素材库、提示词库与手机设置面板已延迟加载；仍有后续拆分空间。
- 请求与断言证据：本目录 `acceptance.json`；脚本 `acceptance.mjs`（使用 `/tmp/tools` 已安装的 playwright-core）。

## 截图

全部截图位于 `/workspace/dianran-shots/phase6/`，以下为主要审阅入口：

1. `home-1440-light.png`
2. `home-390-dark.png`
3. `image-results-1440-light.png`
4. `image-results-390-light.png`
5. `video-1440-light.png`
6. `model-switch-390-light.png`

另外保存视频结果、Gemini 4K 弹层/回显、手动送入画布与自动图片落点，以及各页浅/深色完整组合。

## 已知限制与 handoff

- P1/P2：统一画布节点与 Agent 的深层 Composer、节点组引用、完整创作过程同步及工作流执行。P0 的 Agent 按钮打开现有助手，未重做 Agent 输入协议。
- `@` 在 P0 使用可见的 `@[ref:id]` 正文身份标记与附件条；画布既有 `@[node:…]` 语法未改。富文本 token、失效画布节点引用、键盘资源选择完善留到画布统一阶段。
- 未增加报价配置或历史耗时统计；当前无可靠来源，所以无金额/精确速度。
- 浏览器自动化证明前端交互和请求字段，真实服务商产出、计费、Sora/Veo 附件适配仍需用户使用自己的渠道验收。真实手机软键盘和外域视频截帧需人工确认；外域 CORS 受限时截帧会明确失败，可改用上传图片。
- 当前作品与草稿主要在浏览器本地，未承诺云同步。Key 在浏览器本地，前端直连所选服务；生成快照与画布 metadata 不包含 Key。
- 既有视频轮询失败/中断处理沿用，远端任务恢复细分属后续范围；画布持久化沿用原存储机制。

## 发布记录

- PR：https://github.com/kobingogo/dianran/pull/7（base `phase4-fixes`）。
- 固定 production：https://dianran-next.vercel.app
- 本次部署：https://dianran-next-g2o18zao7-kobingogos-projects.vercel.app
- 实现提交：`cf7cac1`。后续提交仅补写本交付记录，不改部署代码。
- Production 实际下载的主入口 + vendor：1,446,193 B，gzip 475,384 B（Python gzip，便于复核）；详见本地 `production-js-size.json`。
- Production 验收证据：`production-smoke.json`、`production-*.png`；最终草稿数据库显式使用 infinite-canvas/app_state 的回归证据：`acceptance-final-draft.json`。


# phase6 P1 — 画布输入、引用与迭代统一

## P1 清单

唯一实现者：Codex。继续使用 `phase6-composer`，沿用 P0 Composer、水墨全局主题与能力表。存储命名、节点/连线核心字段、`images/primaryImageId` 和 `@[node:…]` 保留，仅追加可选字段；没有修改 Agent 协议或消息存储版本。

- [x] **画布 Composer**：底部停靠，目标条显示新建/继续编辑/编辑配置/填充节点。项目、节点和生图/视频模式各自保存提示词、参数、附件及引用草稿；切换和刷新不丢草稿。图像/视频/配置的大输入不再跟随节点漂移，文字/音频及扩展节点沿用现有专用面板。
- [x] **自动建图**：空白提交配置+结果；上传/素材引用只在提交时创建素材+配置+结果，已有素材复用。选中空图/视频节点原位填充；一次提交一套关系。结果自动定位到可视区域，修复手机使用桌面默认画布尺寸的问题。
- [x] **引用统一**：本轮 nodeIds/附件是输入权威，`@`、引用条与配置输入关系同步；删除正文提及保留引用，移除引用条才退出。历史连线未加入本轮时标注「可用输入（未加入本轮）」，不悄悄重写输入。组内资源展开并按文件身份去重，失效节点/空组/缺失文件阻止提交；方向键/Enter 选择及输入法不误提交。内置 Gemini 视频适配器只发单个 video/audio，超过现有可发送范围明确拦截，自定义脚本继续自行承接。
- [x] **版本与分支**：再生成冻结原提示词、参数和参考身份，创建新版本；继续编辑、转视频创建新配置及新结果，原结果保留。结果 metadata 保存 creation/inputSnapshot、来源节点/配置、versionOf/branchKind；可查看本轮参数并定位来源。修改配置或上游资源仅标记输入已变化，不自动付费重跑。
- [x] **多图继承**：继续保留批次、主图、部分成功、单图重试、展开与独立副本；副本继承输入快照及来源，图片按原比例展示。原画布 15 张范围和工作台 10 张范围均不变。
- [x] **任务恢复**：远端任务 ID 保留；查询中断回到待查询状态并明确远端状态未知，取状态和刷新恢复只查询已有任务，不创建新任务。停止等待仅停止本地请求，不声称已取消远端生成。
- [x] **Agent 最小对齐**：Agent 侧栏打开时卸载画布主 Composer/节点输入面板；会话草稿独立持久化。新导入的 Agent 图片按 threadId/turnId/itemId 记录来源，结果定位来源轮次、消息定位结果；沿用历史快照权威和不重复执行事件规则。
- [x] **文档**：P1 从 TODO 移到 Pending Tests，Unreleased 按版本级归纳；正式功能说明等待用户确认。

## 设计决策

1. 底部复用 P0 Composer 并追加目标条；快速出图不需要手动摆配置节点。节点自身继续展示配置摘要，多图组件沿用。
2. 浏览选中不等于引用。用作参考、继续编辑和转视频才主动加入当前输入；正文提及和引用条可以分别编辑，输入关系由本轮引用集合统一决定。
3. 连线只追加 `kind?: input | generation`。旧关系仍可浏览/显式加入，新生成关系表达素材→配置→结果，不引入工作流执行器。
4. 输入快照保存本地文件身份，执行前重新读取原文件；不保存 API Key，不依赖过期 blob URL。改上游只标记变化，显式提交才请求。
5. 首屏优化采用低成本删去未使用的 ProConfigProvider 和按需加载英语词包；原路由已经 lazy-load 画布，无需重做拆包。

## 验证

- `cd web && bun run typecheck`、`bun run build` 通过；`bun test` **23 pass、0 fail、145 断言**。
- `cd canvas-agent && bun test` **126 pass、0 fail**；消息归属、权威历史、备份与协议规则未改。
- Playwright 隔离浏览器：1440×900 / 390×844，各自浅/深；额外缩到 390×550 检查提交可达。新建→生图→继续编辑→转视频，节点/关系分别 2/1、4/3、6/5；三图=三请求，视频=一次创建。
- 扩展验收：上传提交前不建节点，提交后 3/2；再生成保留原快照；失效引用阻止提交；部分成功、单图重试、主图比例、副本快照；视频查询中断/取状态无重复 POST；Agent 会话隔离与双向定位。使用模拟服务商和模拟 Agent 消息，不产生真实付费调用。
- P0 手机深色回归：首页交接、作参考、模型切换、Sora 字段、Gemini 1:8 4K、视频送入画布、自动图片落点、键盘与刷新草稿通过。
- 补充验收：手动画线加入引用、移除引用同时删提及/输入关系；上游变化不新增请求；选中空图原位填充；英语切换、刷新和中文恢复。
- 证据：`canvas-p1-acceptance.json`、`canvas-p1-extended.json`、`canvas-p1-connections.json`；脚本 `canvas-p1-*.mjs`。最终浏览器运行时错误 0。

## 首屏 JS（与 P0 同口径）

按 HTML 显式主入口 + modulepreload React vendor 的 JS 原始字节之和测量，不把异步画布 chunk 计入首屏；沿用 P0，不计独立 config.js。

P1：**1,295,870 B，gzip 425,969 B**；较 P0 减少 150,323 B（10.4%），约 1.296 MB。P0：1,446,193 B，gzip 475,384 B。英语用户切到英语会额外加载独立词包；中文首屏不会加载它。详见 `canvas-p1-js-size.json`，生产发布后复核同一资产。

## 截图

全部位于 `/workspace/dianran-shots/phase6/`：

1. `canvas-p1-dock-1440-light.png` — 桌面底部 Composer。
2. `canvas-p1-dock-390-dark.png` — 手机深色 Composer。
3. `canvas-p1-graph-1440-light.png` — 配置与三图结果、目标条。
4. `canvas-p1-reference-390-light.png` — 本轮引用。
5. `canvas-p1-edit-1440-dark.png` — 继续编辑分支。
6. `canvas-p1-video-390-dark.png` — 视频分支。

另有四组浅/深完整截图，以及上传、批次、失效引用和任务查询中断画面。

## Codex 错误与修复

- 实现中一度引用不存在的 messages/mounted 局部变量，分别由浏览器和 typecheck 检出，已修复并重跑。英语词包延迟加载最初导致刷新后的语言回显滞后，改为初始化完成后挂载应用，英语切换/刷新回归已通过。
- 多图副本原逻辑漏带新增快照，扩展验收检出后修复；手动画线遗漏同步引用，复核后补齐。
- 测试脚本曾读到 Vite HMR 的不同模块实例，或未等旧存储防抖完成便刷新，已改为独立测试服务器和等待持久化；曾把任务 content 当 JSON 拦截，已换为有效 webm fixture。
- 最终验证无未解决错误。未改变超时、重试或并发边界；未关闭用户浏览器/标签页。

## P2 / handoff

- P2 不做：工作流执行、模板复用/偏好沉淀、可靠渠道报价和历史耗时估算。
- 可选「连同创作过程送入」仍为 TODO；工作台送入画布默认只送最终结果，P1 的完整输入关系由画布显式提交创建。
- 真实服务商计费、模型产出和真实手机软键盘，以及真实本地 Agent 跨会话恢复需用户渠道验收。自动化已验证前端关系、参数、归属和请求行为。
- 只有带新增 agentSource 的结果可精确定位轮次；旧结果不编造消息来源。没有更改 Agent 通信/消息存储协议。
- 视频能力表无 4K，继续不显示。画布和我的素材仍以浏览器本地为主，Key 浏览器保存并前端直连；Docker 静态资源路径验收仍待办。

## P1 发布记录

- PR：[ #7 ](https://github.com/kobingogo/dianran/pull/7)，继续更新同一 PR，base `phase4-fixes`；P1 顺接 P0，不拆 PR，不合并 main，不 force push。
- Production 目标：[dianran-next](https://dianran-next.vercel.app)，独立目录 `/tmp/dr-next-phase6`，仅 link 项目 `dianran-next`。
- 实现提交：`55e1ee4` 已普通 push 至 `phase6-composer`；后续提交只补交付记录，部署代码不变。
- 本次 production：[dianran-next-evu3fd7jo-kobingogos-projects.vercel.app](https://dianran-next-evu3fd7jo-kobingogos-projects.vercel.app)，状态 **Ready**，固定 alias https://dianran-next.vercel.app 。`vercel inspect` 已核对项目与 production 状态。
- Production 实际入口：**1,295,870 B，gzip 425,969 B**，主入口及 vendor 与本地构建逐字节一致；证据 `canvas-p1-production-js-size.json`。
- Production 冒烟：1440 浅/390 深，新建→生成→继续编辑→转视频；保存关系为 6 节点/5 连线、原图保留、快照不含 Key、7 次创建请求，仅一个 Composer，HTTP 200、0 运行时错误。证据 `canvas-p1-production.json`，截图 `canvas-p1-production-1440-light.png` / `canvas-p1-production-390-dark.png`。
- 发布工具问题：本机无 rsync，改用 Git 文件清单复制到独立部署目录；gh pr edit 的旧 Projects GraphQL 调用失败，改为 REST 更新 PR。生产验收改为读取持久化完整图，避免把视口裁剪后的 DOM 节点数误当完整项目。
