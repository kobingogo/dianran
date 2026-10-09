# 主要用户流程交互验收

本手册用于隔离浏览器中的实际交互验收。已有模块检查、局部回归和真实 PNG 产物是不同证据，不能互相替代。本轮先使用模拟渠道完成不收费路径，再保留需要真实账户、设备、服务或用户参与的外部验收。

只在专用浏览器会话及测试来源运行；不要访问或关闭用户的 `localhost:3000` 页面。测试素材、项目、配置和诊断记录均在隔离来源创建，不使用用户作品。原生 Agent 生成需要额外额度授权，本手册的模拟阶段不调用它。

## 环境与证据

从项目根目录启动隔离开发服务，不执行构建或类型检查：

```bash
cd /Users/bingo/workspace/dianran/web
./node_modules/.bin/vite --host 127.0.0.1 --port 4317 --strictPort
```

另一个终端打开专用浏览器会话：

```bash
cd /Users/bingo/workspace/dianran
/Users/bingo/.codex/skills/playwright/scripts/playwright_cli.sh -s=dianran-major-flow open http://127.0.0.1:4317/
```

该会话不要混入用户标签页。首次页面确认拥有编辑权；如只读，查明同一测试来源的另一测试页是否占用，不关闭用户浏览器。每个流程记录：步骤、预期、实际结果、通过/失败/未测/等待条件/结果未知、截图、请求方法与次数、项目/任务身份、保存与刷新结果。导出证据不记录真实 Key、令牌、请求头或完整提示词。失败后停止依赖该步骤的操作，不把后续没有执行写成通过。

先运行网络替身，再操作生成按钮。以下代码可在新会话首页直接运行，生成只返回合成 PNG；模拟视频用于任务恢复，不包含可播放视频。模板和参数可以核对，不能据此判断真实模型质量。

```bash
/Users/bingo/.codex/skills/playwright/scripts/playwright_cli.sh -s=dianran-major-flow run-code "$(cat <<'JS'
async (page) => {
  const origin = 'http://127.0.0.1:4317';
  if (new URL(page.url()).origin !== origin) throw Error('必须使用隔离来源');
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
  const calls = [];
  await page.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin === origin || !['http:', 'https:'].includes(url.protocol)) return route.continue();
    if (url.origin !== 'https://major-flow-mock.example') return route.abort('blockedbyclient');
    if (request.method() === 'OPTIONS') return route.fulfill({status:204,headers:{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'*','Access-Control-Allow-Methods':'*'}});
    calls.push({method:request.method(),path:url.pathname});
    const headers = {'Access-Control-Allow-Origin':'*'};
    if (url.pathname.endsWith('/models')) return route.fulfill({headers,contentType:'application/json',body:JSON.stringify({data:[{id:'gpt-image-1'},{id:'sora-2'}]})});
    if (url.pathname.includes('/images/')) return route.fulfill({headers,contentType:'application/json',body:JSON.stringify({data:[{b64_json:png}]})});
    if (url.pathname.endsWith('/videos') && request.method() === 'POST') return route.fulfill({headers,contentType:'application/json',body:JSON.stringify({id:'major-flow-video-task',status:'queued'})});
    if (url.pathname.includes('/videos/') && request.method() === 'GET') return route.fulfill({status:503,headers,contentType:'application/json',body:JSON.stringify({error:{message:'模拟查询中断，保留原任务'}})});
    return route.fulfill({status:400,headers,contentType:'application/json',body:JSON.stringify({error:{message:'本次替身不支持该接口，未请求真实服务'}})});
  });
  // 网络计数只留方法和路径；不记录请求正文或授权头。
  page.__majorFlowCalls = calls;
  return {mockInstalled:true,provider:'https://major-flow-mock.example/v1',key:'mock-key',externalRequestsBlocked:true};
}
JS
)"
```

