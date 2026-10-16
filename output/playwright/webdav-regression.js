async (page) => {
  const base='http://127.0.0.1:4317',dav=webdavURL,provider='https://webdav-generation-mock.example',blocked=[],calls=[];
  let generatedPNG='';
  const guard=route=>{const r=route.request(),u=new URL(r.url());if(u.origin===provider){const headers={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'*','Access-Control-Allow-Methods':'*'};if(r.method()==='OPTIONS')return route.fulfill({status:204,headers});calls.push({method:r.method(),path:u.pathname});const json=data=>route.fulfill({headers,contentType:'application/json',body:JSON.stringify(data)});if(r.method()==='POST'&&u.pathname==='/v1/images/generations')return json({data:[{b64_json:generatedPNG}]});if(r.method()==='POST'&&u.pathname==='/v1/videos')return json({id:'sync-video-original',status:'queued'});if(r.method()==='GET'&&u.pathname==='/v1/videos/sync-video-original')return json({id:'sync-video-original',status:'completed'});if(r.method()==='GET'&&u.pathname==='/v1/videos/sync-video-original/content')return route.fulfill({headers,contentType:'video/mp4',path:'output/playwright/fixtures/webdav-video.mp4'});throw Error('Unexpected mock provider request');}if([base,dav].includes(u.origin)||!['http:','https:'].includes(u.protocol))return route.continue();blocked.push(u.origin+u.pathname);return route.abort('blockedbyclient');};
  const prepare=async p=>{p.on('dialog',d=>{if(d.type()==='beforeunload')void d.accept().catch(()=>{});});await p.route('**/*',guard);};
  const ready=async p=>{await p.evaluate(async()=>{window.__davLoad=p=>import(performance.getEntriesByType('resource').find(e=>new URL(e.name).pathname===p)?.name||p);window.__davStore=(await window.__davLoad('/src/stores/canvas/use-canvas-store.ts')).useCanvasStore;window.__davWriter=(await window.__davLoad('/src/lib/write-ownership.ts')).writeOwnership;});await p.waitForFunction(()=>window.__davWriter.canWrite()&&window.__davStore.getState().hydrated);};
  const projects=p=>p.evaluate(()=>window.__davStore.getState().projects);
  const fixture=path=>page.evaluate(async url=>{const r=await fetch(url);if(!r.ok)throw Error('Fixture unavailable');return r.json();},dav+'/fixture/'+path);
  const waitFixture=async predicate=>{for(let i=0;i<100;i++){const state=await fixture('state');if(predicate(state))return state;await page.waitForTimeout(100);}throw Error('Fixture state did not reach expected revision');};
  const settings=async p=>{
    if(new URL(p.url()).origin===base)await p.getByRole('link',{name:'设置',exact:true}).click();else await p.goto(base+'/config');await ready(p);await p.getByText('高级',{exact:true}).click();await p.getByRole('tab',{name:'WebDAV',exact:true}).click();
    await p.getByPlaceholder('https://nas.example.com/webdav').fill(dav);
    for(const [label,value]of [['远程目录','acceptance'],['用户名','fixture'],['密码 / 应用密码','fixture-password']])await p.locator('.ant-form-item').filter({has:p.locator('label').getByText(label,{exact:true})}).locator('input').fill(value);
  };
  const sync=async(p,conflict=false)=>{
    await p.getByRole('button',{name:'立即同步',exact:true}).click();
    if(conflict){const dialog=p.getByRole('dialog',{name:'同步已完成，冲突双方已保留'});await dialog.waitFor();await dialog.locator('.ant-modal-confirm-btns').getByRole('button').click();}
    else await p.getByText(/^同步完成：/).waitFor();
    await p.getByRole('button',{name:'立即同步',exact:true}).waitFor();
  };
  const edit=async(p,projectId,text)=>{
    if(new URL(p.url()).pathname!=='/canvas/'+projectId)await p.goto(base+'/canvas/'+projectId);await ready(p);
    const current=(await projects(p)).find(v=>v.id===projectId),node=current.nodes.find(n=>n.type==='text');
    const target=p.locator(`[data-node-id="${node.id}"]`);await target.dblclick({position:{x:20,y:30}});await target.locator('textarea').fill(text);await p.keyboard.press('Escape');
    await p.waitForFunction(({id,text})=>window.__davStore.getState().projects.find(v=>v.id===id)?.nodes.some(n=>n.metadata.content===text),{id:projectId,text});
  };
  const seedContent=async(p,png)=>{
    await p.getByRole('link',{name:'素材',exact:true}).click();
    await p.getByRole('button',{name:'新增素材',exact:true}).click();
    let modal=p.getByRole('dialog',{name:'新增素材',exact:true});
    await modal.getByPlaceholder('给素材起一个容易检索的名字').fill('同步文本素材');
    await modal.getByPlaceholder('保存提示词、说明文案、参考描述等文本素材').fill('双端保留的原始说明');
    await modal.getByRole('button',{name:/^保\s*存$/}).click();await modal.waitFor({state:'hidden'});
    await p.getByRole('button',{name:'新增素材',exact:true}).click();modal=p.getByRole('dialog',{name:'新增素材',exact:true});
    await modal.getByRole('combobox').first().click();await p.locator('.ant-select-dropdown').getByText('图片',{exact:true}).click();
    await modal.getByPlaceholder('给素材起一个容易检索的名字').fill('同步图片素材');
    await modal.locator('input[type="file"]').nth(1).setInputFiles({name:'asset-sync.png',mimeType:'image/png',buffer:Buffer.from(png,'base64')});
    await modal.getByText(/80x40/).waitFor();await modal.getByRole('button',{name:/^保\s*存$/}).click();await modal.waitFor({state:'hidden'});
    await p.evaluate(async provider=>{const {useConfigStore}=await window.__davLoad('/src/stores/use-config-store.ts');window.__davTasks=(await window.__davLoad('/src/features/tasks/task-store.ts')).useTaskStore;const patch={channels:[{id:'sync-mock',name:'同步验收替身',baseUrl:provider+'/v1',apiKey:'fixture-key',apiFormat:'openai',models:[{name:'gpt-image-1',capability:'image'},{name:'sora-2',capability:'video'}]}],imageModel:'sync-mock::gpt-image-1',videoModel:'sync-mock::sora-2',proxyEnabled:false};for(const [k,v]of Object.entries(patch))useConfigStore.getState().updateConfig(k,v);},provider);
    for(const mode of ['image','video']){
      await p.getByRole('link',{name:mode==='image'?'生图':'视频',exact:true}).click();
      await p.getByRole('button',{name:mode==='image'?'落笔生成':'生成视频',exact:true}).waitFor();
      await p.getByRole('textbox',{name:'提示词',exact:true}).fill(mode==='image'?'图片记录同步验收':'视频记录同步验收');
      await p.getByRole('button',{name:mode==='image'?'落笔生成':'生成视频',exact:true}).click();
      await p.getByRole('button',{name:'送入画布',exact:true}).waitFor();
      await p.waitForFunction(mode=>window.__davTasks.getState().tasks.some(t=>t.sourcePath==='/'+mode&&t.phase==='done'&&t.saveState==='saved'),mode);
    }
  };
  const content=async p=>p.evaluate(async()=>{
    const {useAssetStore,flushAssetSave}=await window.__davLoad('/src/stores/use-asset-store.ts');if(!useAssetStore.getState().hydrated)await useAssetStore.persist.rehydrate();await flushAssetSave();
    const {STORAGE_NS}=await window.__davLoad('/src/constant/brand.ts');
    const db=await new Promise((resolve,reject)=>{const r=indexedDB.open(STORAGE_NS);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
    const read=name=>new Promise((resolve,reject)=>{const r=db.transaction(name).objectStore(name).getAll();r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
    let image,video;try{image=await read('image_generation_logs');video=await read('video_generation_logs');}finally{db.close();}
    const assets=useAssetStore.getState().assets,keys=new Set();
    const visit=value=>{if(value&&typeof value==='object'){if(typeof value.storageKey==='string'&&/^(image|video|audio|file):.+/.test(value.storageKey))keys.add(value.storageKey);Object.values(value).forEach(visit);}};visit({assets,image,video});
    const {getImageBlob}=await window.__davLoad('/src/services/image-storage.ts'),{getMediaBlob}=await window.__davLoad('/src/services/file-storage.ts');
    const files=[];for(const key of [...keys].sort()){const blob=await(key.startsWith('image:')?getImageBlob(key):getMediaBlob(key));if(!blob)throw Error('Missing synchronized media '+key);const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer())),v=>v.toString(16).padStart(2,'0')).join('');files.push({key,bytes:blob.size,digest});}
    return{assets:assets.map(a=>({id:a.id,title:a.title,kind:a.kind,...(a.kind==='text'?{content:a.data.content}:{storageKey:a.data.storageKey})})).sort((a,b)=>a.id.localeCompare(b.id)),image:image.map(v=>({id:v.id,status:v.status,creationId:v.creation?.id})),video:video.map(v=>({id:v.id,status:v.status,remoteId:v.task?.id,creationId:v.creation?.id})),files};
  });
  const useRestoredHistory=async(p,expected)=>{
    const before=calls.length,downloadHashes=[];
    for(const mode of ['image','video']){
      await p.getByRole('link',{name:mode==='image'?'生图':'视频',exact:true}).click();
      await p.getByRole('button',{name:mode==='image'?'落笔生成':'生成视频',exact:true}).waitFor();
      await p.getByText(/^历史\s*·\s*1$/).click();
      await p.getByRole('button',{name:mode==='image'?/图片记录同步验收/:/视频记录同步验收/}).click();
      if(mode==='image'){
        const size=await p.getByRole('img',{name:'生成结果 1',exact:true}).evaluate(async img=>{await img.decode();return{width:img.naturalWidth,height:img.naturalHeight};});
        if(size.width!==80||size.height!==40)throw Error('Restored image preview cannot decode original dimensions');
      }else{
        const playback=await p.locator('video').first().evaluate(async video=>{video.muted=true;await video.play();await new Promise(resolve=>video.requestVideoFrameCallback(resolve));const info={width:video.videoWidth,height:video.videoHeight,duration:video.duration};video.pause();return info;});
        if(playback.width!==160||playback.height!==90||Math.abs(playback.duration-1)>0.1)throw Error('Restored video cannot play original frames');
      }
      const waiting=p.waitForEvent('download');await p.getByRole('button',{name:'下载',exact:true}).click();
      const download=await waiting,stream=await download.createReadStream(),chunks=[];for await(const chunk of stream)chunks.push(chunk);
      const bytes=Buffer.concat(chunks),digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),v=>v.toString(16).padStart(2,'0')).join('');
      if(!expected.files.some(file=>file.digest===digest&&file.bytes===bytes.length))throw Error('Downloaded restored result differs from saved original');
      downloadHashes.push({mode,bytes:bytes.length,digest});
    }
    if(calls.length!==before)throw Error('Opening restored history requested a provider or resubmitted generation');
    return downloadHashes;
  };
  let context,second,phase='create';
  try{
    await prepare(page);await page.goto(base+'/canvas');await ready(page);
    await page.getByRole('button',{name:'新建画布',exact:true}).first().click();await page.waitForURL(/\/canvas\//);
    const projectId=new URL(page.url()).pathname.split('/').pop();
    await page.getByRole('button',{name:'关闭画布引导',exact:true}).click();
    await page.getByRole('toolbar',{name:'笔架'}).getByRole('button',{name:'文本',exact:true}).click();
    await page.waitForFunction(()=>window.__davStore.getState().projects[0]?.nodes.length===1);
    await edit(page,projectId,'同步基线');
    const png=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=80;c.height=40;return c.toDataURL('image/png').split(',')[1];});
    await page.locator('input[accept*="audio/mpeg"]').setInputFiles({name:'sync.png',mimeType:'image/png',buffer:Buffer.from(png,'base64')});
    await page.waitForFunction(()=>window.__davStore.getState().projects[0].nodes.length===2);
    const mediaHash=async p=>p.evaluate(async()=>{const key=window.__davStore.getState().projects[0].nodes.find(n=>n.type==='image').metadata.storageKey;const blob=await(await window.__davLoad('/src/services/image-storage.ts')).getImageBlob(key);if(!blob)throw Error('Missing sync media');return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer())),v=>v.toString(16).padStart(2,'0')).join('');});
    const originalHash=await mediaHash(page);
    phase='nonempty business data';generatedPNG=png;await seedContent(page,png);const originalContent=await content(page);if(originalContent.assets.length!==2||originalContent.image.length!==1||originalContent.video.length!==1||originalContent.files.length!==3||calls.filter(c=>c.method==='POST').length!==2)throw Error('Business content fixture incomplete');
    phase='first sync';await settings(page);await page.getByRole('button',{name:'测试连接',exact:true}).click();await page.getByText('WebDAV 连接可用',{exact:true}).waitFor();await sync(page);
    let state=await fixture('state');if(JSON.stringify(state.manifests).includes('fixture-key'))throw Error('Sync manifest leaked provider credentials');if(state.manifests.length!==4)throw Error('Initial sync did not commit four domains');
    phase='empty second device';context=await page.context().browser().newContext();second=await context.newPage();await prepare(second);await settings(second);await sync(second);
    if((await projects(second)).length!==1||await mediaHash(second)!==originalHash)throw Error('Empty device did not restore original project/media');
    const syncedContent=await content(second);if(JSON.stringify(syncedContent)!==JSON.stringify(originalContent))throw Error('Nonempty assets or generation receipts differ across devices');
    await second.getByRole('link',{name:'素材',exact:true}).click();await second.getByRole('heading',{name:'同步文本素材',exact:true}).waitFor();await second.getByRole('heading',{name:'同步图片素材',exact:true}).waitFor();
    phase='restored history usage';const historyDownloads=await useRestoredHistory(second,originalContent);
    phase='divergent edits';await edit(page,projectId,'设备 A 修改');await settings(page);await sync(page,true);
    await edit(second,projectId,'设备 B 修改');await settings(second);await sync(second,true);
    const copies=await projects(second),texts=copies.map(p=>p.nodes.find(n=>n.type==='text')?.metadata.content);
    if(copies.length<2||new Set(copies.map(p=>p.id)).size!==copies.length||!texts.includes('设备 A 修改')||!texts.includes('设备 B 修改')||await mediaHash(second)!==originalHash)throw Error('Divergent edits or media lost');
    phase='backup restore';await second.getByRole('button',{name:'恢复同步前备份',exact:true}).click();
    const reloaded=second.waitForEvent('domcontentloaded');await second.getByRole('dialog',{name:'恢复上次同步前的本地数据？'}).getByRole('button',{name:'恢复本地备份',exact:true}).click();
    await reloaded;await ready(second);
    const restored=await projects(second);if(restored.length!==1||restored[0].nodes.find(n=>n.type==='text').metadata.content!=='设备 B 修改'||await mediaHash(second)!==originalHash)throw Error('Backup did not restore original local edit/media');
    if(JSON.stringify(await content(second))!==JSON.stringify(originalContent))throw Error('Backup changed nonempty business records/media');
    phase='history after backup reload';const backupDownloads=await useRestoredHistory(second,originalContent);if(JSON.stringify(backupDownloads)!==JSON.stringify(historyDownloads))throw Error('Backup reload changed usable history downloads');
    phase='concurrent revision race';
    await edit(page,projectId,'设备 A 并发修改');await settings(page);
    await edit(second,projectId,'设备 B 并发修改');await settings(second);
    const putsBefore=(await fixture('state')).requests.filter(r=>r.method==='PUT'&&r.path.endsWith('/canvas/manifest.json')).length;
    const otherEtags=Object.fromEntries((await fixture('state')).manifests.filter(m=>!m.path.endsWith('/canvas/manifest.json')).map(m=>[m.path,m.etag]));
    await fixture('hold');await second.getByRole('button',{name:'立即同步',exact:true}).click();
    await waitFixture(state=>state.held);
    await waitFixture(state=>Object.entries(otherEtags).every(([path,etag])=>state.manifests.find(m=>m.path===path)?.etag!==etag));
    await sync(page,true);await fixture('release');
    const partial=second.getByRole('dialog',{name:'同步部分未完成',exact:true});await partial.waitFor();
    await partial.getByText(/已重新读取远端/).waitFor();
    const race=await fixture('state'),remoteRace=race.manifests.find(m=>m.path.endsWith('/canvas/manifest.json')).value.data.projects;
    if(race.requests.filter(r=>r.method==='PUT'&&r.path.endsWith('/canvas/manifest.json')).length!==putsBefore+2||!remoteRace.some(p=>p.nodes.some(n=>n.metadata.content==='设备 A 并发修改'))||remoteRace.some(p=>p.nodes.some(n=>n.metadata.content==='设备 B 并发修改'))||(await projects(second)).length!==1||(await projects(second))[0].nodes.find(n=>n.type==='text').metadata.content!=='设备 B 并发修改')throw Error('CAS conflict overwrote either device or automatically retried');
    await partial.locator('.ant-modal-confirm-btns').getByRole('button').click();
    phase='unsupported conditions';await fixture('ignore-conditions');await settings(second);
    const before=(await fixture('state')).requests.filter(r=>r.method==='PUT'&&r.path.endsWith('/manifest.json')).length;
    await second.getByRole('button',{name:'立即同步',exact:true}).click();await second.getByText(/WebDAV 未提供可靠条件写入/).first().waitFor();
    state=await fixture('state');if(state.requests.filter(r=>r.method==='PUT'&&r.path.endsWith('/manifest.json')).length!==before)throw Error('Unsupported conditions wrote manifests');
    if(blocked.length)throw Error('Unexpected external request '+JSON.stringify(blocked));
    return{transport:'actual loopback HTTP, CORS, Basic auth and exposed strong ETag',initial:'four domains committed',emptyDevice:'original project and PNG SHA-256 recovered',divergentEdits:'both copies retained',backup:'local B edit and original image restored after reload',concurrentWrite:'stale ETag refused; remote A and local B retained; no retry',unsupportedConditions:'zero manifest writes',nonemptyDomains:'two assets, one image receipt, one video receipt and all three original files match across devices and backup reload',restoredHistory:'image decodes, video plays, both downloads match originals before and after backup reload',historyDownloads,mockGenerationRequests:2,realGenerationRequests:0};
  }catch(error){await page.screenshot({path:'output/playwright/evidence/webdav-failure.png'});if(second)await second.screenshot({path:'output/playwright/evidence/webdav-second-failure.png'});return{failure:phase+': '+error.message};}
  finally{if(context)await context.close();}
}
