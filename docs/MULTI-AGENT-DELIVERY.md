# T06–T17 多 Agent 交付汇总

本轮使用三条子 Agent 分工，主 Agent 整合、复核并补浏览器检查。所有改动保留在 `codex/work-preservation` 工作区，未提交/合并主线、部署或发布 npm；用户原有未提交改动保留。本轮在前序 T06–T17 的基础上完成 AG01–AG10；CF01–CF06 没有启动。

## AG01–AG10 专项交付

| 任务 | 交付状态 | 主要证据与剩余验收 |
| --- | --- | --- |
| AG01–AG02 | 已实现 | 项目/修订绑定、领取/执行/终态查询、交互身份隔离；42 项 session/operations 检查，见 [服务端验收](AG01-AG02-VALIDATION.md) |
| AG03–AG05 | 已实现 | 保存回执、生成排队/未知语义、整批校验、撤销保护和媒体原文件校验；站点与媒体行为检查，真实项目 UI 保存待手动验收 |
| AG06 | 已实现 | 锁定 Codex 协议版本的结构化提问、表单与确认；42 项协议行为检查，见 [AG06 验收](AG06-VALIDATION.md) |
| AG07–AG09 | 已实现 | 能力/模型预检、媒体任务与原生产物、完整性和恢复；13 项媒体/HTTP 检查。本轮真实本机 Codex 完成一张生成与一次参考编辑，PNG 原产物登记通过；turn 随后返回额度错误 |
| AG10 | 共同契约已实现 | 第二 Agent 图片和异步视频替身沿用共同登记/查询/读取路径；Grok Build 与 Codex 原生视频未接入 |

独立 Chromium 验证图片工作台「模型 API / 本机 Agent」来源切换。真实媒体任务通过隔离 HTTP 服务提交，输出见 `output/agent-media/native-generate/original.png` 和 `output/agent-media/native-edit/original.png`。浏览器项目保存、刷新恢复、ZIP 空环境恢复及用户自己的外部 MCP 安装流程仍保留在 Pending Tests。

## 状态与边界

| 任务 | 本轮交付 | 当前状态与未完成部分 |
| --- | --- | --- |
| T06 | 插件源码审阅/授权快照、更新摘要、绑定渠道脚本凭据 | 已实现待用户验收；真实第三方插件/脚本待测 |
| T07 | 未提交/拒绝/未知语义、意图及任务 ID 保存、新请求提醒 | 已实现待真实渠道验收；无通用幂等保证 |
| T08 | 当前能力/渠道/模型/Key 的配置、模型读取与成功证据 | 已实现待实机验收；不后台付费探测 |
| T09 | 数据路径、来源隔离、持久化申请、备份范围说明 | 已实现待用户验收；Docker 资源仍待实际构建/部署检查 |
| T10 | 条件写入、冲突双方保留、独立媒体备份与恢复 | 已实现待真实 WebDAV 多设备验收；不支持条件写入则停止 |
| T11 | 活动海报与产品图组填写、真实输入关系、现有工作流预览 | 已实现首轮入口；其余模板/四模式及真实输出仍待验收 |
| T12 | 22 场景验收矩阵、本地脱敏工具 | 材料已准备；真实渠道、预算、设备、Agent、Docker 验收未完成 |
| T13 | 自己的参考、候选比较、主图采用、现有分支与备份入口 | 界面与链路已接通；真实完整作品任务和主体一致性待验证 |
| T14 | 自愿本地诊断、记录/导出/清除、用户观察提纲 | 工具已实现；没有真实用户样本，研究未完成 |
| T15 | 典型/重度模拟基线、ZIP Worker、同快照前后对比 | 本地测量与局部优化完成；真实规模/设备/生产条件待复测 |
| T16 | 稳定批次身份、真实回执、排他写入与聚合去重、停用说明 | 已实现待配套发布；线上旧 API 不能冒充新版可用 |
| T17 | 五项逐一暂定保留/暂缓、证据门槛及下一切片 | 决策材料已准备；真实研究与验收后复审，不启动全部候选 |

因此不能把全部 12 项写作“已用户验收完成”。T12/T14 需要项目负责人提供实际测试条件与参与者同意，T17 的最终取舍以这些证据为依据。

## 行为验证

本轮和前序 T01–T05 合计 86 项 Node 行为检查通过：插件取消零执行、跨站默认 Key、统计回执/去重、未知请求与任务保存、能力隔离、WebDAV CAS/恢复、模板独立身份、存储持久化、自愿诊断及 ZIP Worker。完整命令：

```bash
node --experimental-strip-types --test canvas-proxy/proxy.test.mjs web/tests/local-proxy.test.mjs web/tests/write-ownership.test.ts web/tests/write-barrier.test.mjs web/tests/canvas-archive.test.mjs web/tests/asset-save.test.mjs web/tests/asset-rescue.test.mjs web/tests/media-references.test.ts web/tests/media-cleanup.test.mjs web/tests/plugin-permissions-usage.test.mjs web/tests/request-readiness.test.mjs web/tests/app-sync.test.mjs web/tests/template-storage-diagnostics.test.mjs web/tests/acceptance-record.test.mjs web/tests/zip-worker.test.mjs
```

独立 Chromium 的活动海报检查确认填写内容、四节点/三输入边、三步四次请求预览，创建和预览均未发生成网络请求；存储说明与自愿诊断导出检查通过。候选比较采用已实际更新原图组，关闭比较弹窗后可继续操作；插件取消授权确认零执行，页面无运行异常。性能检查在另一独立来源执行。用户 localhost:3000 页面和既有浏览器未关闭，未使用真实 Key、付费模型或用户作品。

Bun 不在本次 shell PATH，既有 Bun 专用工作流/Composer 测试未在本轮运行；已用 Node 行为检查与真实浏览器预览核对本轮受影响路径。没有执行语法检查、类型检查、前端构建或 Docker 构建。生产 Worker 打包和目标环境验收由后续实际验证完成，不以开发服务成功代替。

## 记录入口

- [T06/T16 授权与统计](T06-T16-VALIDATION.md)
- [T07/T08 请求与能力](T07-T08-VALIDATION.md)
- [T09/T11/T14 存储、模板与诊断](T09-T11-T14-VALIDATION.md)
- [T10 WebDAV](T10-VALIDATION.md)
- [T12 真实验收矩阵](T12-ACCEPTANCE-MATRIX.md)
- [T13 创作切片](T13-VALIDATION.md)
- [T15 性能基线与优化](T15-PERFORMANCE-BASELINE.md)
- [T17 扩展取舍](T17-EXTENSION-DECISIONS.md)

## 后续实际动作

1. 提供常用渠道/模型、允许测试任务、总费用预算和真实设备；选择独立 Agent 测试环境与参考素材许可，填写 T12 真正结果。
2. 取得首次使用、熟练迭代与长期备份参与者同意，按 T14 提纲观察任务；提供原始证据后再做定位判断。
3. 明确四模式集成基线，复核草稿 PR #1 依赖；任何合并 main 前仍说明改动、验证、风险与冲突并取得用户明确同意。
4. 前端与代理协议 2、统计协议 2 成对发布并保留回退。代理软件包已准备，npm 和生产部署未执行；不只部署新前端。
5. 用真实验收和研究复审 T17，再决定下一项扩展。Agent/Cloudflare 专项继续按原计划与前置条件推进，不等于本轮已迁移域名或云资源。
