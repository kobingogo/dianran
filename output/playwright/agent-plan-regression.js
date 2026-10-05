async(page)=>{
  page.on('dialog',dialog=>{if(dialog.type()==='beforeunload') void dialog.accept().catch(()=>{});});
  const base='http://127.0.0.1:4317';
  await page.goto(base+'/canvas');
  const id=await page.evaluate(async()=>{
    const {useConfigStore,defaultConfig}=await import('/src/stores/use-config-store.ts');
    useConfigStore.setState({config:{...defaultConfig,channels:[{id:'plan',name:'mock',baseUrl:'https://agent-plan-mock.example/v1',apiKey:'mock-key',apiFormat:'openai',models:[{name:'gpt-image-1',capability:'image'}]}],imageModel:'plan::gpt-image-1'}});
    const {useCanvasStore,flushCanvasSave}=await import('/src/stores/canvas/use-canvas-store.ts');
    if(!useCanvasStore.getState().hydrated) await useCanvasStore.persist.rehydrate();
    const id=useCanvasStore.getState().createProject('Agent 计划预览');await flushCanvasSave();return id;
  });
  await page.goto(base+'/canvas/'+id);
  await page.getByRole('button',{name:'工作流',exact:true}).waitFor();
  await page.evaluate(async()=>{
    const {useAgentStore}=await import('/src/stores/use-agent-store.ts');
    const text='```dianran-plan\n'+JSON.stringify({title:'Agent 两步计划',steps:[{id:'first',mode:'image',prompt:'制作海报'},{id:'second',mode:'image',prompt:'改为水墨',dependsOn:['first']}]})+'\n```';
    useAgentStore.setState({activeTab:'chat',activeThreadId:'thread-test',activeTurnId:'turn-test',messages:[{id:'message-test',itemId:'item-test',threadId:'thread-test',turnId:'turn-test',role:'assistant',text}],waiting:false,sending:false});
    useAgentStore.getState().openPanel();
  });
  await page.getByRole('button',{name:'审阅创作计划',exact:true}).click();
  await page.getByRole('dialog',{name:'工作流 · 预览后执行',exact:true}).waitFor();
  await page.getByText('2 步 · 共 2 次生成请求 · 费用由配置的渠道计费',{exact:true}).waitFor();
  const state=await page.evaluate(async(id)=>{
    const {useCanvasStore}=await import('/src/stores/canvas/use-canvas-store.ts');
    const {useWorkflowStore}=await import('/src/stores/canvas/use-workflow-store.ts');
    const project=useCanvasStore.getState().openProject(id);
    if(project.nodes.length || project.workflowRuns?.length) throw new Error('Review mutated canvas or submitted generation');
    return {nodes:project.nodes.length,proposalConsumed:!useWorkflowStore.getState().proposal};
  },id);
  return {review:'two steps visible, no generation',...state};
}