使用设置 UI 创建测试渠道，地址为 `https://major-flow-mock.example/v1`，Key 为 `mock-key`，协议为 OpenAI 兼容；读取模型后分别核对图片/视频能力并选择模型。如当前模型清单不能自动判断能力，按页面现有编辑入口明确设为图片或视频，不将模型名字推断为实测成功。查询计数：

```bash
/Users/bingo/.codex/skills/playwright/scripts/playwright_cli.sh -s=dianran-major-flow run-code 'async page => page.__majorFlowCalls || []'
```

网络替身属于当前测试页。打开第二页、重新创建页或运行其他专项脚本时，必须在对应页重新安装替身。其他专项有自己的 `.example` 路由替身，不要和本节通用拦截器叠加；使用另一个专用会话重放。该阻断策略还会阻止外部素材 CDN，因此提示词资源图片需要独立只读替身，不能把拦截导致的图片缺失当成已完成真实 CDN 验收。

## F01 首次入口、设置与能力状态

| 步骤 | 操作 | 预期与证据 |
| --- | --- | --- |
| 1 | 从隔离首页进入设置，先观察没有模型配置的状态 | 未配置不显示已连接/已生图成功；未发生成请求 |
| 2 | 通过 UI 新增上述模拟渠道，填写 Key 和地址，保存 | 页面保留配置；刷新后可读取；Key 不出现在能力文案和诊断导出中 |
| 3 | 点击读取模型，选择图片与视频模型 | 模型清单与配置状态分别表达；只有读取模型不算成功生成 |
| 4 | 回首页、图片页、视频页，切换对应模型 | 四处能力状态与所选模型一致；其他模型或渠道的成功记录不能借用 |
| 5 | 修改测试渠道地址或 Key，再返回原值 | 原证据应失效或重新核验；不会自动生成来探测能力 |

前置：通用网络替身。已有 `request-readiness.test.mjs` 和 `t09-t11-browser-check.js` 的部分覆盖；首次引导、渠道 CRUD 和跨页状态需本轮 UI 走查。

## F02 图片创作、保存与过程投递

| 步骤 | 操作 | 预期与证据 |
| --- | --- | --- |
| 1 | 图片工作台选择「模型 API」，输入测试提示词、添加本地 PNG 参考图 | 参考图可预览/移除；输入不发生成请求 |
| 2 | 选择模型与参数，点击生成 | 每个槽位的请求按当前计划发送；返回模拟图片；结果有实际保存身份 |
| 3 | 修改当前草稿，查看原结果创作详情 | 原结果仍保留原提交提示词、参数和参考图，不能被新草稿替换 |
| 4 | 将结果保存到素材，下载，再刷新图片页 | 保存失败不能提示成功；素材可再次找到；下载文件可读取；刷新不重提 |
| 5 | 点击送入画布，先仅结果，再选择连同创作过程 | 结果可补齐过程；原参考图、配置、结果及连线完整；重复投递不重复落图 |
| 6 | 在画布核对尺寸、原图和输入关系 | 保持原始图片比例；关系与原提交一致；刷新仍存在 |

前置：合成 PNG、通用替身，已配置测试渠道。对应 `delivery-regression.js`、`canvas-delivery.test.ts`；素材 UI、下载后重读和完整新用户输入仍需补齐。

## F03 图片失败、未知结果与原快照新请求

| 步骤 | 操作 | 预期与证据 |
| --- | --- | --- |
| 1 | 使用专项替身令第一次图片响应返回 HTTP 500 | 槽位显示结果未知与新建生成请求；原请求可能已接受；不会自动重提 |
| 2 | 修改当前提示词、数量和尺寸，再点击原结果的新建生成请求 | 先弹可能再次计费确认；确认前仍只有一次请求；确认后第二次使用原提交快照，出现成功结果 |
| 3 | 用页面路由中断模拟已发送请求的响应 | 状态为结果未知，不能声称渠道拒绝或未执行 |
| 4 | 刷新，再查看记录 | 不自动重提未知请求；用户能区分查看、恢复与新生成 |
| 5 | 在发送前注入引用/意图保存失败 | 零生成请求；任务终结为未提交，不遗留运行中 |

