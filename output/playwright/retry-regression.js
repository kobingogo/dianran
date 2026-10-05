async(page)=>{
  page.on('dialog',dialog=>{if(dialog.type()==='beforeunload') void dialog.accept().catch(()=>{});});
  await page.addInitScript(()=>{
    window.retryBodies=[];
    const open=XMLHttpRequest.prototype.open;
    const send=XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open=function(method,url,...rest){this.testRetryRequest=String(url).startsWith('https://retry-mock.example/');return open.call(this,method,url,...rest);};
    XMLHttpRequest.prototype.send=function(body){if(this.testRetryRequest && typeof body==='string') window.retryBodies.push(JSON.parse(body));return send.call(this,body);};
  });
  await page.goto('http://127.0.0.1:4317/image');
  const png=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=32;c.height=32;c.getContext('2d').fillRect(0,0,32,32);return c.toDataURL('image/png').split(',')[1];});
  let attempts=0;
  await page.route('https://retry-mock.example/**',route=>{
    attempts++;
    return route.fulfill({status:attempts===1?500:200,contentType:'application/json',body:JSON.stringify(attempts===1?{error:{message:'mock first failure'}}:{data:[{b64_json:png}]}),headers:{'Access-Control-Allow-Origin':'*'}});
  });
  await page.evaluate(async()=>{
    const {useConfigStore,defaultConfig}=await import('/src/stores/use-config-store.ts');
    const config={...defaultConfig,count:'1',size:'1:1',channels:[{id:'retry',name:'mock',baseUrl:'https://retry-mock.example/v1',apiKey:'mock-key',apiFormat:'openai',models:[{name:'gpt-image-1',capability:'image'}]}],imageModel:'retry::gpt-image-1',model:'retry::gpt-image-1'};
    useConfigStore.setState({config});
    const {createComposerSubmission}=await import('/src/lib/composer.ts');
    const {useWorkbenchAgentStore}=await import('/src/stores/use-workbench-agent-store.ts');
    useWorkbenchAgentStore.getState().dispatchImage({submission:createComposerSubmission('image','原始提交',[],config),run:true});
  });
  await page.getByRole('button',{name:'重试',exact:true}).waitFor();
  await page.evaluate(async()=>{
    const {useComposerStore}=await import('/src/stores/use-composer-store.ts');
    useComposerStore.getState().patch('image',{prompt:'修改后的新草稿'});
    const {useConfigStore}=await import('/src/stores/use-config-store.ts');
    useConfigStore.setState({config:{...useConfigStore.getState().config,count:'3',size:'16:9',quality:'hd'}});
  });
  await page.getByRole('button',{name:'重试',exact:true}).click();
  await page.getByRole('button',{name:'送入画布',exact:true}).waitFor();
  const bodies=await page.evaluate(()=>window.retryBodies);
  if(bodies.length!==2 || bodies.some(body=>body.prompt!=='原始提交' || body.n!==1 || body.size!=='1024x1024')) throw new Error('Retry used current draft/parameters: '+JSON.stringify(bodies));
  return {requests:bodies.map(({prompt,n,size})=>({prompt,n,size})),retry:'original snapshot preserved after draft edits'};
}
