async page => {
  const base='http://127.0.0.1:4317',generationRequests=[];
  page.on('request',r=>{if(r.method()==='POST'&&/\/(images|videos)(?:\/|$)/.test(new URL(r.url()).pathname))generationRequests.push(r.url());});
  await page.addInitScript(()=>{
    if(!sessionStorage.getItem('storage-startup-fault')){
      sessionStorage.setItem('storage-startup-fault','injected');
      indexedDB.open=()=>{throw new DOMException('fixture storage failure','QuotaExceededError');};
    }
  });
  await page.goto(base+'/image');
  await page.getByText('本地数据读取失败，请保留原数据并刷新重试',{exact:true}).waitFor();
  if(await page.getByRole('textbox',{name:'提示词',exact:true}).count())throw Error('Application started after storage initialization failed');
  await page.reload();
  await page.getByRole('textbox',{name:'提示词',exact:true}).waitFor();
  await page.evaluate(async()=>{
    window.startupLoad=p=>{const url=performance.getEntriesByType('resource').find(e=>new URL(e.name).pathname===p)?.name;if(!url)throw Error('Module not loaded '+p);return import(url);};
    window.startupComposer=(await window.startupLoad('/src/stores/use-composer-store.ts')).useComposerStore;
  });
  await page.waitForFunction(()=>window.startupComposer.getState().hydrated);
  const reference=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=64;c.height=32;return c.toDataURL('image/png').split(',')[1];});
  await page.locator('input[accept="image/*"]').setInputFiles({name:'startup-reference.png',mimeType:'image/png',buffer:Buffer.from(reference,'base64')});
  await page.getByRole('img',{name:'startup-reference.png',exact:true}).waitFor();
  const key=await page.evaluate(()=>window.startupComposer.getState().image.references[0].storageKey);
  await page.getByRole('textbox',{name:'提示词',exact:true}).fill('初始化恢复后的原始草稿');
  await page.evaluate(async()=>{
    const {flushComposerSave}=await window.startupLoad('/src/stores/use-composer-store.ts');
    await flushComposerSave();
  });
  await page.reload();
  await page.getByRole('textbox',{name:'提示词',exact:true}).waitFor();
  await page.getByRole('img',{name:'startup-reference.png',exact:true}).waitFor();
  const restored=await page.evaluate(async()=>{
    const url=performance.getEntriesByType('resource').find(e=>new URL(e.name).pathname==='/src/stores/use-composer-store.ts')?.name;
    return(await import(url)).useComposerStore.getState().image;
  });
  if(restored.prompt!=='初始化恢复后的原始草稿'||restored.references[0].storageKey!==key)throw Error('Reload lost the recovered draft or original file identity');
  if(generationRequests.length)throw Error('Startup recovery triggered generation');
  return{initialFailure:'visible; application not started',recovery:'reload after storage becomes available',upload:'original reference saved',reload:'draft and original file identity retained',generationRequests:generationRequests.length};
}