`retry-regression.js` 等待页面取得编辑权，覆盖第 1–2 步：HTTP 500 保持结果未知，必须经过费用确认才创建第二次请求，第二次仍使用原提示词、原 1 张/1024x1024 快照并显示成功结果。此流程是明确的新请求，不是查询或重提原远端任务。其他未知响应与发送前失败仍需相应 UI 故障注入与请求计数。注入只能在专用页进行，恢复原方法后再开展其他场景；断网不能模拟 IndexedDB 保存失败。

## F04 视频任务创建与原任务恢复

| 步骤 | 操作 | 预期与证据 |
| --- | --- | --- |
| 1 | 视频工作台填写提示词和参考图，提交模拟视频任务 | 创建 POST 取得原任务 ID；ID 先保存，再查询 |
| 2 | 查询返回模拟中断 | ID 和原渠道保留；查询失败不等于视频生成失败 |
| 3 | 进入画布或刷新，再点击恢复/查询原任务 | 仅查询 GET；创建 POST 次数不增加；原提示词和任务身份不变 |
| 4 | 修改原渠道地址后尝试恢复 | 明确阻止错误渠道查询；不自动切换渠道 |
| 5 | 注入 ID 回执保存失败 | 展示可抢救的原任务 ID；不开始未受保护的轮询或重复创建 |

对应 `video-recovery-regression.js`、`request-readiness.test.mjs`。本节模拟不覆盖视频播放、下载、音轨、完成产物导入；这些要准备合规本地 MP4 替身或在获准真实渠道上验收。

## F05 画布编辑、工作流与撤销

| 步骤 | 操作 | 预期与证据 |
| --- | --- | --- |
| 1 | 通过 UI 新建画布，添加文本、配置、参考图，连接节点 | 节点身份独立；输入关系正确；拖动、等比缩放和选区正常 |
| 2 | 复制组及其中带任务状态的节点 | 复制关系重映射；复制体不继承原生成中状态或视频任务 ID；原体不变 |
| 3 | 预览工作流，核对步骤、模型、参数、数量和输入 | 预览不提交；按显式关系排列；原作品不改动 |
| 4 | 明确确认后执行模拟两步生成 | 第一产物作为第二步输入；每步先保存状态；原节点保留 |
| 5 | 某一步失败或未知后中断并刷新 | 已成功步骤不重提；未知结果先核实；下游停止 |
| 6 | 审阅 Agent 计划，只预览，再退出 | 不添加节点、不调用生成；确认才进入同一执行路径 |
| 7 | Agent 修改后新增用户编辑，再尝试撤销旧操作 | 修订不匹配则拒绝恢复旧快照，保留新编辑 |

对应 `copy-regression.js`、`workflow-regression.js`、`agent-plan-regression.js`、`agent-ops-validation.test.mjs`。第 1 步的全部 UI 操作、失败后继续和实际撤销按钮需补充走查，不能以直接 store 注入替代。

## F06 素材管理与存储故障

| 步骤 | 操作 | 预期与证据 |
| --- | --- | --- |
| 1 | 素材页通过 UI 新增文本和本地图片 | 完成持久化才提示已保存；刷新可读取 |
| 2 | 修改标题/标签，搜索、筛选，再使用到创作或画布 | 选中的是目标素材；原文件可读，修改不会串到其他素材 |
| 3 | 删除一项仍被画布/模板引用的素材，执行清理 | 清理不误删仍有引用的原文件；无引用文件按现有规则处理 |
| 4 | 在隔离页注入保存失败后再次新增 | 显示失败与抢救入口；保留原输入，不伪装成功 |
| 5 | 恢复存储后点击重试，刷新 | 只保存原操作，不重新生成；记录不重复 |

对应 `asset-save.test.mjs`、`asset-rescue.test.mjs`、`media-cleanup.test.mjs`，目前没有完整素材页 UI 脚本。视频/音频素材需另外准备本地有效文件，不能用字符串 Blob 冒充可播放媒体。

