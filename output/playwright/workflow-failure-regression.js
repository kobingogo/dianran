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
  const calls=[];
  let phase='setup';
  try{
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
  await page.route('**/*', route=>{const u=new URL(route.request().url());return [base,'https://mock.example'].includes(u.origin)||!['http:','https:'].includes(u.protocol)?route.continue():route.abort('blockedbyclient');});
  await page.unroute('https://mock.example/**');
  await page.route('https://mock.example/**', async (route) => {
    const request = route.request();
    if (request.method() === 'OPTIONS') return route.fulfill({status:204,headers:{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'*','Access-Control-Allow-Methods':'*'}});
    if (!request.url().includes('/images/')) throw new Error('Unexpected model route ' + request.url());
    calls.push({method:request.method(),url:request.url()});
    if(calls.length===2)return route.fulfill({status:400,contentType:'application/json',body:JSON.stringify({error:{message:'Fixture rejected second-step parameters'}}),headers:{'Access-Control-Allow-Origin':'*'}});
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
  phase='initial failure';await page.waitForFunction(id=>window.__failureCanvas.getState().openProject(id).workflowRuns?.some(r=>r.steps[1].status==='failed'),id);
  const stopped=await page.evaluate(async id=>{const {flushCanvasSave}=await import('/src/stores/canvas/use-canvas-store.ts');await flushCanvasSave();return window.__failureCanvas.getState().openProject(id).workflowRuns[0];},id);
  if(stopped.steps.map(s=>s.status).join()!=='succeeded,failed,pending'||calls.length!==2)throw Error('Failure did not stop downstream');
  const firstResult=stopped.steps[0].resultIds[0];
  await page.reload();await waitForWriter();
  await page.getByRole('button',{name:'工作流',exact:true}).click();
  await page.getByText('画布工作流 · 成功 → 失败 → 未执行',{exact:true}).waitFor();
  await page.getByRole('button',{name:'核对已有结果并继续',exact:true}).click();
  await page.getByText('画布工作流 · 成功 → 失败 → 未执行',{exact:true}).waitFor();
  const current=await page.evaluate(async({id,firstResult})=>{
    const {flushCanvasSave}=await import('/src/stores/canvas/use-canvas-store.ts');await flushCanvasSave();
    const p=window.__failureCanvas.getState().openProject(id),n=p.nodes.find(n=>n.id===firstResult);
    const {getImageBlob}=await import('/src/services/image-storage.ts');
    if(!n?.metadata.storageKey||!await getImageBlob(n.metadata.storageKey))throw Error('Successful upstream original was lost');
    return{runId:p.workflowRuns[0].id,statuses:p.workflowRuns[0].steps.map(s=>s.status),firstResult,originalNodes:p.nodes.filter(n=>['first','second','third'].includes(n.id)).length};
  },{id,firstResult});
  if(current.runId!==stopped.id||current.statuses.join()!=='succeeded,failed,pending'||current.originalNodes!==3||calls.length!==2)throw Error('Refresh or reconcile replayed a started request');
  const failed=await page.evaluate(id=>window.__failureCanvas.getState().openProject(id).nodes.find(n=>n.type==='image'&&n.metadata?.status==='error'),id);
  if(!failed)throw Error('Failed step has no recoverable result node');
  await page.getByRole('dialog').locator('button.ant-modal-close').click();
  const expand=page.getByRole('button',{name:'展开面板',exact:true});if(await expand.isVisible())await expand.click();
  await page.locator('aside').getByRole('button',{name:failed.title+' 图片',exact:true}).click();
  const result=page.locator(`[data-node-id="${failed.id}"]`);
  await page.waitForTimeout(500);
  await page.screenshot({path:'output/playwright/evidence/workflow-retry-focus.png'});
  await page.getByRole('button',{name:'重新生成',exact:true}).click();
  let confirmation=page.getByRole('dialog',{name:'创建新的生成请求',exact:true});
  await confirmation.getByRole('button',{name:'先不提交',exact:true}).click();await confirmation.waitFor({state:'hidden'});
  if(calls.length!==2)throw Error('Cancelled retry submitted a request');
  await page.getByRole('button',{name:'重新生成',exact:true}).click();
  await confirmation.getByRole('button',{name:'新建请求',exact:true}).click();await confirmation.waitFor({state:'hidden'});
  phase='retry result';await page.waitForFunction(({id,nodeId})=>window.__failureCanvas.getState().openProject(id).nodes.find(n=>n.id===nodeId)?.metadata.status==='success',{id,nodeId:failed.id});
  if(calls.length!==3)throw Error('Retry did not submit exactly one new request');
  await page.getByRole('button',{name:'工作流',exact:true}).click();
  await page.getByRole('button',{name:'核对已有结果并继续',exact:true}).click();
  phase='continue downstream';await page.waitForFunction(id=>window.__failureCanvas.getState().openProject(id).workflowRuns[0].steps.every(s=>s.status==='succeeded'),id);
  const completed=await page.evaluate(async({id,firstResult,failedId})=>{
    const {flushCanvasSave}=await import('/src/stores/canvas/use-canvas-store.ts');await flushCanvasSave();
    const p=window.__failureCanvas.getState().openProject(id),r=p.workflowRuns[0];
    if(r.steps[0].resultIds[0]!==firstResult||r.steps[1].resultIds[0]!==failedId||r.steps[2].resultIds.length!==1)throw Error('Resume replaced earlier result identities');
    return{runId:r.id,statuses:r.steps.map(s=>s.status),resultIds:r.steps.map(s=>s.resultIds),nodes:p.nodes.length};
  },{id,firstResult,failedId:failed.id});
  if(calls.length!==4||completed.runId!==stopped.id)throw Error('Resume replayed upstream or changed the original run');
  await page.waitForFunction(()=>Array.from(document.querySelectorAll('button')).some(b=>b.textContent==='预览全部步骤'&&!b.disabled));
  await page.evaluate(async()=>{await(await import('/src/stores/canvas/use-canvas-store.ts')).flushCanvasSave();await(await import('/src/features/tasks/task-store.ts')).flushTaskSave();});
  phase='fresh document';
  const verification=await page.context().newPage();
  try{
    await verification.route('**/*',route=>{const r=route.request(),u=new URL(r.url());if(u.origin===base||!['http:','https:'].includes(u.protocol))return route.continue();if(r.method()==='POST')calls.push({method:r.method(),url:r.url()});return route.abort('blockedbyclient');});
    await verification.goto(base+'/canvas/'+id);
    await verification.getByRole('button',{name:'工作流',exact:true}).click();
    await verification.getByText('画布工作流 · 成功 → 成功 → 成功',{exact:true}).waitFor();
    if(calls.length!==4)throw Error('Completed workflow was resubmitted on fresh load');
  }finally{await verification.close();}
  return{preview:'zero requests',calls:calls.map(c=>({method:c.method,path:new URL(c.url).pathname})),afterFailure:current,cancelledRetry:'zero additional requests',explicitRetry:'one new request, same result node',continued:completed,refresh:'failed run retained without resubmit',freshLoad:'completed run persisted without new request',syntheticProvider:true};
  }catch(error){await page.screenshot({path:'output/playwright/evidence/workflow-recovery-failure.png'});const diagnostics=await page.evaluate(()=>{const p=window.__failureCanvas.getState().projects[0];return{steps:p?.workflowRuns?.[0]?.steps,nodes:p?.nodes.map(n=>({id:n.id,type:n.type,status:n.metadata?.status,error:n.metadata?.errorDetails,images:n.metadata?.images?.map(i=>({status:i.status,error:i.errorDetails})),model:n.metadata?.model}))};});throw Error(phase+': '+error.message+'; calls='+calls.length+'; '+JSON.stringify(diagnostics));}
}
