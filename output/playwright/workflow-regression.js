async (page) => {
  page.on("dialog", (dialog) => { if (dialog.type() === "beforeunload") void dialog.accept().catch(() => {}); });
  const base = 'http://127.0.0.1:4317';
  await page.goto(base + '/canvas');
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
  await page.unroute('https://mock.example/**');
  await page.route('https://mock.example/**', async (route) => {
    const request = route.request();
    if (request.method() === 'OPTIONS') return route.fulfill({status:204,headers:{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'*','Access-Control-Allow-Methods':'*'}});
    if (!request.url().includes('/images/')) throw new Error('Unexpected model route ' + request.url());
    calls.push({method:request.method(),url:request.url()});
    return route.fulfill({contentType:'application/json',body:JSON.stringify({data:[{b64_json:png}]}),headers:{'Access-Control-Allow-Origin':'*'}});
  });
  const id = await page.evaluate(async () => {
    const { useConfigStore, defaultConfig } = await import('/src/stores/use-config-store.ts');
    const config = {...defaultConfig,apiKey:'mock-key',channels:[{id:'mock',name:'mock',baseUrl:'https://mock.example/v1',apiKey:'mock-key',apiFormat:'openai',models:[{name:'gpt-image-1',capability:'image'}]}],model:'mock::gpt-image-1',imageModel:'mock::gpt-image-1'};
    useConfigStore.setState({config});
    const {useCanvasStore,flushCanvasSave} = await import('/src/stores/canvas/use-canvas-store.ts');
    if (!useCanvasStore.getState().hydrated) await useCanvasStore.persist.rehydrate();
    const id = useCanvasStore.getState().createProject('工作流浏览器回归');
    useCanvasStore.getState().updateProject(id,{nodes:[
      {id:'first',type:'config',title:'第一步',position:{x:80,y:80},width:250,height:220,metadata:{generationMode:'image',prompt:'原始海报',composerContent:'原始海报',model:'mock::gpt-image-1',count:1,status:'idle'}},
      {id:'second',type:'config',title:'第二步',position:{x:440,y:80},width:250,height:220,metadata:{generationMode:'image',prompt:'@[node:first] 改为水墨',composerContent:'@[node:first] 改为水墨',model:'mock::gpt-image-1',count:1,status:'idle'}}
    ],connections:[{id:'input',fromNodeId:'first',toNodeId:'second',kind:'input'}]});
    await flushCanvasSave(); return id;
  });
  await page.goto(base + '/canvas/' + id);
  await page.locator('[data-node-id="first"]').waitFor();
  await page.evaluate(() => { document.activeElement?.blur(); window.getSelection()?.removeAllRanges(); });
  await page.keyboard.press('Control+a');
  await page.getByRole('button',{name:'工作流',exact:true}).click();
  await page.getByRole('button',{name:'预览选定节点',exact:true}).click();
  await page.getByText('2 步 · 共 2 次生成请求 · 费用由配置的渠道计费',{exact:true}).waitFor();
  if(calls.length) throw new Error('Preview submitted a paid request');
  await page.getByRole('button',{name:'保存为模板',exact:true}).click();
  await page.getByText('模板已保存到本机',{exact:true}).waitFor();
  await page.getByRole('button',{name:'确认执行此计划',exact:true}).click();
  await page.evaluate(async()=>{window.testCanvasStore=(await import('/src/stores/canvas/use-canvas-store.ts')).useCanvasStore;});
  await page.waitForFunction((id) => window.testCanvasStore.getState().openProject(id).workflowRuns?.some(run=>run.steps.every(step=>step.status==='succeeded')),id,{timeout:15000});
  const actualCalls=await page.evaluate(()=>window.workflowModelCalls);
  if(actualCalls.length!==2 || !actualCalls[0].url.endsWith('/images/generations') || !actualCalls[1].url.endsWith('/images/edits')) throw new Error('Workflow dependency requests incorrect: '+JSON.stringify(actualCalls));
  const summary = await page.evaluate(async(id)=>{
    const {useCanvasStore,flushCanvasSave} = await import('/src/stores/canvas/use-canvas-store.ts');
    await flushCanvasSave();
    const project=useCanvasStore.getState().openProject(id);
    return {nodes:project.nodes.length,steps:project.workflowRuns[0].steps.map(step=>step.status),original:project.nodes.filter(node=>['first','second'].includes(node.id)).map(node=>node.metadata.prompt)};
  },id);
  if(summary.original[0]!=='原始海报') throw new Error('Original overwritten');
  await page.reload();
  await page.getByRole('button',{name:'工作流',exact:true}).waitFor();
  await page.getByRole('button',{name:'工作流',exact:true}).click();
  await page.getByText('画布工作流 · 成功 → 成功',{exact:true}).waitFor();
  if((await page.evaluate(()=>window.workflowModelCalls)).length) throw new Error('Reload resubmitted paid generation');
  await page.screenshot({path:'output/playwright/evidence/workflow.png'});
  return {calls:actualCalls.map(call=>({method:call.method,url:call.url})),...summary,reload:'no new paid requests'};
}