## F07 作品保全、ZIP 恢复与编辑权交接

| 步骤 | 操作 | 预期与证据 |
| --- | --- | --- |
| 1 | 保存含图片、参数、关系和来源的画布；注入下一次保存失败 | 页面明确未保存；内存中的最新作品仍可查看 |
| 2 | 导出作品 ZIP，恢复存储后重试保存 | 下载文件真实可读；重试保存最新状态；刷新仍是最新作品 |
| 3 | 在第二个空浏览器上下文打开同一测试来源并通过 UI 导入 ZIP | 空环境无需原 IndexedDB；原图、比例、关系、创作快照和来源可重建 |
| 4 | 尝试缺件/校验错误 ZIP，再试明确标记的抢救包 | 损坏完整包在写入前拒绝；抢救包须用户确认，不覆盖既有作品 |
| 5 | 同上下文另开一页，修改只读页 | 写入和生成拒绝，不能越过编辑权 |
| 6 | 写入页保存并释放，另一页取得编辑权 | 重新读取作品、素材、草稿和媒体回执；不能沿用旧内存 |
| 7 | 再注入保存失败，尝试释放 | 保留编辑权；原页关闭后另一页才可重新获取 |

第 3 步必须使用独立 BrowserContext 或另一个明确未共享存储的浏览器配置文件；同一上下文 `newPage()` 不能证明空环境恢复。当前 ZIP 完整性检查在 `canvas-archive.test.mjs`；下载与保存故障在 `reliability-regression.js`；跨页交接在 `t04-browser-check.js`。空环境 UI 导入仍需本轮实际执行。

## F08 模板、候选比较、插件和设置

| 步骤 | 操作 | 预期与证据 |
| --- | --- | --- |
| 1 | 选择活动海报，填内容，创建并审阅 | 内容写入目标节点；三步四次逻辑请求；预览零调用 |
| 2 | 创建产品模板，分别不上传和上传参考图 | 缺参考图阻止创建；正确原比例、独立身份和输入连线；一致性需真实模型评估 |
| 3 | 在模拟候选组采用另一张主图，关闭弹窗再操作画布 | 原组 primary 更新、失败槽位可辨；弹层操作不触发画布拖动 |
| 4 | 安装测试插件，查看 URL、源码和摘要后取消 | 插件零执行；明确批准/来源变化重新审阅需另测 |
| 5 | 设置中查看本地存储说明；选择开启诊断、导出、停止、删除 | 未默认记录或上传；导出不含 Key/提示词/作品；停止后不再记录 |
| 6 | 使用专用 WebDAV 两端产生冲突，查看部分结果与恢复备份 | 编辑副本均保留，CAS 冲突不覆盖；不支持条件写的服务明确拒绝 |

对应 `t09-t11-browser-check.js`、`t06-t13-browser-check.js`、`app-sync.test.mjs`。WebDAV 真实端配置、其他模板、正向插件授权和更新审阅尚需专项 UI 验收。

## F09 本机 Agent 交互与媒体恢复：先替身后真实账户

| 步骤 | 不收费前置与操作 | 预期与证据 |
| --- | --- | --- |
| 1 | 使用隔离 Agent HTTP/SSE 替身，连接页面；不要启动真实 Codex turn | 连接、模型清单与工具状态分别呈现；令牌错误不能连接 |
| 2 | 图片工作台切换本机 Agent，选择原项目跳转 | 提示词/参考图保留；打开媒体页签；跳转零生成 |
| 3 | 替身返回模型目录与未验证能力，未选模型先尝试提交，再取消验证授权 | 不能使用 CLI 默认模型；取消零提交；列出模型不等于账户可调用 |
| 4 | 明确选择模型、允许本次替身任务，返回已登记合成 PNG | 顺序为意图持久化→画布状态同步→提交；正确模型、项目与修订进入请求 |
| 5 | 下载期间切换画布，再导入 | 仍写原项目；保留原项目后续编辑；当前新项目不受影响 |
| 6 | 注入保存失败，恢复后重试导入并刷新 | 原任务不重提、原图不重复上传/落图；真实保存后才写回执 |
| 7 | 替身发结构化问题、标准 MCP 表单和 URL 确认 | 可选择/补充/取消；格式与范围校验；仅打开 URL 不自动接受 |
| 8 | 在问题未答期间刷新、切线程、中断、服务重启，第二页迟到回答 | pending 只恢复原 thread/turn/request；过期请求清除；不串答或重复提交 |
| 9 | 替身发外部产物登记，先拒绝，再授权指定生产目录与文件 | 文件读取始终专属授权；批准后才 claim/validate/register；完整性与原项目保存复用同一链路 |
| 10 | 批准前切换 A→B→A，或编辑原项目；直接伪造登记/回执 | 旧修订、未领取请求和篡改输入拒绝，已有作品不覆盖 |

