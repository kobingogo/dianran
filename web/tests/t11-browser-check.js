async (page) => {
 const errors=[],templates=[];let paidCalls=0;
 page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.accept());
 await page.route('https://t12-no-network.invalid/**',route=>{paidCalls++;return route.abort()});
 await page.locator('[data-template-id="storyboard"]').waitFor();
 await page.evaluate(async()=>{
  const {useConfigStore}=await import('/src/stores/use-config-store.ts');
  const patch={channels:[{id:'mock',name:'本地模板验收',baseUrl:'https://t12-no-network.invalid/v1',apiKey:'fake-key',apiFormat:'openai',models:[{name:'gpt-image-1',capability:'image'}]}],imageModel:'mock::gpt-image-1',model:'mock::gpt-image-1',proxyEnabled:false};
  for(const [key,value] of Object.entries(patch))useConfigStore.getState().updateConfig(key,value);
 });
 for(const id of ['storyboard','moodboard','social-covers']){
  if(!page.url().endsWith('/'))await page.goto('http://127.0.0.1:3031/');
  await page.locator(`[data-template-id="${id}"]`).click();
  const review=page.getByRole('dialog');await review.getByRole('textbox').first().fill(`本地 ${id} 文案修改`);
  await review.getByRole('button',{name:'创建画布并审阅工作流',exact:true}).click();
  await page.waitForURL(/\/canvas\/.+/);
  const workflow=page.getByRole('dialog',{name:'工作流 · 预览后执行'});await workflow.getByRole('button',{name:'预览全部配置',exact:true}).click();
  await workflow.getByRole('button',{name:'确认执行此计划',exact:true}).waitFor();
  const result=await page.evaluate(async()=>{
   const {useCanvasStore,flushCanvasSave}=await import('/src/stores/canvas/use-canvas-store.ts');await flushCanvasSave();
   const project=useCanvasStore.getState().openProject(location.pathname.split('/').at(-1));
   if(!project.nodes.some(node=>node.type==='text'&&node.metadata.content.includes('文案修改')))throw Error('填写文本未保留');
   if(!project.connections.every(edge=>edge.kind==='input'))throw Error('输入关系错误');
   return {projectId:project.id,nodes:project.nodes.length,configs:project.nodes.filter(node=>node.type==='config').length};
  });
  templates.push({template:id,...result});await workflow.getByRole('button',{name:'Close',exact:true}).click();
 }
 if(paidCalls)throw Error('预览触发生成请求');if(errors.length)throw Error(errors.join('\n'));
 return {templates,previewPaidCalls:paidCalls,pageErrors:errors};
}
