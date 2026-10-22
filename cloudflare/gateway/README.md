# 点染模型网关

独立于主站迁移模板部署的 Cloudflare Worker，只转发 whatsToken 的模型列表、图片生成／编辑、视频任务创建／查询及同源视频内容接口。不是通用 URL 代理，不提供平台共用模型 Key。

## 调用与隐私

- 前端构建配置 `VITE_MODEL_GATEWAY_URL=https://dianran-model-gateway.yangling7212.workers.dev/api/model-gateway` 后，原渠道地址与模型身份不变，whatsToken 的 `/v1/` 请求优先经网关；本机代理不参与这些请求。其他服务仍按原配置调用。
- 用户 Token 保存在当前浏览器，每次调用经网关临时转发给固定的 `https://www.whatstoken.ai`；不写入数据库、日志、环境变量、URL 或缓存。请求和响应以流转发，不读取或保存生成内容。关闭 Worker Observability、Logpush，不输出请求异常原文。
- 仅接受配置中的完整网页来源、白名单路径与方法，以及请求头中的 Bearer Token。来源校验不是用户身份认证，调用仍使用并由上游校验用户自己的 Key；程序客户端可能伪造 Origin，因此固定上游、接口范围及限流始终生效。
- Cookie、Origin、本机配对凭据和任意转发头均不发给上游；不跟随跳转，不接受目标 URL、查询参数或编码路径。返回头只保留必要内容头、请求编号和重试提示，并设 `no-store`。
- 用户已确认来源 IP 的原生限流阈值为每分钟 120 次，包含模型列表、生成提交与轮询。Cloudflare 按边缘节点近似计数，不是严格全球总额或计费额度；共享 IP 会共享阈值。超限在转发前返回 429，不自动重新生成。未新增超时、大小或并发参数；平台现有约束仍适用。
- 转发前拒绝标记为未提交；转发失败或跳转视为结果未知，不自动切到直连、本机代理或另一次付费请求。

## 部署

```bash
npm ci --prefix cloudflare/gateway
cd cloudflare/gateway
npm run types
npx wrangler deploy --dry-run
npm run deploy
```

配置仅包含公开账号、来源与限流参数，无渠道 Token。源为新站点时，先更新 `ALLOWED_ORIGINS` 再部署；不要允许通配预览域名。固定预览地址为 `https://dianran-preview-kobingogos-projects.vercel.app`，避免每次部署更换来源后重新配置 Key。

主站目前仍在 Vercel，本 Worker 不修改生产 DNS、主站发布、R2、个人作品和本地 Agent。生产启用须与对应前端一起发布。未配置构建变量的自部署版本仍保持原调用路径。

第三方下载域名不在本轮转发范围内；如果渠道视频结果的下载域名不允许浏览器跨域，需核验实际域名后单独设计下载通路，不可开放任意 URL 或自动扩大授权。本轮不承诺所有服务商、模型协议及媒体下载均已真实验证。

## 验证

模块检查在 `web/tests/model-gateway.test.mjs`，覆盖固定上游、来源／方法／路径／请求头拒绝、流式响应、multipart 原始字节、限流零转发、跳转与失败不重试、配对凭据隔离和请求结果归类。`model-gateway-regression.js` 在启用构建变量的独立浏览器验证隐私说明、经云端读取模型、额外模型选择及零本机代理／生成请求。使用固定测试 Token，真实生成待用户验收。
