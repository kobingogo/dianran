async (page) => {
  page.on('dialog', dialog => { if (dialog.type() === 'beforeunload') void dialog.accept().catch(() => {}); });
  const base = 'http://127.0.0.1:4317';
  const calls = [];
  let texts = 0;
  // A real, short PCM WAV exercises local audio storage and metadata reading.
  const wav = Buffer.alloc(3244);
  wav.write('RIFF', 0); wav.writeUInt32LE(3236, 4); wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(16000, 24); wav.writeUInt32LE(32000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
  wav.write('data', 36); wav.writeUInt32LE(3200, 40);
  await page.route('https://workflow-nodes.example/**', async route => {
    const request = route.request();
    const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' };
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    const body = request.postDataJSON();
    calls.push({ url: request.url(), body });
    if (request.url().endsWith('/responses')) {
      texts++;
      if (texts === 2) return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: { message: '模拟文本部分失败' } }), headers });
      if (texts === 3) return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: { message: '模拟重试失败' } }), headers });
      return route.fulfill({ contentType: 'text/event-stream', body: 'data: ' + JSON.stringify({ type: 'response.output_text.delta', delta: texts === 1 ? '原始旁白' : '重试旁白' }) + '\n\ndata: [DONE]\n\n', headers });
    }
    if (request.url().endsWith('/audio/speech')) return route.fulfill({ contentType: 'audio/wav', body: wav, headers });
    throw new Error('Unexpected paid route ' + request.url());
  });
  await page.goto(base + '/canvas');
  const id = await page.evaluate(async () => {
    const { useConfigStore, defaultConfig } = await import('/src/stores/use-config-store.ts');
    const config = { ...defaultConfig, count: '1', systemPrompt: '只输出正文', reasoningEffort: 'low', audioVoice: 'nova', audioSpeed: '1.25', audioFormat: 'wav', channels: [{ id: 'nodes', name: 'mock', baseUrl: 'https://workflow-nodes.example/v1', apiKey: 'mock-key', apiFormat: 'openai', models: [{ name: 'gpt-4o', capability: 'text' }, { name: 'tts-1', capability: 'audio' }, { name: 'sora-2', capability: 'video' }] }], textModel: 'nodes::gpt-4o', audioModel: 'nodes::tts-1', videoModel: 'nodes::sora-2' };
    useConfigStore.setState({ config });
    const { useCanvasStore, flushCanvasSave } = await import('/src/stores/canvas/use-canvas-store.ts');
    if (!useCanvasStore.getState().hydrated) await useCanvasStore.persist.rehydrate();
    const id = useCanvasStore.getState().createProject('文本到音频回归');
    const source = { threadId: 'test-thread', turnId: 'test-turn', itemId: 'test-item' };
    const nodes = [
      { id: 'text', type: 'config', title: '旁白', position: { x: 80, y: 80 }, width: 250, height: 220, metadata: { generationMode: 'text', model: config.textModel, prompt: '写旁白', composerContent: '写旁白', textCount: 2, agentSource: source } },
      { id: 'audio', type: 'config', title: '配音', position: { x: 440, y: 80 }, width: 250, height: 220, metadata: { generationMode: 'audio', model: config.audioModel, prompt: '朗读 @[node:text]', composerContent: '朗读 @[node:text]', agentSource: source } }
    ];
    useCanvasStore.getState().updateProject(id, { nodes, connections: [{ id: 'dependency', fromNodeId: 'text', toNodeId: 'audio', kind: 'input' }] });
    await flushCanvasSave(); return id;
  });
  await page.goto(base + '/canvas/' + id);
  await page.locator('[data-node-id="text"]').waitFor();
  await page.evaluate(() => { document.activeElement?.blur(); window.getSelection()?.removeAllRanges(); });
  await page.keyboard.press('Control+a');
  await page.getByRole('button', { name: '工作流', exact: true }).click();
  await page.getByRole('button', { name: '预览选定节点', exact: true }).click();
  await page.getByText('2 步 · 共 3 次生成请求 · 费用由配置的渠道计费', { exact: true }).waitFor();
  if (calls.length) throw new Error('Preview generated requests');
  await page.getByRole('button', { name: '确认执行此计划', exact: true }).click();
  await page.evaluate(async () => { window.nodeTestStore = (await import('/src/stores/canvas/use-canvas-store.ts')).useCanvasStore; });
  await page.waitForFunction(id => window.nodeTestStore.getState().openProject(id).workflowRuns?.[0]?.steps[0].status === 'failed', id);
  const resultId = await page.evaluate(async id => {
    const project = window.nodeTestStore.getState().openProject(id), run = project.workflowRuns[0];
    if (run.steps[1].status !== 'pending') throw new Error('Partial text reached downstream');
    const output = project.nodes.find(node => node.metadata?.sourceConfigId === run.steps[0].configId);
    if (!output || output.metadata.texts.length !== 2 || output.metadata.texts.filter(text => text.status === 'success').length !== 1) throw new Error('Partial text slots not preserved');
    const { useConfigStore } = await import('/src/stores/use-config-store.ts');
    useConfigStore.setState({ config: { ...useConfigStore.getState().config, systemPrompt: '修改后的系统提示', reasoningEffort: 'high', audioVoice: 'alloy', audioSpeed: '4' } });
    return output.id;
  }, id);
  if (calls.length !== 2) throw new Error('Unexpected requests after partial failure');
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.locator('[data-node-id="' + resultId + '"]').getByRole('button', { name: '重试未成功文本', exact: true }).click();
  await page.waitForFunction(({ id, resultId }) => window.nodeTestStore.getState().openProject(id).nodes.find(node => node.id === resultId)?.metadata?.errorDetails === '模拟重试失败', { id, resultId });
  if (calls.length !== 3) throw new Error('Failed retry must not submit another request automatically');
  await page.locator('[data-node-id="' + resultId + '"]').getByRole('button', { name: '重试未成功文本', exact: true }).click();
  await page.waitForFunction(({ id, resultId }) => window.nodeTestStore.getState().openProject(id).nodes.find(node => node.id === resultId)?.metadata?.status === 'success', { id, resultId });
  if (calls.length !== 4) throw new Error('Each manual retry must submit only one missing text');
  const textBodies = calls.map(call => call.body);
  if (textBodies.some(body => JSON.stringify(body).includes('修改后的系统提示') || body.reasoning?.effort !== 'low')) throw new Error('Retry lost approved text parameters');
  await page.getByRole('button', { name: '工作流', exact: true }).click();
  await page.getByRole('button', { name: '核对已有结果并继续', exact: true }).click();
  await page.waitForFunction(id => window.nodeTestStore.getState().openProject(id).workflowRuns[0].steps.every(step => step.status === 'succeeded'), id);
  const audioBody = calls.find(call => call.url.endsWith('/audio/speech'))?.body;
  if (calls.length !== 5 || audioBody.voice !== 'nova' || audioBody.speed !== 1.25 || !audioBody.input.includes('原始旁白') || audioBody.input.includes('重试旁白')) throw new Error('Audio lost approved parameters or primary text ' + JSON.stringify(calls));
  await page.evaluate(async id => {
    const project = window.nodeTestStore.getState().openProject(id), run = project.workflowRuns[0];
    const sound = project.nodes.find(node => node.id === run.steps[1].resultIds[0]);
    if (sound.metadata.agentSource.itemId !== 'test-item' || !sound.metadata.inputSnapshot.prompt.includes('原始旁白')) throw new Error('Audio provenance lost');
    const { planWorkflow } = await import('/src/lib/canvas/workflow.ts');
    const { useConfigStore } = await import('/src/stores/use-config-store.ts');
    const next = { id: 'video-template', type: 'config', title: '音频参考视频', position: { x: 0, y: 0 }, width: 250, height: 220, metadata: { generationMode: 'video', prompt: '用声音生成画面', model: useConfigStore.getState().config.videoModel } };
    const plan = planWorkflow([sound, next], [{ id: 'in', fromNodeId: sound.id, toNodeId: next.id, kind: 'input' }], [next.id], useConfigStore.getState().config, '音频素材模板');
    const { useWorkflowStore } = await import('/src/stores/canvas/use-workflow-store.ts');
    await useWorkflowStore.getState().save(plan, plan.title);
    const create = URL.createObjectURL.bind(URL); URL.createObjectURL = blob => { if (blob.type === 'application/zip') window.audioTemplateZip = blob; return create(blob); };
  }, id);
  await page.getByText('本机模板（1）', { exact: true }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出 ZIP', exact: true }).click(); await download;
  const zip = await page.evaluate(async () => Array.from(new Uint8Array(await window.audioTemplateZip.arrayBuffer())));
  await page.locator('input[type=file][accept=".zip"]').setInputFiles({ name: 'audio.zip', mimeType: 'application/zip', buffer: Buffer.from(zip) });
  await page.getByText('模板及原始素材已导入，请展开并重新预览参数', { exact: true }).waitFor();
  const summary = await page.evaluate(async id => {
    const { useWorkflowStore } = await import('/src/stores/canvas/use-workflow-store.ts');
    const { getMediaBlob } = await import('/src/services/file-storage.ts');
    const templates = useWorkflowStore.getState().templates;
    const key = templates[1].plan.resources[0].metadata.storageKey;
    if (!key.startsWith('audio:') || key === templates[0].plan.resources[0].metadata.storageKey || (await getMediaBlob(key))?.size !== 3244) throw new Error('Audio archive lost original file or identity');
    if (JSON.stringify(templates).includes('test-item') || JSON.stringify(templates).includes('mock-key')) throw new Error('Template kept historical identity or credentials');
    const { flushCanvasSave } = await import('/src/stores/canvas/use-canvas-store.ts'); await flushCanvasSave();
    return { statuses: window.nodeTestStore.getState().openProject(id).workflowRuns[0].steps.map(step => step.status), templates: templates.length, audioBytes: (await getMediaBlob(key)).size };
  }, id);
  const beforeReload = calls.length;
  await page.reload(); await page.getByRole('button', { name: '工作流', exact: true }).click();
  await page.getByText('画布工作流 · 成功 → 成功', { exact: true }).waitFor();
  if (calls.length !== beforeReload) throw new Error('Reload resubmitted a paid request');
  await page.screenshot({ path: 'output/playwright/evidence/workflow-nodes.png' });
  return { requests: calls.map(call => call.url), ...summary, recovery: 'one call per manual retry, including a failed retry; frozen parameters; no reload calls' };
}
