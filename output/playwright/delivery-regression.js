async (page) => {
  page.on('dialog',dialog=>{if(dialog.type()==='beforeunload') void dialog.accept().catch(()=>{});});
  const base='http://127.0.0.1:4317';
  await page.goto(base+'/image');
  const png=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=32;c.height=32;c.getContext('2d').fillRect(0,0,32,32);return c.toDataURL('image/png');});
  await page.route('https://delivery-mock.example/**',route=>route.fulfill({contentType:'application/json',body:JSON.stringify({data:[{b64_json:png.split(',')[1]}]}),headers:{'Access-Control-Allow-Origin':'*'}}));
  await page.evaluate(async(png)=>{
    const {useConfigStore,defaultConfig}=await import('/src/stores/use-config-store.ts');
    const config={...defaultConfig,count:'1',channels:[{id:'delivery',name:'mock',baseUrl:'https://delivery-mock.example/v1',apiKey:'mock-key',apiFormat:'openai',models:[{name:'gpt-image-1',capability:'image'}]}],imageModel:'delivery::gpt-image-1',model:'delivery::gpt-image-1'};
    useConfigStore.setState({config});
    const {uploadImage}=await import('/src/services/image-storage.ts');
    const image=await uploadImage(png);
    const {createComposerSubmission}=await import('/src/lib/composer.ts');
    const {useWorkbenchAgentStore}=await import('/src/stores/use-workbench-agent-store.ts');
    const submission=createComposerSubmission('image','@[ref:source] 春山',[{id:'source',name:'原始参考图',type:'image/png',dataUrl:image.url,storageKey:image.storageKey}],config);
    useWorkbenchAgentStore.getState().dispatchImage({submission,run:true});
  },png);
  await page.getByRole('button',{name:'送入画布',exact:true}).waitFor();
  await page.getByRole('button',{name:'送入画布',exact:true}).click();
  await page.getByRole('checkbox',{name:'连同创作过程送入画布',exact:true}).check();
  await page.getByRole('button',{name:'送入并打开',exact:true}).click();
  await page.waitForURL(/\/canvas\//);
  await page.getByRole('button',{name:'工作流',exact:true}).waitFor();
  const result=await page.evaluate(async(png)=>{
    const {useCanvasStore}=await import('/src/stores/canvas/use-canvas-store.ts');
    const project=useCanvasStore.getState().openProject(location.pathname.split('/').pop());
    if(project.nodes.length!==3 || project.connections.length!==2) throw new Error('Incomplete process graph');
    const output=project.nodes.find(node=>node.metadata?.sourceResultId);
    if(!output.metadata?.inputSnapshot?.referenceImages[0].storageKey || output.metadata.inputSnapshot.prompt!=='参考图1 春山') throw new Error('Original snapshot missing');
    const {planWorkflow}=await import('/src/lib/canvas/workflow.ts');
    const {useConfigStore}=await import('/src/stores/use-config-store.ts');
    const configNode=project.nodes.find(node=>node.type==='config');
    const plan=planWorkflow(project.nodes,project.connections,[configNode.id],useConfigStore.getState().config);
    // This additional file is referenced only by the saved template.
    const {uploadImage,getImageBlob,cleanupUnusedImages}=await import('/src/services/image-storage.ts');
    const file=await uploadImage(png);
    plan.resources[0].metadata={...plan.resources[0].metadata,content:file.url,storageKey:file.storageKey};
    const {useWorkflowStore}=await import('/src/stores/canvas/use-workflow-store.ts');
    await useWorkflowStore.getState().save(plan,'模板独占文件');
    await cleanupUnusedImages(useCanvasStore.getState().projects);
    if(!await getImageBlob(file.storageKey)) throw new Error('Template-only media was collected');
    return {nodes:project.nodes.length,connections:project.connections.map(edge=>edge.kind),snapshot:'original reference and prompt',templateMedia:'retained after cleanup'};
  },png);
  return result;
}
