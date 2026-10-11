# T05 本地代理授权验收

## 当前交付

T05 已实现，位于 `codex/work-preservation` 工作区，尚未提交或合并。代理协议为 2，配套软件包为 `@kobinflow/canvas-proxy@0.2.0`；本机软件包见 `output/packages/kobinflow-canvas-proxy-0.2.0.tgz`。尚未发布 npm 或部署线上前端，发布时必须成对交付。

代理只监听回环地址，启动命令显式列出允许的网页来源和服务目标。浏览器导入本机配对文件并验证代理身份后连接；目标授权按协议、主机、端口及路径段核对。新增渠道、WebDAV 或下载服务地址需重新启动授权并导入新配对。

配对文件以当前用户可读写的权限创建，凭据每次启动重新生成。浏览器凭据独立保存在小型本地配置中，不进入普通配置分享、目标 URL、上游请求或代理日志。移除浏览器配对只清除该浏览器凭据；停止或重启代理使原进程凭据失效。

来源、凭据和目标均在转发前验证；OPTIONS 不授予调用权限。拒绝伪造 Host 和代理递归，保留渠道授权头、请求体与 SSE，移除浏览器 Cookie 和代理凭据。代理不跟随上游重定向，返回中文拒绝原因；错误响应不绕过目标授权。日志只记录方法、目标 origin、状态与耗时。

## 可复现行为检查

使用支持类型擦除的 Node 版本运行，无需构建前端：

```bash
node --experimental-strip-types --test canvas-proxy/proxy.test.mjs web/tests/local-proxy.test.mjs
```

12 项针对性检查通过，覆盖真实本机 HTTP 转发、未授权请求不触达上游、预检、路径边界、显式本地模型、重定向、SSE、渠道错误、日志与凭据隔离、CLI 私有文件和退出清理、前端配对及 Axios/fetch 处理。普通渠道错误，包括数字错误码及 Blob 响应，保留原有处理路径。损坏配对不阻止应用读取作品，只阻止未经授权的代理调用。

T01–T05 累计 48 项行为检查通过：

```bash
node --experimental-strip-types --test canvas-proxy/proxy.test.mjs web/tests/local-proxy.test.mjs web/tests/write-ownership.test.ts web/tests/write-barrier.test.mjs web/tests/canvas-archive.test.mjs web/tests/asset-save.test.mjs web/tests/asset-rescue.test.mjs web/tests/media-references.test.ts web/tests/media-cleanup.test.mjs
```

未执行语法检查、类型检查或构建。

## 独立浏览器检查

Chromium 在独立的 `http://localhost:3001` 页面检查，未修改用户 `localhost:3000` 页面，也未调用付费模型。复现时另开终端运行：

```bash
node canvas-proxy/browser-fixture.mjs
```

另开终端启动前端：

```bash
cd web
npm run dev -- --port 3001 --strictPort
```

在设置的「高级 → 本地代理」启用代理，导入测试终端输出路径对应的配对文件；测试终端不会输出凭据。独立 Playwright 页面可运行 `web/tests/t05-browser-check.js` 中的回调进行检查，结果见 `output/playwright/t05-check-result.txt`。

已验证配对与连接、实际模型列表 API、Axios POST、流式 fetch、WebDAV 下载、未授权目标拒绝、重定向拒绝，以及实际配置导出不含配对凭据。模拟浏览器阻断本地请求后，页面提示检查进程、来源授权和站点「本地网络访问」权限；解除阻断后可恢复连接。真实操作系统或浏览器权限对话框仍需人工确认。

## 用户待验收与发布依赖

- 真实渠道的生图、文本流、音频、视频创建与恢复查询；真实图片、视频和参考素材下载。额外下载域名必须授权，包含 CDN 重定向的下载当前会拒绝，不能误认为全部下载渠道已验证。
- 真实 WebDAV 连接和同步，正式 HTTPS 站点访问回环代理，目标浏览器的允许、拒绝与重新允许流程。
- 启动新代理、导入配对、修改渠道地址后重新授权，以及移除或损坏配对的恢复提示。
- 审阅并发布配套 npm 包与前端，说明旧开放代理不兼容新协议，并保留成对回退方式；当前本地开发使用源码命令，见 `canvas-proxy/README.md`。

浏览器中的 AI API Key 仍按现有设计存储，前端直连渠道或经授权本地代理转发。本轮没有建立脚本沙箱；用户脚本具有高权限，插件执行前授权与辅助 HTTP 跨站渠道 Key 范围由 T06 继续收敛。没有新增超时、重试、大小或并发限制。
