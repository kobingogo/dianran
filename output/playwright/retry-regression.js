async(page)=>{
  if(new URL(page.url()).origin!=='http://127.0.0.1:4317') throw Error('Use isolated 127.0.0.1:4317');
  page.on('dialog',dialog=>{if(dialog.type()==='beforeunload') void dialog.accept().catch(()=>{});});
  await page.goto('http://127.0.0.1:4317/image');
  await page.getByText('当前页面拥有编辑权',{exact:true}).waitFor();
  const png=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=32;c.height=32;c.getContext('2d').fillRect(0,0,32,32);return c.toDataURL('image/png').split(',')[1];});
  const bodies=[];
  await page.unroute('https://retry-mock.example/**');
  await page.route('https://retry-mock.example/**',route=>{
    if(route.request().method()==='OPTIONS') return route.fulfill({status:204,headers:{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'*','Access-Control-Allow-Methods':'*'}});
    if(route.request().method()!=='POST') return route.abort();
    bodies.push(route.request().postDataJSON());
    return route.fulfill({status:bodies.length===1?500:200,contentType:'application/json',body:JSON.stringify(bodies.length===1?{error:{message:'mock first failure'}}:{data:[{b64_json:png}]}),headers:{'Access-Control-Allow-Origin':'*'}});
  });
  await page.evaluate(async()=>{
    const {useConfigStore,defaultConfig}=await import('/src/stores/use-config-store.ts');
    const config={...defaultConfig,count:'1',size:'1:1',channels:[{id:'retry',name:'mock',baseUrl:'https://retry-mock.example/v1',apiKey:'mock-key',apiFormat:'openai',models:[{name:'gpt-image-1',capability:'image'}]}],imageModel:'retry::gpt-image-1',model:'retry::gpt-image-1'};
    useConfigStore.setState({config});
    const {createComposerSubmission}=await import('/src/lib/composer.ts');
    const {useWorkbenchAgentStore}=await import('/src/stores/use-workbench-agent-store.ts');
    useWorkbenchAgentStore.getState().dispatchImage({submission:createComposerSubmission('image','原始提交',[],config),run:true});
  });
  await page.getByText('结果未知',{exact:true}).waitFor();
  await page.getByRole('button',{name:'新建生成请求',exact:true}).waitFor();
  await page.getByText(/原请求可能已被接受，新请求可能再次计费/).waitFor();
  if(bodies.length!==1) throw Error('Unknown response triggered automatic resubmission');
  if(await page.getByRole('button',{name:'重试',exact:true}).count()) throw Error('Unknown result incorrectly exposes ordinary retry');
  await page.evaluate(async()=>{
    const {useComposerStore}=await import('/src/stores/use-composer-store.ts');
    useComposerStore.getState().patch('image',{prompt:'修改后的新草稿'});
    const {useConfigStore}=await import('/src/stores/use-config-store.ts');
    useConfigStore.setState({config:{...useConfigStore.getState().config,count:'3',size:'16:9',quality:'hd'}});
  });
  await page.getByRole('button',{name:'新建生成请求',exact:true}).click();
  const confirmation=page.getByRole('dialog',{name:'创建新的生成请求'});
  await confirmation.getByText(/可能再次计费/).waitFor();
  if(bodies.length!==1) throw Error('New request submitted before cost confirmation');
  await confirmation.getByRole('button',{name:'新建请求',exact:true}).click();
  await page.getByRole('button',{name:'送入画布',exact:true}).waitFor();
  if(bodies.length!==2 || bodies.some(body=>body.prompt!=='原始提交' || body.n!==1 || body.size!=='1024x1024')) throw new Error('New request used edited draft/parameters: '+JSON.stringify(bodies));
  return {firstHttp500:'unknown',costConfirmationRequired:true,requests:bodies.map(({prompt,n,size})=>({prompt,n,size})),newRequest:'original snapshot preserved after draft edits',successfulResult:true};
}