这组完整浏览器替身尚无一键脚本，需补充 HTTP/SSE 测试服务与明确的假 app-server，不能把真实本机服务直接当作不收费替身。`http-ag.test.ts`、`media-routes.test.ts` 已提供隔离 `persist:false`、随机端口、原任务和授权输入的复现参考；测试服务不得暴露公开访问，也不得连接真实生图 turn。

真实生图与编辑已有独立 HTTP 产物证据，不能据此把以上浏览器链路全部勾为通过。当前账户额度状态及外部插件安装仍需实际条件，未获条件时标记等待，不追加收费尝试。

## 现有专项重放命令

以下脚本是 `async(page) => ...` 函数，必须通过 Playwright CLI `run-code`，不是 `node file.js`。在独立的 4317 会话运行，避免通用拦截器干扰专项自己注册的网络替身：

```bash
/Users/bingo/.codex/skills/playwright/scripts/playwright_cli.sh -s=dianran-regression open http://127.0.0.1:4317/
/Users/bingo/.codex/skills/playwright/scripts/playwright_cli.sh -s=dianran-regression run-code "$(cat /Users/bingo/workspace/dianran/output/playwright/retry-regression.js)"
/Users/bingo/.codex/skills/playwright/scripts/playwright_cli.sh -s=dianran-regression run-code "$(cat /Users/bingo/workspace/dianran/output/playwright/delivery-regression.js)"
/Users/bingo/.codex/skills/playwright/scripts/playwright_cli.sh -s=dianran-regression run-code "$(cat /Users/bingo/workspace/dianran/output/playwright/workflow-regression.js)"
/Users/bingo/.codex/skills/playwright/scripts/playwright_cli.sh -s=dianran-regression run-code "$(cat /Users/bingo/workspace/dianran/output/playwright/video-recovery-regression.js)"
/Users/bingo/.codex/skills/playwright/scripts/playwright_cli.sh -s=dianran-regression run-code "$(cat /Users/bingo/workspace/dianran/output/playwright/reliability-regression.js)"
/Users/bingo/.codex/skills/playwright/scripts/playwright_cli.sh -s=dianran-regression run-code "$(cat /Users/bingo/workspace/dianran/output/playwright/copy-regression.js)"
/Users/bingo/.codex/skills/playwright/scripts/playwright_cli.sh -s=dianran-regression run-code "$(cat /Users/bingo/workspace/dianran/output/playwright/agent-plan-regression.js)"
```

专项之间如残留弹窗、网络路由或故障注入，先关闭该测试会话并另开专用会话重放，不影响用户浏览器。部分脚本直接写 store 或触发 Agent 队列，它们的通过只证明该局部交互，不能替代本手册从入口填写的步骤。

