# AG06 结构化提问与 MCP 交互验证

## 协议依据

以项目锁定的 `@openai/codex@0.146.0` 实际二进制执行 `app-server generate-json-schema` 为依据，同时核对[官方 App Server 文档](https://learn.chatgpt.com/docs/app-server)。没有升级 Codex、改变历史存储格式或引入新的超时、重试与并发边界。

- 结构化提问的实际服务端请求为 `item/tool/requestUserInput`，响应为 `{ answers: { questionId: { answers: ["用户回答"] } } }`。
- MCP 请求为 `mcpServer/elicitation/request`，响应使用 `accept/decline/cancel` 与 `content`。
- `serverRequest/resolved` 确认请求已答复或清理。提交后仍显示等待确认，其他页面不能重复提交。
- 锁定提问响应没有取消枚举：用户明确点击取消时回复 `answers: {}`；不会以空回答冒充接受。
- MCP 允许 `turnId` 为空；仅在 threadId 与当前运行线程一致时绑定该 turn。不能绑定时明确取消，不借用其他任务身份。

## 已实现

按 threadId、turnId、requestId 区分请求；可选择选项、填写其他回答、使用隐藏输入填写秘密回答、明确取消。标准 MCP 平面表单支持字符串、数字、整数、布尔、单选和多选枚举，后端使用 MCP SDK 提供的 Ajv 校验器检查真实 schema 的必填、格式、枚举和范围。默认值不替用户提交。

URL 请求展示来源、说明和完整地址，仅允许不含用户名/密码的 HTTP(S) 地址。用户自行打开后仍需点击确认；打开链接不会自动接受。尚未接入扩展 `openai/form` 模式，也未声明该 capability：遇到该模式或不能呈现的表单明确取消并解释。

中断、turn 完成、服务退出清理可回答状态。迟到旧 turn 的请求取消；迟到答案拒绝。原命令、文件和权限三类审批仍保留，返回接口可以校验原始 thread/turn；任务结束后旧审批失效。

## 可复现行为检查

```bash
canvas-agent/node_modules/.bin/tsx --test canvas-agent/src/agent/codex-client.test.ts
```

42 项通过，其中新增 4 项覆盖真实回答与身份校验、跨页重复回答、表单约束、URL 明确拒绝、危险 URL 与未支持扩展取消、resolved 归属、turn/进程退出清理，以及原权限审批的原任务绑定。使用受控 app-server 消息与写入记录验证，没有调用收费生成。

## 手动验收

1. 本机 Agent 启动后，让 Codex 发出 `request_user_input`：选一项、填写其他回答；提交后等待 resolved，第二页面的相同请求应不能重答。
2. 对同一问题点击取消，确认 Codex 不将其解释成用户已选择某个选项。
3. 用测试 MCP 服务发出标准 form：填写必填字段、非法 email、越界数字和多选枚举；非法输入不能发往 app-server，修改后再提交。
4. 发出 URL elicitation：核对地址，打开后取消，再发一次并确认。仅打开地址不应自动提交。
5. 提问期间中断、切换线程、刷新或重启服务，核对不可答旧卡片不会进入新任务；刷新时使用服务端 pending 清单恢复，不重放为新问题。
6. 分别触发命令、文件、权限审批，核对原三类允许/拒绝流程和过期保护。

真实 Codex/MCP 运行、刷新恢复、切换线程与前端按钮联验由整合验收补充；以上协议行为检查不替代真实用户验收。
