async page => {
  const base='http://127.0.0.1:4317',external=[];
  page.on('dialog',d=>{if(d.type()==='beforeunload')void d.accept().catch(()=>{});});
  await page.route('**/*',route=>{const r=route.request(),u=new URL(r.url());if(u.origin===base||!['http:','https:'].includes(u.protocol))return route.continue();external.push(r.method()+' '+u.origin+u.pathname);return route.abort('blockedbyclient');});
  const ready=async()=>{
    await page.evaluate(async()=>{window.__undoLoad=p=>import(performance.getEntriesByType('resource').find(e=>new URL(e.name).pathname===p)?.name||p);window.__undoCanvas=(await window.__undoLoad('/src/stores/canvas/use-canvas-store.ts')).useCanvasStore;window.__undoAgent=(await window.__undoLoad('/src/stores/use-agent-store.ts')).useAgentStore;window.__undoWriter=(await window.__undoLoad('/src/lib/write-ownership.ts')).writeOwnership;});
    await page.waitForFunction(()=>window.__undoCanvas.getState().hydrated&&window.__undoWriter.canWrite());
  };
  let phase='setup';
  try{
    await page.goto(base+'/canvas');
  await page.getByRole('button',{name:'新建画布',exact:true}).first().waitFor();await ready();await page.getByRole('button',{name:'新建画布',exact:true}).first().click();await page.waitForURL(/\/canvas\//);
    const projectId=new URL(page.url()).pathname.split('/').pop();
    await page.getByRole('button',{name:'关闭画布引导',exact:true}).click();
    const toolbar=page.getByRole('toolbar',{name:'笔架',exact:true});await toolbar.getByRole('button',{name:'文本',exact:true}).click();
    await page.waitForFunction(()=>window.__undoCanvas.getState().projects[0].nodes.length===1);
    const original=await page.evaluate(()=>window.__undoCanvas.getState().projects[0].nodes[0]);
    const originalNode=page.locator(`[data-node-id="${original.id}"]`);await originalNode.dblclick();await originalNode.locator('textarea').fill('用户原始文本');await page.keyboard.press('Escape');await page.keyboard.press('Escape');await toolbar.getByRole('button',{name:'文本',exact:true}).waitFor();
    await page.waitForFunction(id=>window.__undoCanvas.getState().projects[0].nodes.find(n=>n.id===id)?.metadata.content==='用户原始文本',original.id);
    const apply=()=>page.evaluate(async id=>{const c=window.__undoAgent.getState().canvasContext;return c.applyOps([{type:'update_node',id,metadata:{content:'Agent 修改文本'}},{type:'add_node',id:'agent-added',nodeType:'text',metadata:{content:'Agent 新增文本'},position:{x:0,y:0}}]);},original.id);
    phase='normal bridge undo';const first=await apply();if(!first.receipt.saved||first.receipt.generation!=='not-requested')throw Error('Agent edits were not durably saved');
    await page.waitForFunction(()=>window.__undoAgent.getState().canvasContext?.canUndo===true);
    await page.evaluate(()=>window.__undoAgent.getState().canvasContext.undoOps());
    await page.waitForFunction(()=>window.__undoCanvas.getState().projects[0].nodes.length===1);
    if(await page.evaluate(id=>window.__undoCanvas.getState().projects[0].nodes.find(n=>n.id===id)?.metadata.content,original.id)!=='用户原始文本')throw Error('Normal undo did not restore original content');
    const second=await apply();await page.waitForFunction(revision=>{const c=window.__undoAgent.getState().canvasContext;return c?.canUndo===true&&c.getSnapshot().revision===revision;},second.revision);
    await page.evaluate(()=>{window.__capturedContext=window.__undoAgent.getState().canvasContext;});
    phase='later UI edit';await toolbar.getByRole('button',{name:'文本',exact:true}).click();await page.waitForFunction(()=>window.__undoCanvas.getState().projects[0].nodes.length===3);
    const userId=await page.evaluate(originalId=>window.__undoCanvas.getState().projects[0].nodes.find(n=>![originalId,'agent-added'].includes(n.id)).id,original.id);
    const userNode=page.locator(`[data-node-id="${userId}"]`);await userNode.dblclick();await userNode.locator('textarea').fill('Agent 之后的用户新编辑');await page.keyboard.press('Escape');
    await page.waitForFunction(id=>window.__undoCanvas.getState().projects[0].nodes.find(n=>n.id===id)?.metadata.content==='Agent 之后的用户新编辑',userId);
    const refused=await page.evaluate(async()=>{try{await window.__capturedContext.undoOps();return '';}catch(error){return error.message;}});
    if(!refused.includes('已有新编辑'))throw Error('Stale undo did not refuse subsequent user edits: '+refused);
    await page.waitForFunction(()=>window.__undoAgent.getState().canvasContext?.canUndo===false);
    const preserved=await page.evaluate(async()=>{await(await window.__undoLoad('/src/stores/canvas/use-canvas-store.ts')).flushCanvasSave();return JSON.stringify(window.__undoCanvas.getState().projects[0].nodes);});
    phase='stale bridge after navigation';await page.getByRole('link',{name:'画布',exact:true}).click();await page.getByRole('button',{name:'新建画布',exact:true}).first().click();await page.waitForURL(/\/canvas\//);
    const otherId=new URL(page.url()).pathname.split('/').pop();await page.waitForFunction(id=>window.__undoAgent.getState().canvasContext?.getSnapshot().projectId===id,otherId);
    const stale=await page.evaluate(async()=>{try{await window.__capturedContext.applyOps([{type:'add_node',id:'stale-write',nodeType:'text',metadata:{content:'不应写入的旧页面操作'}}]);return '';}catch(error){return error.message;}});
    if(!stale)throw Error('An obsolete bridge wrote after switching projects');
    const final=await page.evaluate(async({projectId,otherId,preserved})=>{await(await window.__undoLoad('/src/stores/canvas/use-canvas-store.ts')).flushCanvasSave();const s=window.__undoCanvas.getState();return{originalUnchanged:JSON.stringify(s.openProject(projectId).nodes)===preserved,currentEmpty:s.openProject(otherId).nodes.length===0};},{projectId,otherId,preserved});
    if(!final.originalUnchanged||!final.currentEmpty||external.length)throw Error('Guard changed either project or requested an external service');
    phase='return to original project';const originalTitle=await page.evaluate(id=>window.__undoCanvas.getState().openProject(id).title,projectId);
    await page.getByRole('link',{name:'画布',exact:true}).click();
    await page.locator('article').filter({has:page.getByRole('heading',{name:originalTitle,exact:true})}).click();await page.waitForURL(base+'/canvas/'+projectId);
    await page.waitForFunction(id=>window.__undoAgent.getState().canvasContext?.getSnapshot().projectId===id,projectId);
    const returned=await page.evaluate(async({projectId,preserved})=>{
      const refused=[];
      for(const operation of [()=>window.__capturedContext.applyOps([{type:'add_node',id:'returned-stale',nodeType:'text'}]),()=>window.__capturedContext.undoOps(),()=>window.__capturedContext.importMediaNodes([{id:'returned-import',type:'text',position:{x:0,y:0},width:100,height:80,metadata:{content:'不应导入'}}])]){try{await operation();refused.push(false);}catch{refused.push(true);}}
      return refused.every(Boolean)&&JSON.stringify(window.__undoCanvas.getState().openProject(projectId).nodes)===preserved;
    },{projectId,preserved});
    if(!returned)throw Error('A → B → A reactivated an obsolete bridge or lost user edits');
    return{scope:'real React bridge, simulated Agent edits; actual UI user edits',normalUndo:'original content restored',laterEdit:'stale undo rejected; new text retained',navigation:'obsolete apply rejected; both projects preserved',returnToOriginal:'A → B → A keeps old apply, undo and media import invalid',generationRequests:0,...final};
  }catch(error){await page.screenshot({path:'output/playwright/evidence/agent-undo-guard-failure.png'});throw Error(phase+': '+error.message);}
}
