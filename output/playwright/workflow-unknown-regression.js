async (page) => {
  const waitForWriter = async () => {
    await page.evaluate(async () => {
      const path = '/src/lib/write-ownership.ts';
      const url = performance.getEntriesByType('resource').find(entry => new URL(entry.name).pathname === path)?.name || path;
      window.__dianranTestWriter = (await import(url)).writeOwnership;window.__failureCanvas=(await import(performance.getEntriesByType('resource').find(e=>new URL(e.name).pathname==='/src/stores/canvas/use-canvas-store.ts')?.name||'/src/stores/canvas/use-canvas-store.ts')).useCanvasStore;
    });
    await page.waitForFunction(() => window.__dianranTestWriter.canWrite()&&window.__failureCanvas.getState().hydrated);
  };
  page.on("dialog", (dialog) => { if (dialog.type() === "beforeunload") void dialog.accept().catch(() => {}); });
  const base = 'http://127.0.0.1:4317';
  await page.goto(base + '/canvas');
  await waitForWriter();
  const png = await page.evaluate(() => { const canvas = document.createElement('canvas'); canvas.width = 32; canvas.height = 32; canvas.getContext('2d').fillRect(0,0,32,32); return canvas.toDataURL('image/png').split(',')[1]; });
  await page.addInitScript(() => {
    if (window.workflowXHRInstalled) return;
    window.workflowXHRInstalled = true;
    window.workflowModelCalls = [];
    const open = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function(method, url, ...rest) {
      if (String(url).startsWith('https://mock.example/')) window.workflowModelCalls.push({method,url:String(url)});
      return open.call(this,method,url,...rest);
    };
  });
  const calls = [];
  await page.route('**/*', route=>{const u=new URL(route.request().url());return [base,'https://mock.example'].includes(u.origin)||!['http:','https:'].includes(u.protocol)?route.continue():route.abort('blockedbyclient');});
  await page.unroute('https://mock.example/**');
  await page.route('https://mock.example/**', async (route) => {
    const request = route.request();
    if (request.method() === 'OPTIONS') return route.fulfill({status:204,headers:{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'*','Access-Control-Allow-Methods':'*'}});
    if (!request.url().includes('/images/')) throw new Error('Unexpected model route ' + request.url());
    calls.push({method:request.method(),url:request.url()});
    if(calls.length===2)return route.abort('failed');
    return route.fulfill({contentType:'application/json',body:JSON.stringify({data:[{b64_json:png}]}),headers:{'Access-Control-Allow-Origin':'*'}});
  });
  const id = await page.evaluate(async () => {
    const { useConfigStore, defaultConfig } = await import('/src/stores/use-config-store.ts');
    const config = {...defaultConfig,apiKey:'mock-key',channels:[{id:'mock',name:'mock',baseUrl:'https://mock.example/v1',apiKey:'mock-key',apiFormat:'openai',models:[{name:'gpt-image-1',capability:'image'}]}],model:'mock::gpt-image-1',imageModel:'mock::gpt-image-1'};
    useConfigStore.setState({config});
    const {useCanvasStore,flushCanvasSave} = await import('/src/stores/canvas/use-canvas-store.ts');
    if (!useCanvasStore.getState().hydrated) await useCanvasStore.persist.rehydrate();
    const id = useCanvasStore.getState().createProject('工作流中途拒绝验收');
    useCanvasStore.getState().updateProject(id,{nodes:[
      {id:'first',type:'config',title:'第一步',position:{x:80,y:80},width:250,height:220,metadata:{generationMode:'image',prompt:'原始海报',composerContent:'原始海报',model:'mock::gpt-image-1',count:1,status:'idle'}},
      {id:'second',type:'config',title:'第二步',position:{x:440,y:80},width:250,height:220,metadata:{generationMode:'image',prompt:'@[node:first] 改为水墨',composerContent:'@[node:first] 改为水墨',model:'mock::gpt-image-1',count:1,status:'idle'}},
      {id:'third',type:'config',title:'第三步',position:{x:800,y:80},width:250,height:220,metadata:{generationMode:'image',prompt:'@[node:second] 添加光影',composerContent:'@[node:second] 添加光影',model:'mock::gpt-image-1',count:1,status:'idle'}}
    ],connections:[{id:'input',fromNodeId:'first',toNodeId:'second',kind:'input'},{id:'next-input',fromNodeId:'second',toNodeId:'third',kind:'input'}]});
    await flushCanvasSave(); return id;
  });
  await page.goto(base + '/canvas/' + id);
  await waitForWriter();
  await page.locator('[data-node-id="first"]').waitFor();
  await page.evaluate(() => { document.activeElement?.blur(); window.getSelection()?.removeAllRanges(); });
  await page.keyboard.press('Control+a');
  await page.getByRole('button',{name:'工作流',exact:true}).click();
  await page.getByRole('button',{name:'预览选定节点',exact:true}).click();
  await page.getByText('3 步 · 共 3 次生成请求 · API 按渠道计费，本机 Codex 按账户规则计费',{exact:true}).waitFor();
  if(calls.length) throw new Error('Preview submitted a paid request');
  await page.getByRole('button',{name:'确认执行此计划',exact:true}).click();
  await page.waitForFunction(id=>window.__failureCanvas.getState().openProject(id).workflowRuns?.some(r=>r.steps[1].status==='interrupted'),id);
  const stopped=await page.evaluate(async id=>{const {flushCanvasSave}=await import('/src/stores/canvas/use-canvas-store.ts');await flushCanvasSave();return window.__failureCanvas.getState().openProject(id).workflowRuns[0];},id);
  if(stopped.steps.map(s=>s.status).join()!=='succeeded,interrupted,pending'||calls.length!==2)throw Error('Failure did not stop downstream');
  const firstResult=stopped.steps[0].resultIds[0];
  await page.reload();await waitForWriter();
  await page.getByRole('button',{name:'工作流',exact:true}).click();
  await page.getByText('画布工作流 · 成功 → 中断待核实 → 未执行',{exact:true}).waitFor();
  await page.getByRole('button',{name:'核对已有结果并继续',exact:true}).click();
  await page.getByText('画布工作流 · 成功 → 中断待核实 → 未执行',{exact:true}).waitFor();
  const current=await page.evaluate(async({id,firstResult})=>{
    const {flushCanvasSave}=await import('/src/stores/canvas/use-canvas-store.ts');await flushCanvasSave();
    const p=window.__failureCanvas.getState().openProject(id),n=p.nodes.find(n=>n.id===firstResult);
    const {getImageBlob}=await import('/src/services/image-storage.ts');
    if(!n?.metadata.storageKey||!await getImageBlob(n.metadata.storageKey))throw Error('Successful upstream original was lost');
    return{runId:p.workflowRuns[0].id,statuses:p.workflowRuns[0].steps.map(s=>s.status),firstResult,originalNodes:p.nodes.filter(n=>['first','second','third'].includes(n.id)).length};
  },{id,firstResult});
  if(current.runId!==stopped.id||current.statuses.join()!=='succeeded,interrupted,pending'||current.originalNodes!==3||calls.length!==2)throw Error('Refresh or reconcile replayed a started request');
  const unknown=await page.evaluate(id=>window.__failureCanvas.getState().openProject(id).nodes.filter(n=>n.type==='image'&&n.metadata?.status==='error').map(n=>({id:n.id,error:[n.metadata.errorDetails,...(n.metadata.images||[]).map(i=>i.errorDetails)].join(' ')})),id);
  if(unknown.length!==1||!unknown[0].error.includes('结果未知'))throw Error('No unknown-result node was retained');
  await page.getByRole('dialog').locator('button.ant-modal-close').click();
  const expand=page.getByRole('button',{name:'展开面板',exact:true});if(await expand.isVisible())await expand.click();
  const title=await page.evaluate(({id,nodeId})=>window.__failureCanvas.getState().openProject(id).nodes.find(n=>n.id===nodeId).title,{id,nodeId:unknown[0].id});
  await page.locator('aside').getByRole('button',{name:title+' 图片',exact:true}).click();
  await page.locator(`[data-node-id="${unknown[0].id}"] [data-friendly-error="uncertain"]`).getByText('结果未知',{exact:true}).waitFor();
  const taskPhase=await page.evaluate(async nodeId=>(await import('/src/features/tasks/task-store.ts')).useTaskStore.getState().tasks.find(t=>t.nodeId===nodeId)?.phase,unknown[0].id);if(taskPhase!=='unknown')throw Error('Task center mislabeled unknown result: '+taskPhase);
  return{taskPhase,nodeMessage:'结果未知',afterFailure:current,unknown,calls:calls.length,syntheticProvider:true};
}
