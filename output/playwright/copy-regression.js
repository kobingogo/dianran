async (page) => {
  page.on("dialog", (dialog) => { if (dialog.type() === "beforeunload") void dialog.accept().catch(() => {}); });
  await page.goto('http://127.0.0.1:4317/');
  await page.getByRole('textbox', {name:'提示词',exact:true}).waitFor();
  const id = await page.evaluate(async () => {
    const { useCanvasStore, flushCanvasSave } = await import('/src/stores/canvas/use-canvas-store.ts');
    if (!useCanvasStore.getState().hydrated) await useCanvasStore.persist.rehydrate();
    const id = useCanvasStore.getState().createProject('复制状态回归');
    useCanvasStore.getState().updateProject(id, { nodes: [
      {id:'group-test',type:'group',title:'测试组',position:{x:50,y:50},width:600,height:350},
      {id:'video-test',type:'video',title:'生成中视频',position:{x:100,y:100},width:300,height:200,metadata:{groupId:'group-test',status:'loading',videoTaskId:'test-task',videoTaskProvider:'openai'}}
    ] });
    await flushCanvasSave();
    return id;
  });
  await page.waitForTimeout(600);
  await page.goto('http://127.0.0.1:4317/canvas/' + id);
  await page.locator('[data-node-id="group-test"]').waitFor();
  await page.evaluate(() => { document.activeElement?.blur(); window.getSelection()?.removeAllRanges(); });
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Control+c');
  await page.keyboard.press('Control+v');
  await page.waitForTimeout(800);
  const nodes = await page.evaluate(async (id) => {
    const { useCanvasStore } = await import('/src/stores/canvas/use-canvas-store.ts');
    return useCanvasStore.getState().openProject(id).nodes.map(n => ({id:n.id,type:n.type,status:n.metadata?.status,task:n.metadata?.videoTaskId,group:n.metadata?.groupId}));
  }, id);
  const copies = nodes.filter(n => n.id !== 'group-test' && n.id !== 'video-test');
  if (copies.length !== 2) throw new Error('Paste must create one group and one member');
  if (copies.some(n => n.task || n.status === 'loading')) throw new Error('Copy inherited a running task');
  if (!nodes.some(n => n.id === 'video-test' && n.task === 'test-task')) throw new Error('Original task changed');
  if (copies.find(n => n.type === 'video').group !== copies.find(n => n.type === 'group').id) throw new Error('Copy group identity mismatch');
  await page.locator('[data-node-id="group-test"]').click({button:'right',position:{x:10,y:10}});
  await page.getByRole('button', {name:'复制',exact:true}).click();
  await page.waitForTimeout(800);
  const duplicate = await page.evaluate(async (id) => {
    const { useCanvasStore } = await import('/src/stores/canvas/use-canvas-store.ts');
    const nodes = useCanvasStore.getState().openProject(id).nodes;
    const copies = nodes.filter(n => n.id !== 'group-test' && n.id !== 'video-test');
    if (nodes.length !== 6 || copies.some(n => n.metadata?.videoTaskId || n.metadata?.status === 'loading')) throw new Error('Group duplicate inherited task');
    if (nodes.find(n => n.id === 'video-test').metadata.videoTaskId !== 'test-task') throw new Error('Original task changed');
    return {passed:true,nodeCount:nodes.length,copyCount:copies.length};
  }, id);
  return {passed:true,projectId:id,paste:nodes,duplicate};
}
