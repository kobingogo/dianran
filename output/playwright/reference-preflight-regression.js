async page => {
  const base='http://127.0.0.1:4317',provider='https://reference-preflight.example',calls=[];
  let allowRequest=false,observed;
  page.on('dialog',d=>{if(d.type==='beforeunload')void d.accept().catch(()=>{});});
  await page.goto(base+'/image');
  await page.getByRole('textbox',{name:'提示词',exact:true}).waitFor();
  await page.evaluate(async()=>{
    window.__referenceLoad=p=>{const url=performance.getEntriesByType('resource').find(e=>new URL(e.name).pathname===p)?.name;if(!url)throw Error('Module not loaded '+p);return import(url);};
    window.preflightWriter=(await window.__referenceLoad('/src/lib/write-ownership.ts')).writeOwnership;
    window.preflightComposer=(await window.__referenceLoad('/src/stores/use-composer-store.ts')).useComposerStore;
    window.preflightTasks=(await window.__referenceLoad('/src/features/tasks/task-store.ts')).useTaskStore;
  });
  await page.waitForFunction(()=>window.preflightWriter.canWrite()&&window.preflightComposer.getState().hydrated);
  const fixtures=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=64;c.height=32;return{reference:c.toDataURL('image/png').split(',')[1]};});
  await page.route('**/*',async route=>{
    const r=route.request(),u=new URL(r.url());if(u.origin===base||!['http:','https:'].includes(u.protocol))return route.continue();
    calls.push({method:r.method(),path:u.pathname});
    if(!allowRequest||u.origin!==provider||u.pathname!=='/v1/images/edits')return route.abort('blockedbyclient');
    const uploaded=await page.evaluate(async({body,type})=>{
      const form=await new Request('https://fixture',{method:'POST',headers:{'content-type':type},body:new Uint8Array(body)}).formData();
      const file=form.get('image');return file instanceof File?Array.from(new Uint8Array(await file.arrayBuffer())):[];
    },{body:Array.from(r.postDataBuffer()),type:r.headers()['content-type']});
    if(Buffer.from(uploaded).toString('base64')!==fixtures.reference)throw Error('Restored reference bytes changed');
    return route.fulfill({headers:{'Access-Control-Allow-Origin':'*'},contentType:'application/json',body:JSON.stringify({data:[{b64_json:fixtures.reference}]})});
  });
  await page.evaluate(async provider=>{
    const {useConfigStore,defaultConfig}=await window.__referenceLoad('/src/stores/use-config-store.ts');
    useConfigStore.setState({config:{...defaultConfig,count:'1',channels:[{id:'preflight',name:'preflight',baseUrl:provider+'/v1',apiKey:'mock-key',apiFormat:'openai',models:[{name:'gpt-image-1',capability:'image'}]}],imageModel:'preflight::gpt-image-1',model:'preflight::gpt-image-1'}});
  },provider);
  await page.getByRole('button', { name: '选择模型', exact: true }).click();
  await page.getByRole('option', { name: /gpt-image-1/ }).click();
  await page.locator('input[accept="image/*"]').setInputFiles({ name: 'original-reference.png', mimeType: 'image/png', buffer: Buffer.from(fixtures.reference, 'base64') });
  await page.getByRole('img', { name: 'original-reference.png', exact: true }).waitFor();
  if (calls.length) throw Error('Uploading reference triggered generation');
  await page.getByRole('textbox', { name: '提示词', exact: true }).fill('带参考图的首次 UI 创作');
  const reference=await page.evaluate(async()=>{
    const ref=window.preflightComposer.getState().image.references[0];
    const api=await window.__referenceLoad('/src/services/image-storage.ts');
    window.preflightBlob=await api.getImageBlob(ref.storageKey);if(!window.preflightBlob)throw Error('UI reference was not saved');
    const {STORAGE_NS}=await window.__referenceLoad('/src/constant/brand.ts');
    const db=await new Promise((resolve,reject)=>{const r=indexedDB.open(STORAGE_NS);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
    try{await new Promise((resolve,reject)=>{const tx=db.transaction('image_files','readwrite');tx.objectStore('image_files').delete(ref.storageKey);tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);});}finally{db.close();}
    URL.revokeObjectURL(ref.dataUrl||ref.url);
    return{key:ref.storageKey,prompt:window.preflightComposer.getState().image.prompt};
  });
  try{
    await page.getByRole('button',{name:'落笔生成',exact:true}).click();
    await page.getByRole('button',{name:'确认并生成',exact:true}).waitFor();
    const state=await page.evaluate(expected=>{
      const draft=window.preflightComposer.getState().image,tasks=window.preflightTasks.getState().tasks;
      return{draftRetained:draft.prompt===expected.prompt&&draft.references.some(r=>r.storageKey===expected.key),activeTasks:tasks.filter(t=>['preparing','requesting','queued','generating','receiving'].includes(t.phase)).length,phases:tasks.map(t=>t.phase)};
    },reference);
    if(calls.length||state.activeTasks||!state.draftRetained)throw Error('Reference preparation did not preserve an unsubmitted draft: '+JSON.stringify({calls,...state}));
    observed={...state,providerRequests:calls.length,referenceFault:'actual uploaded original removed and object URL revoked',scope:'UI submission with isolated missing file'};
  }finally{
    await page.evaluate(async key=>{await(await window.__referenceLoad('/src/services/image-storage.ts')).setImageBlob(key,window.preflightBlob);},reference.key);
  }
  allowRequest=true;
  await page.getByRole('button',{name:'落笔生成',exact:true}).click();
  await page.getByRole('button',{name:'送入画布',exact:true}).waitFor();
  await page.waitForFunction(()=>window.preflightTasks.getState().tasks.some(t=>t.phase==='done'&&t.saveState==='saved'));
  if(calls.length!==1||calls[0].method!=='POST')throw Error('Reference recovery submitted more than once');
  return{...observed,recovery:'one UI submission after original restored; multipart original bytes retained',calls};
}
