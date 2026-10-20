async page => {
  const base='http://127.0.0.1:4317',external=[];
  page.on('dialog',d=>{if(d.type()==='beforeunload')void d.accept().catch(()=>{});});
  await page.route('**/*',route=>{const r=route.request(),u=new URL(r.url());if(u.origin===base||!['http:','https:'].includes(u.protocol))return route.continue();external.push(r.method()+' '+u.origin+u.pathname);return route.abort('blockedbyclient');});
  await page.goto(base+'/canvas');
  await page.getByRole('button',{name:'新建画布',exact:true}).first().waitFor();
  await page.evaluate(async()=>{window.__raceLoad=p=>import(performance.getEntriesByType('resource').find(e=>new URL(e.name).pathname===p)?.name||p);window.__raceCanvas=(await window.__raceLoad('/src/stores/canvas/use-canvas-store.ts')).useCanvasStore;window.__raceAgent=(await window.__raceLoad('/src/stores/use-agent-store.ts')).useAgentStore;window.__raceWriter=(await window.__raceLoad('/src/lib/write-ownership.ts')).writeOwnership;});
  await page.waitForFunction(()=>window.__raceCanvas.getState().hydrated&&window.__raceWriter.canWrite());
  await page.getByRole('button',{name:'新建画布',exact:true}).first().click();await page.waitForURL(/\/canvas\//);
  const projectId=new URL(page.url()).pathname.split('/').pop();
  const png=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=80;c.height=40;c.getContext('2d').fillStyle='#36c';c.getContext('2d').fillRect(0,0,80,40);return c.toDataURL('image/png').split(',')[1];});
  await page.locator('input[accept*="audio/mpeg"]').setInputFiles({name:'race-original.png',mimeType:'image/png',buffer:Buffer.from(png,'base64')});
  await page.waitForFunction(id=>window.__raceCanvas.getState().openProject(id)?.nodes[0]?.metadata.storageKey,projectId);
  const original=await page.evaluate(async id=>{await(await window.__raceLoad('/src/stores/canvas/use-canvas-store.ts')).flushCanvasSave();return window.__raceCanvas.getState().openProject(id);},projectId);
  await page.waitForFunction(id=>window.__raceAgent.getState().canvasContext?.getSnapshot().projectId===id,projectId);
  await page.evaluate(node=>{
    window.__raceOriginalGet=Object.getOwnPropertyDescriptor(IDBObjectStore.prototype,'get');
    IDBObjectStore.prototype.get=function(key){
      const request=window.__raceOriginalGet.value.call(this,key);
      if(this.name==='image_files'&&key===node.metadata.storageKey&&!window.__raceHeld){
        window.__raceHeld=true;
        request.addEventListener('success',event=>{event.stopImmediatePropagation();window.__raceRelease=()=>request.onsuccess?.call(request,event);},{once:true,capture:true});
      }
      return request;
    };
    window.__raceOutcome=null;
    window.__racePromise=window.__raceAgent.getState().canvasContext.applyOps([{type:'add_node',id:'late-image',nodeType:'image',position:{x:0,y:0},width:80,height:40,metadata:node.metadata}]).then(()=>{window.__raceOutcome='applied';},error=>{window.__raceOutcome=error.message;});
  },original.nodes[0]);
  let otherId;
  try{
    await page.waitForFunction(()=>typeof window.__raceRelease==='function');
    await page.getByRole('link',{name:'画布',exact:true}).click();await page.getByRole('button',{name:'新建画布',exact:true}).first().click();await page.waitForURL(/\/canvas\//);
    otherId=new URL(page.url()).pathname.split('/').pop();
    await page.waitForFunction(id=>window.__raceAgent.getState().canvasContext?.getSnapshot().projectId===id,otherId);
  }finally{
    await page.evaluate(()=>{Object.defineProperty(IDBObjectStore.prototype,'get',window.__raceOriginalGet);window.__raceRelease?.();});
  }
  await page.waitForFunction(()=>typeof window.__raceOutcome==='string');
  const result=await page.evaluate(async({original,otherId})=>{
    await window.__racePromise;await(await window.__raceLoad('/src/stores/canvas/use-canvas-store.ts')).flushCanvasSave();
    const s=window.__raceCanvas.getState(),a=s.openProject(original.id),b=s.openProject(otherId),error=window.__raceOutcome;
    if(error==='applied'||!error.includes('画布')||JSON.stringify(a.nodes)!==JSON.stringify(original.nodes)||b.nodes.length)throw Error('Late media validation wrote into an inactive or current project: '+error);
    const {getImageBlob}=await window.__raceLoad('/src/services/image-storage.ts');const blob=await getImageBlob(original.nodes[0].metadata.storageKey);
    if(!blob||blob.size!==original.nodes[0].metadata.bytes)throw Error('Race discarded original media');
    return{error,originalNodes:a.nodes.length,currentNodes:b.nodes.length,originalBytes:blob.size};
  },{original,otherId});
  if(external.length)throw Error('Bridge validation invoked an external provider');
  return{scope:'real React bridge and IndexedDB image read; simulated Agent operation',held:'original-file validation response',switched:'UI navigation to another canvas before release',outcome:'obsolete asynchronous edit rejected',...result,generationRequests:0};
}
