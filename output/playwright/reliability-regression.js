async (page) => {
  if (new URL(page.url()).origin !== 'http://127.0.0.1:4317') throw new Error('Use isolated 127.0.0.1:4317');
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
    const { writeOwnership } = await import('/src/lib/write-ownership.ts');
    await new Promise((resolve, reject) => {
      const deadline = Date.now() + 10000;
      const check = () => {
        if (useCanvasStore.getState().hydrated && writeOwnership.canWrite()) return resolve();
        if (Date.now() >= deadline) return reject(new Error('canvas did not become writable'));
        setTimeout(check, 100);
      };
      check();
    });
    await canvasIndexedStorage.ready();
    // Proxy reads return the write barrier, not the underlying driver method.
    // Restoring that wrapper onto the target would recurse into itself.
    window.restoreCanvasWrite = Object.getOwnPropertyDescriptor(canvasIndexedStorage, 'setItem');
    canvasIndexedStorage.setItem = async () => { throw new DOMException('test quota', 'QuotaExceededError'); };
    useCanvasStore.getState().renameProject(id, '失败后保留的标题');
    await flushCanvasSave().catch(() => {});
    const { useCanvasSaveStore } = await import('/src/stores/canvas/use-canvas-save-store.ts');
    if (useCanvasSaveStore.getState().status !== 'error') throw new Error('save failure was not recorded');
  }, id);
  const download = page.waitForEvent('download');
  await page.getByRole('button', {name:'导出抢救包',exact:true}).click();
  const backup = await download;
  if (!backup.suggestedFilename().endsWith('.zip')) throw new Error('missing backup');
  await page.evaluate(async () => {
    const { canvasIndexedStorage } = await import('/src/lib/localforage-storage.ts');
    Object.defineProperty(canvasIndexedStorage, 'setItem', window.restoreCanvasWrite);
    delete window.restoreCanvasWrite;
  });
  await page.getByRole('button', {name:'重试保存',exact:true}).click();
  await page.getByText('已保存到本机', {exact:true}).waitFor();
  const title = await page.evaluate(async (id) => {
    const { useCanvasStore } = await import('/src/stores/canvas/use-canvas-store.ts');
    await useCanvasStore.persist.rehydrate();
    return useCanvasStore.getState().openProject(id).title;
  }, id);
  if (title !== '失败后保留的标题') throw new Error('retry did not persist latest state');
  const read = await page.evaluate(async () => {
    const { canvasIndexedStorage } = await import('/src/lib/localforage-storage.ts');
    const { useCanvasStore } = await import('/src/stores/canvas/use-canvas-store.ts');
    const { useCanvasSaveStore } = await import('/src/stores/canvas/use-canvas-save-store.ts');
    await canvasIndexedStorage.ready();
    const original = Object.getOwnPropertyDescriptor(canvasIndexedStorage, 'getItem');
    canvasIndexedStorage.getItem = async () => { throw new Error('test read failure'); };
    try {
      await useCanvasStore.persist.rehydrate();
      return useCanvasSaveStore.getState().readFailed;
    } finally { Object.defineProperty(canvasIndexedStorage, 'getItem', original); }
  });
  if (!read) throw new Error('read failure not reported');
  await page.getByText('画布读取失败，原数据未覆盖', {exact:true}).waitFor();
  await page.getByRole('button', {name:'重试读取',exact:true}).click();
  await page.getByText('已保存到本机', {exact:true}).waitFor();
  return {saveFailure:'visible',backup:'zip downloaded',retry:'latest state survives reload',readFailure:'visible and recoverable'};
}
