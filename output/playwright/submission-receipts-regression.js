async page => {
  const base='http://127.0.0.1:4317', provider='https://receipt-mock.example', calls=[], receipts=[];
  const media=Buffer.from('AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDEAAAOzbW9vdgAAAGxtdmhkAAAAAAAAAAAAAAAAAAAD6AAAA+gAAQAAAQAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgAAAt10cmFrAAAAXHRraGQAAAADAAAAAAAAAAAAAAABAAAAAAAAA+gAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAAKAAAABaAAAAAAAkZWR0cwAAABxlbHN0AAAAAAAAAAEAAAPoAAAIAAABAAAAAAJVbWRpYQAAACBtZGhkAAAAAAAAAAAAAAAAAAAoAAAAKABVxAAAAAAALWhkbHIAAAAAAAAAAHZpZGUAAAAAAAAAAAAAAABWaWRlb0hhbmRsZXIAAAACAG1pbmYAAAAUdm1oZAAAAAEAAAAAAAAAAAAAACRkaW5mAAAAHGRyZWYAAAAAAAAAAQAAAAx1cmwgAAAAAQAAAcBzdGJsAAAAwHN0c2QAAAAAAAAAAQAAALBhdmMxAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAKAAWgBIAAAASAAAAAAAAAABFUxhdmM2Mi4yOC4xMDIgbGlieDI2NAAAAAAAAAAAAAAAGP//AAAANmF2Y0MBZAAK/+EAGWdkAAqs2UKN+TARAAADAAEAAAMAFA8SJZYBAAZo6+PLIsD9+PgAAAAAEHBhc3AAAAABAAAAAQAAABRidHJ0AAAAAAAAG7AAAAAAAAAAGHN0dHMAAAAAAAAAAQAAAAoAAAQAAAAAFHN0c3MAAAAAAAAAAQAAAAEAAABgY3R0cwAAAAAAAAAKAAAAAQAACAAAAAABAAAUAAAAAAEAAAgAAAAAAQAAAAAAAAABAAAEAAAAAAEAABQAAAAAAQAACAAAAAABAAAAAAAAAAEAAAQAAAAAAQAACAAAAAAcc3RzYwAAAAAAAAABAAAAAQAAAAoAAAABAAAAPHN0c3oAAAAAAAAAAAAAAAoAAALrAAAAEAAAAA0AAAANAAAADQAAABYAAAAPAAAADQAAAA0AAAAVAAAAFHN0Y28AAAAAAAAAAQAAA+MAAABidWR0YQAAAFptZXRhAAAAAAAAACFoZGxyAAAAAAAAAABtZGlyYXBwbAAAAAAAAAAAAAAAAC1pbHN0AAAAJal0b28AAAAdZGF0YQAAAAEAAAAATGF2ZjYyLjEyLjEwMgAAAAhmcmVlAAADfm1kYXQAAAKuBgX//6rcRem95tlIt5Ys2CDZI+7veDI2NCAtIGNvcmUgMTY1IHIzMjIyIGIzNTYwNWEgLSBILjI2NC9NUEVHLTQgQVZDIGNvZGVjIC0gQ29weWxlZnQgMjAwMy0yMDI1IC0gaHR0cDovL3d3dy52aWRlb2xhbi5vcmcveDI2NC5odG1sIC0gb3B0aW9uczogY2FiYWM9MSByZWY9MyBkZWJsb2NrPTE6MDowIGFuYWx5c2U9MHgzOjB4MTEzIG1lPWhleCBzdWJtZT03IHBzeT0xIHBzeV9yZD0xLjAwOjAuMDAgbWl4ZWRfcmVmPTEgbWVfcmFuZ2U9MTYgY2hyb21hX21lPTEgdHJlbGxpcz0xIDh4OGRjdD0xIGNxbT0wIGRlYWR6b25lPTIxLDExIGZhc3RfcHNraXA9MSBjaHJvbWFfcXBfb2Zmc2V0PS0yIHRocmVhZHM9MyBsb29rYWhlYWRfdGhyZWFkcz0xIHNsaWNlZF90aHJlYWRzPTAgbnI9MCBkZWNpbWF0ZT0xIGludGVybGFjZWQ9MCBibHVyYXlfY29tcGF0PTAgY29uc3RyYWluZWRfaW50cmE9MCBiZnJhbWVzPTMgYl9weXJhbWlkPTIgYl9hZGFwdD0xIGJfYmlhcz0wIGRpcmVjdD0xIHdlaWdodGI9MSBvcGVuX2dvcD0wIHdlaWdodHA9MiBrZXlpbnQ9MjUwIGtleWludF9taW49MTAgc2NlbmVjdXQ9NDAgaW50cmFfcmVmcmVzaD0wIHJjX2xvb2thaGVhZD00MCByYz1jcmYgbWJ0cmVlPTEgY3JmPTIzLjAgcWNvbXA9MC42MCBxcG1pbj0wIHFwbWF4PTY5IHFwc3RlcD00IGlwX3JhdGlvPTEuNDAgYXE9MToxLjAwAIAAAAA1ZYiEABH//ufj/AptfMRxOnYY+vfW13Ki6NeHVxiFPILq7Y6o34d3DLU4FB9dgRIABewa+vEAAAAMQZokbEEP/qpVADxgAAAACUGeQniHfwBoQQAAAAkBnmF0Q38AlIAAAAAJAZ5jakN/AJSBAAAAEkGaaEmoQWiZTAh3//6plgDmgQAAAAtBnoZFESw7/wBoQQAAAAkBnqV0Q38AlIEAAAAJAZ6nakN/AJSAAAAAEUGaqUmoQWyZTAhv//6nhAHH','base64');
  page.on('dialog',d=>{if(d.type==='beforeunload')void d.accept().catch(()=>{});});
  await page.goto(base+'/image',{waitUntil:'domcontentloaded'});
  await page.getByRole('textbox',{name:'提示词',exact:true}).waitFor();
  const png=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=32;c.height=16;return c.toDataURL('image/png').split(',')[1];});
  await page.route('**/*',async route=>{
    const r=route.request(), u=new URL(r.url());
    if(u.origin===base||!['http:','https:'].includes(u.protocol))return route.continue();
    if(u.origin!==provider)return route.abort('blockedbyclient');
    const headers={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'*','Access-Control-Allow-Methods':'*'};
    if(r.method()==='OPTIONS')return route.fulfill({status:204,headers});
    calls.push({method:r.method(),path:u.pathname});
    if(r.method()==='POST'){
      const saved=await page.evaluate(async()=>{
        const {STORAGE_NS,storageKey}=await window.receiptLoad('/src/constant/brand.ts');
        const db=await new Promise((resolve,reject)=>{const q=indexedDB.open(STORAGE_NS);q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error);});
        try{return await new Promise((resolve,reject)=>{const q=db.transaction('app_state').objectStore('app_state').get(storageKey('composer_drafts'));q.onsuccess=()=>{const state=JSON.parse(q.result).state;resolve(Object.values(state.conversations).flatMap(c=>c.entries).some(e=>e.plan?.submission.id===window.receiptSubmission));};q.onerror=()=>reject(q.error);});}finally{db.close();}
      });
      receipts.push(saved);
    }
    if(u.pathname==='/v1/images/generations')return route.fulfill({headers,contentType:'application/json',body:JSON.stringify({data:[{b64_json:png}]})});
    if(u.pathname==='/v1/videos')return route.fulfill({headers,contentType:'application/json',body:JSON.stringify({id:'receipt-video',status:'queued'})});
    if(u.pathname==='/v1/videos/receipt-video')return route.fulfill({headers,contentType:'application/json',body:JSON.stringify({id:'receipt-video',status:'completed'})});
    if(u.pathname==='/v1/videos/receipt-video/content')return route.fulfill({headers,contentType:'video/mp4',body:media});
    return route.fulfill({status:404,headers});
  });
  const evidence=[];
  for(const scenario of ['image','video','image-save-failure']){
    const mode=scenario.startsWith('image')?'image':'video',saveFailure=scenario.endsWith('failure');
    if(new URL(page.url()).pathname!=='/'+mode){await page.getByRole('link',{name:mode==='image'?'生图':'视频',exact:true}).click();await page.waitForURL(base+'/'+mode);}
    await page.getByRole('button',{name:mode==='image'?'落笔生成':'生成视频',exact:true}).waitFor();
    await page.evaluate(async()=>{
      window.receiptLoad=p=>{const url=performance.getEntriesByType('resource').find(e=>new URL(e.name).pathname===p)?.name;if(!url)throw Error('Module not loaded: '+p);return import(url);};
      window.receiptComposer=(await window.receiptLoad('/src/stores/use-composer-store.ts')).useComposerStore;
      window.receiptTasks=(await window.receiptLoad('/src/features/tasks/task-store.ts')).useTaskStore;
      window.receiptWriter=(await window.receiptLoad('/src/lib/write-ownership.ts')).writeOwnership;
    });
    await page.waitForFunction(()=>window.receiptComposer.getState().hydrated&&window.receiptWriter.canWrite());
    await page.evaluate(async({mode,provider,saveFailure})=>{
      const {useConfigStore,defaultConfig}=await window.receiptLoad('/src/stores/use-config-store.ts');
      const config={...defaultConfig,count:'1',channels:[{id:'receipt',name:'receipt',baseUrl:provider+'/v1',apiKey:'mock-key',apiFormat:'openai',models:[{name:'gpt-image-1',capability:'image'},{name:'sora-2',capability:'video'}]}],model:'receipt::gpt-image-1',imageModel:'receipt::gpt-image-1',videoModel:'receipt::sora-2'};
      useConfigStore.setState({config});
      if(saveFailure){window.receiptPut=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(value,key){if(this.name==='app_state'&&String(key).endsWith(':composer_drafts'))throw new DOMException('fixture quota','QuotaExceededError');return window.receiptPut.apply(this,arguments);};}
      const {createComposerSubmission}=await window.receiptLoad('/src/lib/composer.ts');
      const submission=createComposerSubmission(mode,'外部工作台原始提交 '+mode,[],config);
      window.receiptSubmission=submission.id;
      const {useWorkbenchAgentStore}=await window.receiptLoad('/src/stores/use-workbench-agent-store.ts');
      useWorkbenchAgentStore.getState()[mode==='image'?'dispatchImage':'dispatchVideo']({submission,run:true});
    },{mode,provider,saveFailure});
    if(saveFailure){
      await page.waitForFunction(()=>window.receiptTasks.getState().tasks.some(t=>t.creationId===window.receiptSubmission&&t.phase==='failed'));
      await page.evaluate(()=>{IDBObjectStore.prototype.put=window.receiptPut;});
      evidence.push({mode,saveFailure:'failed before provider submission'});
      continue;
    }
    await page.waitForFunction(()=>window.receiptTasks.getState().tasks.some(t=>t.creationId===window.receiptSubmission&&t.phase==='done'&&t.saveState==='saved')).catch(async error=>{throw Error(error.message+' '+JSON.stringify({mode,calls,state:await page.evaluate(()=>({tasks:window.receiptTasks.getState().tasks,writer:window.receiptWriter.getSnapshot(),submission:window.receiptSubmission,plans:Object.values(window.receiptComposer.getState().conversations).flatMap(c=>c.entries).filter(e=>e.plan).map(e=>e.plan.state)}))}));});
    const identity=await page.evaluate(mode=>{
      const s=window.receiptComposer.getState(),entries=s.conversations[s.activeConversations[mode]].entries.filter(e=>e.plan?.submission.id===window.receiptSubmission);
      const plan=entries[0]?.plan,task=window.receiptTasks.getState().tasks.find(t=>t.creationId===window.receiptSubmission);
      if(entries.length!==1||plan.state!=='submitted'||plan.taskId!==task.id)throw Error('External submission has no unique conversation receipt: '+mode);
      return {mode,submissionId:window.receiptSubmission,planId:plan.id,taskId:task.id,prompt:plan.submission.prompt};
    },mode);
    await page.getByRole('button',{name:'送入画布',exact:true}).waitFor();
    await page.getByRole('textbox',{name:'提示词',exact:true}).fill('下一轮的新草稿');
    await page.evaluate(async()=>{await(await window.receiptLoad('/src/stores/use-composer-store.ts')).flushComposerSave();});
    await page.reload({waitUntil:'domcontentloaded'});
    await page.getByRole('textbox',{name:'提示词',exact:true}).waitFor();
    await page.evaluate(async()=>{window.receiptComposer=(await import(performance.getEntriesByType('resource').find(e=>new URL(e.name).pathname==='/src/stores/use-composer-store.ts').name)).useComposerStore;});
    await page.waitForFunction(()=>window.receiptComposer.getState().hydrated);
    const restored=await page.evaluate(expected=>{const s=window.receiptComposer.getState(),plan=s.conversations[s.activeConversations[expected.mode]].entries.find(e=>e.plan?.id===expected.planId)?.plan;return plan?.submission.prompt===expected.prompt&&plan.taskId===expected.taskId;},identity);
    if(!restored)throw Error('Reload lost original receipt');
    evidence.push(identity);
  }
  if(receipts.length!==2||!receipts.every(Boolean)||calls.filter(r=>r.method==='POST').length!==2)throw Error('Receipt not saved before one submission per mode');
  return {evidence,persistedBeforeSubmission:receipts,reload:'original identities retained; no new request',syntheticProvider:true,calls};
}
