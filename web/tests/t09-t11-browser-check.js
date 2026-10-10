async (page) => {
    let paidCalls=0;
    await page.route('https://t12-no-network.invalid/**',route=>{paidCalls++;return route.abort();});
    await page.evaluate(async()=>{
        const {useConfigStore}=await import('/src/stores/use-config-store.ts');
        const patch={channels:[{id:'mock',name:'模拟验收',baseUrl:'https://t12-no-network.invalid/v1',apiKey:'fake-key',apiFormat:'openai',models:[{name:'gpt-image-1',capability:'image'}]}],imageModel:'mock::gpt-image-1',model:'mock::gpt-image-1',proxyEnabled:false};
        for(const [key,value] of Object.entries(patch))useConfigStore.getState().updateConfig(key,value);
    });
    await page.locator('[data-template-id="poster"]').click();
    const review=page.getByRole('dialog');
    await review.getByRole('textbox').fill('活动：本地模板验收\n风格：水墨，留白');
    await review.getByRole('button',{name:'创建画布并审阅工作流',exact:true}).click();
    await page.waitForURL(/\/canvas\/.+/);
    const workflow=page.getByRole('dialog',{name:'工作流 · 预览后执行'});
    await workflow.getByRole('button',{name:'预览全部配置',exact:true}).click();
    await workflow.getByText('3 步 · 共 4 次生成请求 · 费用由配置的渠道计费',{exact:true}).waitFor();
    const checked=await page.evaluate(async()=>{
        const {useCanvasStore}=await import('/src/stores/canvas/use-canvas-store.ts');
        const id=location.pathname.split('/').at(-1), project=useCanvasStore.getState().projects.find(x=>x.id===id);
        if(!project.connections.every(x=>x.kind==='input'))throw Error('template input edges missing');
        if(!project.nodes.find(x=>x.type==='text').metadata.content.includes('本地模板验收'))throw Error('brief not applied');
        return {project:id,nodes:project.nodes.length,inputEdges:project.connections.length};
    });
    if(paidCalls)throw Error('template preview triggered paid call');
    await workflow.getByRole('button',{name:'Close',exact:true}).click();
    await page.evaluate(async()=>{await(await import('/src/stores/canvas/use-canvas-store.ts')).flushCanvasSave();});
    page.once('dialog',dialog=>dialog.accept());
    await page.goto('http://localhost:3001/config');
    await page.getByText('高级',{exact:true}).click();
    await page.getByRole('tab',{name:'本地存储',exact:true}).click();
    await page.getByText('本机保存与备份是两件事',{exact:true}).waitFor();
    await page.getByRole('button',{name:'开始本地记录',exact:true}).click();
    await page.getByRole('button',{name:'记录一次需要帮助',exact:true}).click();
    const diagnostic=await page.evaluate(async()=>{
        const api=await import('/src/stores/use-local-diagnostics-store.ts');
        const data=JSON.parse(await(await api.exportLocalDiagnostics()).text());
        if(data.events.length!==1||data.events[0].action!=='help-needed')throw Error('voluntary local record failed');
        if(JSON.stringify(data).includes('fake-key'))throw Error('diagnostic leaked config');
        return {localOptIn:true,noKey:true};
    });
    await page.getByRole('button',{name:'停止记录',exact:true}).click();
    await page.getByRole('button',{name:'删除诊断记录',exact:true}).click();
    return {template:checked,previewPaidCalls:paidCalls,storageExplanation:true,diagnostic};
}
