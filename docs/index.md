# Infinite Canvas Documentation Index

## Overview

- [Quick Start](/docs/overview/quick-start)
- [Features](/docs/overview/features)
- [Deploy on Render](/docs/overview/render)
- [Docker Deployment](/docs/overview/docker)
- [Third-party Prompt Sources](/docs/overview/third-party-prompt-repositories)

## Canvas Guide

- [Canvas Node Guide](/docs/canvas/canvas-node-manual)
- [Canvas Shortcuts](/docs/canvas/canvas-shortcuts)

## Development and Data

- [Skill 安装、资源与版本](SKILL-INSTALLATION.md)

- [Local Development](/docs/development/local-development)
- [Canvas Data Structure](/docs/development/canvas-data-structure)
- [How the Local Codex Connection Works](/docs/development/local-codex-canvas)

## Business

- [Open-source License](/docs/business/license)
- [Business Cooperation](/docs/business/business)

## Support and Security

- [Report a Vulnerability](/docs/support/security)
- [Sponsor the Project](/docs/support/sponsor)

## Project Progress

- [Changelog](/docs/progress/changelog)
- [Pending Tests](/docs/progress/pending-test)
- [TODO](/docs/progress/todo)
- [Phase6 Composer interaction plan](phase6/INTERACTION-PLAN.md)
- [Phase6 P0/P1 delivery](phase6/PROGRESS.md)
- [项目分析与后续开发计划](DEVELOPMENT-PLAN.md)
- [产品审视：架构、产品与用户体验](PRODUCT-REVIEW.md)：五轮研究、隔离实验、问题优先级及验收建议。
- [产品改进实施计划](IMPLEMENTATION-PLAN.md)：T00–T17 基础任务、AG01–AG10 本地 Agent 专项（含 Codex 生图与其他 Agent 适配预留）、CF01–CF06 Cloudflare 迁移与域名上线，以及依赖、投入与验收标准。
- [主要功能流程验收清单](MAJOR-FLOW-ACCEPTANCE.md)：按主流程执行隔离模拟与真实环境验收，并区分可复现检查和外部依赖。
- [T11 模板与四模式工作流整合记录](T11-INTEGRATION-VALIDATION.md)：当前工作区整合范围、检查结果和未验收边界。
- [Cloudflare 本地准备说明](../cloudflare/README.md)：不含云资源创建、上传或生产部署的准备工具与配置模板。
- [AG01–AG10 多 Agent 交付与实机验证](MULTI-AGENT-DELIVERY.md)：画布目标绑定、Codex 结构化交互、本机生图/编辑产物和仍待手动验收的边界。
- [作品保全实施与验收](WORK-PRESERVATION-VALIDATION.md)：第一批修复的实际进度、针对性回归和浏览器待验收场景。
- [PR 整合验证记录](PR-REVIEW-VALIDATION.md)

## Notes

- Canvas projects and My Assets are primarily stored in the browser. WebDAV can be configured for cross-device synchronization.
- The AI API key is stored in the browser, which sends requests directly to OpenAI-compatible endpoints.

- [可靠性与工作流验收记录](WORKFLOW-RELIABILITY-VALIDATION.md)：保存失败、快照重试、过程投递、工作流/模板/Agent 计划的实现边界与可复现命令。

- [T04 同源单页面编辑权设计](T04-WRITE-OWNERSHIP.md)

- [T05 本地代理授权验收](T05-PROXY-VALIDATION.md)：配对、目标范围、隔离检查与成对发布待办。

- [T06–T17 多 Agent 交付汇总](MULTI-AGENT-DELIVERY.md)：实现、行为检查、真实验收及研究/发布依赖。
- [T01–T17 手动验收手册](T01-T17-MANUAL-ACCEPTANCE.md)：测试准备、逐项操作与通过标准、故障测试边界及结果记录表。

- [图片工作台交互优化方案](./IMAGE-WORKBENCH-UX-PROPOSAL.md)：本机/API 统一创作结果、任务、历史和异常恢复规则，附可交互概念原型。

- [跨页面创作交互规则](./CREATION-INTERACTION-RULES.md)：图片/视频/画布统一任务归属、输入生命周期、生成与保存状态、历史/任务恢复及验收标准。

- [跨页面创作首轮实施与验收](./CREATION-INTERACTION-IMPLEMENTATION.md)：本轮实际改动、行为回归证据和仍待实机确认的生成/恢复/故障场景。

- [统一 Agent 创作入口](AGENT-CREATION-ENTRY.md)：主输入框与协作详情的共享会话、结果归属和本地验收。
- [创作输入与讨论设计](CREATION-CONVERSATION-DESIGN.md)：已确认的统一输入、云端/本机多轮讨论、方案版本确认、工作台记录流和画布就地创作规则；首轮实现待验收。
- [创作输入与讨论实施](CREATION-CONVERSATION-IMPLEMENTATION.md)：本轮入口、讨论适配、方案版本、任务作品绑定、画布接续及验证边界。
