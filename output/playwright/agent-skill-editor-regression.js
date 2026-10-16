async page => {
  const base='http://127.0.0.1:4317',agent='http://127.0.0.1:4318',control='http://127.0.0.1:4319',name='fixture-managed-skill',display='隔离技能验收',blocked=[];
  const conversation={revision:3,conversationId:'fixture-external',threadId:'fixture-external',status:'ready',mcpStatuses:{}};
  const responses=[];
  page.on('response',r=>{if(r.url().startsWith(agent+'/agent/codex/skills'))responses.push({method:r.request().method(),path:new URL(r.url()).pathname,status:r.status()});});
  await page.route('**/*',async route=>{
    const r=route.request(),u=new URL(r.url()),json=data=>route.fulfill({headers:{'Access-Control-Allow-Origin':base,'Access-Control-Allow-Headers':'content-type','Access-Control-Allow-Methods':'GET, POST, OPTIONS'},contentType:'application/json',body:JSON.stringify(data)});
    if(u.origin===base||u.origin===control||!['http:','https:'].includes(u.protocol))return route.continue();
    if(u.origin===agent){
      if(u.pathname==='/agent/codex/skills'&&r.method()==='GET'){const catalog=await route.fetch({url:control+'/skills'});return json(await catalog.json());}
      if(u.pathname==='/agent/codex/models'||u.pathname==='/agent/media/capabilities')return json({ok:true,data:[]});
      if(u.pathname==='/agent/codex/threads')return json({ok:true,conversation,data:[{id:'fixture-external',preview:'隔离技能验收'}],workspace:{activeThreadId:'fixture-external',workspacePath:'/fixture'}});
      if(u.pathname==='/agent/codex/threads/fixture-external')return json({ok:true,thread:{id:'fixture-external'},messages:[],settledTurnIds:[],historyReady:true});
      if(u.pathname==='/agent/codex/history/ack')return json({ok:true});
      if(['/health','/config','/events','/canvas/state','/canvas/activate','/agent/codex/interactions'].includes(u.pathname)||(r.method()==='GET'&&u.pathname.startsWith('/agent/media/tasks'))||u.pathname==='/agent/codex/skills'||new RegExp('^/agent/codex/skills/'+name+'(?:/(?:resource|versions|delete))?$').test(u.pathname))return route.continue();
    }
    blocked.push({method:r.method(),path:u.pathname});return route.abort('blockedbyclient');
  });
  const detail=()=>page.evaluate(async({agent,name})=>{const r=await fetch(agent+'/agent/codex/skills/'+name+'?token=external-fixture-token');return{status:r.status,...await r.json()};},{agent,name});
  const confirm=async title=>{const modal=page.getByRole('dialog',{name:title,exact:true});await modal.getByRole('button',{name:/确\s*定|删\s*除/}).click();await modal.waitFor({state:'hidden'});};
  let phase='connect';
  try{
    await page.goto(base+'/canvas');
    await page.evaluate(async()=>{window.__skillsLoad=p=>import(performance.getEntriesByType('resource').find(e=>new URL(e.name).pathname===p)?.name||p);window.__skillsAgent=(await window.__skillsLoad('/src/stores/use-agent-store.ts')).useAgentStore;window.__skillsCanvas=(await window.__skillsLoad('/src/stores/canvas/use-canvas-store.ts')).useCanvasStore;window.__skillsWriter=(await window.__skillsLoad('/src/lib/write-ownership.ts')).writeOwnership;});
    await page.waitForFunction(()=>window.__skillsCanvas.getState().hydrated&&window.__skillsWriter.canWrite());
    await page.getByRole('button',{name:'新建画布',exact:true}).first().click();await page.waitForURL(/\/canvas\//);
    await page.getByRole('button',{name:'打开 Agent',exact:true}).click();await page.getByRole('textbox',{name:/本地地址/}).fill(agent);await page.getByLabel(/连接 Token/).fill('external-fixture-token');
    await page.waitForFunction(()=>window.__skillsAgent.getState().connected);
    await page.getByRole('tab',{name:'技能',exact:true}).click();
    phase='create';await page.getByRole('button',{name:'创建 Skill',exact:true}).click();await page.getByRole('menuitem').filter({hasText:'空白创建'}).click();
    let editor=page.getByRole('dialog',{name:'创建 Skill',exact:true});
    await editor.getByLabel('Skill 标识',{exact:true}).fill(name);await editor.getByLabel(/^显示名称/).fill(display);await editor.getByLabel('何时使用',{exact:true}).fill('用于隔离验证技能管理的本地文件读写。');await editor.getByLabel('执行说明',{exact:true}).fill('先读取参考资料，再输出验收说明。');
    await editor.getByRole('button',{name:'创建 Skill',exact:true}).click();await editor.waitFor({state:'hidden'});await page.getByRole('button',{name:'编辑 '+display,exact:true}).waitFor();
    const created=await detail();if(!created.data?.revision||!created.data.path.includes('dianran-skill-editor-'))throw Error('Skill was not created in isolated actual workspace');
    phase='edit';await page.getByRole('button',{name:'编辑 '+display,exact:true}).click();editor=page.getByRole('dialog',{name:'编辑 '+display,exact:true});await editor.getByLabel('执行说明',{exact:true}).waitFor();if(await editor.getByLabel('Skill 标识',{exact:true}).inputValue()!==name||await editor.getByLabel(/^显示名称/).inputValue()!==display||await editor.getByLabel('何时使用',{exact:true}).inputValue()!==created.data.description||await editor.getByLabel('执行说明',{exact:true}).inputValue()!==created.data.instructions)throw Error('Editor did not populate the saved Skill');await editor.getByLabel('执行说明',{exact:true}).fill('先读取 references/brand.md，再验证实际文件。');await editor.getByRole('button',{name:'保存更改',exact:true}).click();await editor.waitFor({state:'hidden'});
    const edited=await detail();if(edited.data.revision===created.data.revision||!edited.data.instructions.includes('references/brand.md'))throw Error('Edited instructions did not reach disk');
    phase='new blank after edit';await page.getByRole('button',{name:'创建 Skill',exact:true}).click();await page.getByRole('menuitem').filter({hasText:'空白创建'}).click();editor=page.getByRole('dialog',{name:'创建 Skill',exact:true});await editor.getByLabel('Skill 标识',{exact:true}).waitFor();if(await editor.getByLabel('Skill 标识',{exact:true}).inputValue()||await editor.getByLabel('执行说明',{exact:true}).inputValue())throw Error('New blank form retained the edited Skill');await editor.getByRole('button',{name:/取\s*消/}).click();await editor.waitFor({state:'hidden'});
    phase='delete';await page.getByRole('button',{name:'删除 '+display,exact:true}).click();await confirm('删除 '+display);await page.getByRole('button',{name:'编辑 '+display,exact:true}).waitFor({state:'hidden'});if((await detail()).status!==404)throw Error('Deleted Skill remains on disk');
    if(blocked.length)throw Error('Unexpected native or external endpoint: '+JSON.stringify(blocked));
    return{service:'actual isolated HTTP and temporary SkillStore',catalog:'fixture reads isolated files; native model and history responses replaced',created:true,edit:'all saved fields populated; instructions updated on disk',blank:'edited values cleared on new blank creation',deleted:true,nativeTurns:0,responses};
  }catch(error){await page.screenshot({path:'output/playwright/evidence/agent-skill-editor-failure.png'});throw Error(phase+': '+error.message);}
}
