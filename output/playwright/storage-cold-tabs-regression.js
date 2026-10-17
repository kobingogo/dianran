async page => {
 const context=await page.context().browser().newContext(),base='http://127.0.0.1:4317',pages=[],errors=[];
 try{
  pages.push(...await Promise.all([context.newPage(),context.newPage()]));
  pages.forEach((p,i)=>p.on('pageerror',error=>errors.push({page:i,error:error.message})));
  await Promise.all(pages.map((p,i)=>p.goto(base+(i?'/video':'/image'))));
  await Promise.all(pages.map(p=>p.getByRole('textbox',{name:'提示词',exact:true}).waitFor()));
  const reference=await pages[0].evaluate(()=>{const c=document.createElement('canvas');c.width=64;c.height=32;return c.toDataURL('image/png').split(',')[1];});
  const before=await pages[0].evaluate(()=>indexedDB.databases());
  await Promise.all(pages.map((p,i)=>p.getByRole('textbox',{name:'提示词',exact:true}).fill(i?'视频页首次输入':'图片页首次输入')));
  await Promise.all(pages.map((p,i)=>p.locator('input[accept="image/*"]').setInputFiles({name:'tab-'+i+'.png',mimeType:'image/png',buffer:Buffer.from(reference,'base64')})));
  await Promise.all(pages.map((p,i)=>p.getByRole('img',{name:'tab-'+i+'.png',exact:true}).waitFor()));
  const saved=await Promise.all(pages.map((p,i)=>p.evaluate(async mode=>{
   const url=performance.getEntriesByType('resource').find(e=>new URL(e.name).pathname==='/src/stores/use-composer-store.ts').name;
   const module=await import(url);await module.flushComposerSave();return module.useComposerStore.getState()[mode].references[0].storageKey;
  },i?'video':'image')));
  await Promise.all(pages.map(p=>p.reload()));
  await Promise.all(pages.map((p,i)=>p.getByRole('img',{name:'tab-'+i+'.png',exact:true}).waitFor()));
  const restored=await Promise.all(pages.map((p,i)=>p.evaluate(async mode=>{
   const load=path=>import(performance.getEntriesByType('resource').find(e=>new URL(e.name).pathname===path).name);
   const composer=(await load('/src/stores/use-composer-store.ts')).useComposerStore;
   const ref=composer.getState()[mode].references[0],blob=await(await load('/src/services/image-storage.ts')).getImageBlob(ref.storageKey);
   return{prompt:composer.getState()[mode].prompt,key:ref.storageKey,bytes:btoa(String.fromCharCode(...new Uint8Array(await blob.arrayBuffer())))};
  },i?'video':'image')));
  if(restored.some((v,i)=>v.key!==saved[i]||v.bytes!==reference||v.prompt!==(i?'视频页首次输入':'图片页首次输入')))throw Error('Concurrent cold pages lost a draft reference or original file');
  const after=await pages[0].evaluate(()=>indexedDB.databases());
  if(JSON.stringify(before)!==JSON.stringify(after))throw Error('First uploads triggered another database schema upgrade');
  return{sharedStorage:true,pages:['image','video'],drafts:'separate image/video prompts retained after simultaneous reload',uploads:'both original files retained after simultaneous reload',schema:'unchanged after initial readiness'};
 }catch(error){
  const states=await Promise.all(pages.map(async(p,i)=>{await p.screenshot({path:'output/playwright/evidence/storage-cold-tabs-page-'+i+'.png'}).catch(()=>{});return{url:p.url(),body:await p.locator('body').innerText().catch(()=>''),errors:errors.filter(e=>e.page===i)};}));
  throw new Error(error.message+'\nCold page states: '+JSON.stringify(states));
 }finally{await context.close();}
}