| 脚本 | 来源/准备 | 对应流程与限制 |
| --- | --- | --- |
| `web/tests/t04-browser-check.js` | 独立 `localhost:3001`，同上下文两页，一页拥有编辑权 | F07；会关闭自己的测试 writer 页，不能混入用户页 |
| `web/tests/t05-browser-check.js` | 3001 配置页面，已运行配对代理与模拟 provider | 设置代理、SSE/请求转发/配置导出；不是无前置的一键测试 |
| `web/tests/t06-t13-browser-check.js` | 3001 已加载应用、拥有编辑权 | F08 候选采用与插件取消，自动创建合成工程 |
| `web/tests/t09-t11-browser-check.js` | 3001 画布模板列表，拥有编辑权 | F08 海报预览、存储说明与本地诊断；模拟模型不收费 |
| `web/tests/t15-browser-check.js` | 独立 `localhost:3002`，拥有编辑权 | 合成典型/重度工程拖动、保存、ZIP；不是实际设备生产基线 |
| `web/tests/t15-zip-comparison.js` | 同 3002，先完成 T15 基线产生工程与依赖 | 同快照 ZIP Worker 比较；衡量主线程响应，不承诺总时长稳定降低 |

3001 或 3002 专项按对应端口另启动隔离 Vite 服务。例如：

```bash
cd /Users/bingo/workspace/dianran/web
./node_modules/.bin/vite --host 127.0.0.1 --port 3001 --strictPort
```

另开会话并先进入指定来源：

```bash
/Users/bingo/.codex/skills/playwright/scripts/playwright_cli.sh -s=dianran-special open http://localhost:3001/canvas
/Users/bingo/.codex/skills/playwright/scripts/playwright_cli.sh -s=dianran-special run-code "$(cat /Users/bingo/workspace/dianran/web/tests/t06-t13-browser-check.js)"
```

如果系统只监听 IPv4，请确保 `localhost` 正确解析到已监听地址，或使用该机器既有可用的开发服务监听方式；不自行替换脚本中的 origin 后把来源不同的存储当作同一环境。

模块行为检查可单独执行，不会自动覆盖浏览器步骤：

```bash
cd /Users/bingo/workspace/dianran
node --experimental-strip-types --test web/tests/*.test.mjs
canvas-agent/node_modules/.bin/tsx --test canvas-agent/src/agent/codex-client.test.ts canvas-agent/src/canvas/session.test.ts canvas-agent/src/canvas/operations.test.ts canvas-agent/src/agent/media-registry.test.ts canvas-agent/src/server/media-routes.test.ts canvas-agent/src/server/http-ag.test.ts
```

其余 Bun 专用测试仅在当前环境实际具备 Bun 时执行，不能据未执行测试声称通过。本手册不要求语法检查、类型检查、构建或发布。

## 真实外部待验收

- 图片、视频、文本、音频各实际渠道的授权、参数、质量、产物、未知结果和计费；按 [T12 验收矩阵](T12-ACCEPTANCE-MATRIX.md) 记录，需用户提供渠道和预算。
- 本机 Codex 当前账户模型与额度，网页完整原生生图/编辑，以及用户实际安装点染插件后的外部产物授权流程；不自动重试额度错误。
- WebDAV 的实际服务端 ETag/条件写与双端恢复，配对代理在真实浏览器本地访问授权下的表现。
- 手机/平板、弱网和目标规模工程，Docker/生产静态路径、Worker 打包/CSP，以及后续域名来源下本地数据隔离与迁移说明。
- 真实用户完成任务、哪里需要帮助、成功采用结果的原因；自愿本地诊断不等于已完成用户研究。
- Grok Build、第二真实 Agent 与生视频工具能力；目前契约替身通过不能写成真实平台已经接入。

## 步骤结果模板

| 流程/步骤 | 环境与前置 | 实际动作 | 预期 | 实际结果 | 状态 | 保存/刷新/恢复 | 网络方法与次数 | 证据位置 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Fxx / n | 测试来源、浏览器、模拟/真实 | 本次实际操作 | 本手册标准 | 观察值或错误 | 未测/等待/通过/失败/未知 | 核对值 | 无请求或计数 | 截图/下载/脱敏记录 |

本手册创建本身不代表完成验收。每项只按实际观察更新结果，真实条件未具备的步骤保持等待；修复后重测受影响流程及其保存/恢复路径。
