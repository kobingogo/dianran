async (page) => {
  page.on("dialog", (dialog) => { if (dialog.type() === "beforeunload") void dialog.accept().catch(() => {}); });
  const base = 'http://127.0.0.1:4317';
  await page.goto(base + '/canvas');
  await page.getByRole('button', {name:'新建画布',exact:true}).first().waitFor();
  const id = await page.evaluate(async () => {
    const { useCanvasStore, flushCanvasSave } = await import('/src/stores/canvas/use-canvas-store.ts');
    if (!useCanvasStore.getState().hydrated) await useCanvasStore.persist.rehydrate();
    const id = useCanvasStore.getState().createProject('保存可靠性');
    await flushCanvasSave();
    return id;
  });
  await page.goto(base + '/canvas/' + id);
  await page.getByRole('button', {name:'工作流',exact:true}).waitFor();
  await page.evaluate(async (id) => {
    const { canvasIndexedStorage } = await import('/src/lib/localforage-storage.ts');
    const { useCanvasStore, flushCanvasSave } = await import('/src/stores/canvas/use-canvas-store.ts');
    window.restoreCanvasWrite = canvasIndexedStorage.setItem.bind(canvasIndexedStorage);
    canvasIndexedStorage.setItem = async () => { throw new DOMException('test quota', 'QuotaExceededError'); };
    useCanvasStore.getState().renameProject(id, '失败后保留的标题');
    await flushCanvasSave().catch(() => {});
  }, id);
  await page.getByText('保存失败，内容仍在当前页面', {exact:true}).waitFor();
  const download = page.waitForEvent('download');
  await page.getByRole('button', {name:'导出备份',exact:true}).click();
  const backup = await download;
  if (!backup.suggestedFilename().endsWith('.zip')) throw new Error('missing backup');
  await page.evaluate(async () => {
    const { canvasIndexedStorage } = await import('/src/lib/localforage-storage.ts');
    canvasIndexedStorage.setItem = window.restoreCanvasWrite;
  });
  await page.getByRole('button', {name:'重试保存',exact:true}).click();
  await page.getByText('已保存到本机', {exact:true}).waitFor();
  await page.reload();
  await page.getByRole('button', {name:'工作流',exact:true}).waitFor();
  const title = await page.evaluate(async (id) => {
    const { useCanvasStore } = await import('/src/stores/canvas/use-canvas-store.ts');
    return useCanvasStore.getState().openProject(id).title;
  }, id);
  if (title !== '失败后保留的标题') throw new Error('retry did not persist latest state');
  const read = await page.evaluate(async () => {
    const { canvasIndexedStorage } = await import('/src/lib/localforage-storage.ts');
    const { useCanvasStore } = await import('/src/stores/canvas/use-canvas-store.ts');
    const { useCanvasSaveStore } = await import('/src/stores/canvas/use-canvas-save-store.ts');
    const original = canvasIndexedStorage.getItem.bind(canvasIndexedStorage);
    canvasIndexedStorage.getItem = async () => { throw new Error('test read failure'); };
    await useCanvasStore.persist.rehydrate();
    const failed = useCanvasSaveStore.getState().readFailed;
    canvasIndexedStorage.getItem = original;
    return failed;
  });
  if (!read) throw new Error('read failure not reported');
  await page.getByText('画布读取失败，原数据未覆盖', {exact:true}).waitFor();
  await page.getByRole('button', {name:'重试读取',exact:true}).click();
  await page.getByText('已保存到本机', {exact:true}).waitFor();
  return {saveFailure:'visible',backup:'zip downloaded',retry:'latest state survives reload',readFailure:'visible and recoverable'};
}
