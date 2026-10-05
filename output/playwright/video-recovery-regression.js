async (page) => {
  page.on('dialog', dialog => { if (dialog.type()==='beforeunload') void dialog.accept().catch(()=>{}); });
  const base='http://127.0.0.1:4317';
  await page.addInitScript(()=>{
    if(window.videoXHRInstalled) return;
    window.videoXHRInstalled=true;
    window.videoRecoveryCalls=[];
    window.videoNavigationEpoch=Math.random();
    const open=XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open=function(method,url,...rest){if(String(url).startsWith('https://video-mock.example/')) window.videoRecoveryCalls.push({method,url:String(url)});return open.call(this,method,url,...rest);};
  });
  const calls=[];
  await page.route('https://video-mock.example/**', async route=>{
    if(route.request().method()==='OPTIONS') return route.fulfill({status:204,headers:{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'*','Access-Control-Allow-Methods':'*'}});
    calls.push({method:route.request().method(),url:route.request().url()});
    return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:{message:'mock polling interruption'}}),headers:{'Access-Control-Allow-Origin':'*'}});
  });
  await page.goto(base+'/canvas');
  const id=await page.evaluate(async()=>{
    const {useConfigStore,defaultConfig}=await import('/src/stores/use-config-store.ts');
    useConfigStore.setState({config:{...defaultConfig,channels:[{id:'video',name:'mock',baseUrl:'https://video-mock.example/v1',apiKey:'mock-key',apiFormat:'openai',models:[{name:'sora-2',capability:'video'}]}],videoModel:'video::sora-2'}});
    const {useCanvasStore,flushCanvasSave}=await import('/src/stores/canvas/use-canvas-store.ts');
    if(!useCanvasStore.getState().hydrated) await useCanvasStore.persist.rehydrate();
    const id=useCanvasStore.getState().createProject('远端任务恢复');
    useCanvasStore.getState().updateProject(id,{nodes:[{id:'video-task',type:'video',title:'未完成视频',position:{x:80,y:80},width:300,height:200,metadata:{status:'loading',videoTaskId:'remote-test',videoTaskProvider:'openai',videoTaskEndpoint:'https://video-mock.example/v1',model:'video::sora-2',prompt:'原始提示词'}}]});
    await flushCanvasSave();return id;
  });
  const settled=async()=>{
    await page.evaluate(async()=>{window.testCanvasStore=(await import('/src/stores/canvas/use-canvas-store.ts')).useCanvasStore;});
    await page.waitForFunction(id=>window.videoRecoveryCalls.length===1 && window.testCanvasStore.getState().openProject(id)?.nodes[0].metadata?.status==='idle' && window.testCanvasStore.getState().openProject(id)?.nodes[0].metadata?.errorDetails?.includes('查询中断'),id);
  };
  await page.goto(base+'/canvas/'+id);
  await settled();
  const initial=await page.evaluate(()=>window.videoRecoveryCalls);
  const firstCount=initial.length;
  if(firstCount!==1) throw new Error('Expected one initial polling GET: '+JSON.stringify(calls));
  await page.evaluate(async()=>{const {flushCanvasSave}=await import('/src/stores/canvas/use-canvas-store.ts');await flushCanvasSave();});
  const epoch=await page.evaluate(()=>window.videoNavigationEpoch);
  await page.reload();
  await page.waitForFunction(epoch=>window.videoNavigationEpoch!==epoch,epoch);
  await settled();
  const resumed=await page.evaluate(()=>window.videoRecoveryCalls);
  const observed=[...initial,...resumed];
  if(observed.length!==2 || observed.some(call=>call.method!=='GET')) throw new Error('Recovery created another task: '+JSON.stringify(calls));
  const node=await page.evaluate(async id=>{const {useCanvasStore}=await import('/src/stores/canvas/use-canvas-store.ts');return useCanvasStore.getState().openProject(id).nodes[0];},id);
  if(node.metadata.videoTaskId!=='remote-test' || node.metadata.prompt!=='原始提示词') throw new Error('Task identity or original prompt lost');
  const endpoint=await page.evaluate(async()=>{
    const {pollVideoGenerationTask}=await import('/src/services/api/video.ts');
    const {useConfigStore}=await import('/src/stores/use-config-store.ts');
    const config=useConfigStore.getState().config;
    try {await pollVideoGenerationTask({...config,channels:config.channels.map(channel=>({...channel,baseUrl:'https://changed.example/v1'}))},{id:'remote-test',provider:'openai',model:'video::sora-2',endpoint:'https://video-mock.example/v1'});return 'not blocked';}catch(error){return error.message;}
  });
  if(!endpoint.includes('渠道地址已改变')) throw new Error('Wrong-channel recovery not blocked');
  return {calls:observed,task:'preserved',endpoint:'mismatch blocked before HTTP'};
}
