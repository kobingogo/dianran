import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fixture } from './t11-loader.mjs';
const { createStore } = createRequire(import.meta.url)('zustand/vanilla');

const node = (id, type, metadata) => ({ id, type, title: id, metadata, position: { x: 0, y: 0 }, width: 200, height: 200 });
const nativeNode = () => node('native', 'config', { generationMode: 'image', generationSource: 'codex', codexModel: 'native-model', prompt: '画一棵树', composerContent: '画一棵树', count: 3 });
const edge = (fromNodeId, toNodeId, kind = 'input') => ({ id: `${fromNodeId}:${toNodeId}`, fromNodeId, toNodeId, kind });

test('native workflow needs no API Key, freezes one native task and survives portable templates without consent', () => {
    const f = fixture(), workflow = f.load('@/lib/canvas/workflow'), config = { ...f.load('@/stores/use-config-store').defaultConfig, apiKey: '', channels: [] };
    const plan = workflow.planWorkflow([nativeNode()], [], ['native'], config);
    assert.equal(plan.steps[0].source, 'codex');
    assert.equal(plan.steps[0].calls, 1);
    assert.equal(plan.steps[0].parameters.imageModel, 'native-model');
    assert.equal(plan.steps[0].endpoint, '');
    const graph = workflow.prepareWorkflowStep(plan.steps[0], [], config, [], [], { x: 0, y: 0 });
    assert.equal(graph.config.metadata.generationSource, 'codex');
    assert.match(graph.input.prompt, /画一棵树/);
    plan.steps[0].allowUnverified = true;
    const portable = f.load('@/lib/canvas/workflow-archive').archivePlan(plan);
    assert.equal(portable.steps[0].source, 'codex');
    assert.equal(portable.steps[0].allowUnverified, undefined);
    assert.equal(f.load('@/stores/canvas/use-workflow-store').workflowTemplate(plan, 'test').plan.steps[0].allowUnverified, undefined);
    const expanded = workflow.instantiateWorkflow(portable);
    assert.equal(expanded.nodes[0].metadata.codexModel, 'native-model');
    assert.equal(workflow.planWorkflow(expanded.nodes, expanded.connections, expanded.configIds, config).steps[0].source, 'codex');
});

test('native results require saved originals and feed downstream API video; interruption never resubmits', async () => {
    const f = fixture(), workflow = f.load('@/lib/canvas/workflow'), config = { ...f.load('@/stores/use-config-store').defaultConfig, channels: [{ id: 'api', name: 'API', apiKey: 'secret', baseUrl: 'https://example.invalid/v1', apiFormat: 'openai', models: [{ name: 'video', capability: 'video' }] }], videoModel: 'api::video' };
    const video = node('video', 'config', { generationMode: 'video', prompt: '让 @[node:native] 随风摇动' });
    const plan = workflow.planWorkflow([nativeNode(), video], [edge('native', 'video')], ['native', 'video'], config);
    const run = workflow.createWorkflowRun(plan), saved = node('saved', 'image', { status: 'success', content: 'blob:original' });
    run.steps[0].configId = 'runtime';
    assert.throws(() => workflow.workflowResults(plan.steps[0], run.steps[0], [saved], [edge('runtime', 'saved', 'generation')]), /未完整成功/);
    saved.metadata.storageKey = 'image:original';
    assert.deepEqual(workflow.workflowResults(plan.steps[0], run.steps[0], [saved], [edge('runtime', 'saved', 'generation')]), ['saved']);
    const calls = [];
    await workflow.executeWorkflow(run, async (step, inputs, state) => { calls.push(step.id); if (step.id === 'native') { state.resultNodes = [saved]; return ['saved']; } assert.deepEqual(inputs, ['saved']); assert.match(step.prompt, /@\[node:saved\]/); return ['video-result']; }, async () => {}, () => false);
    assert.deepEqual(calls, ['native', 'video']);
    const interrupted = workflow.createWorkflowRun(plan);
    let submits = 0;
    const execute = async () => { submits++; throw Object.assign(new Error('断线'), { interrupted: true }); };
    await assert.rejects(workflow.executeWorkflow(interrupted, execute, async () => {}, () => false), /断线/);
    assert.equal(interrupted.steps[0].status, 'interrupted');
    await assert.rejects(workflow.executeWorkflow(interrupted, execute, async () => {}, () => false), /不会重复提交/);
    assert.equal(submits, 1);
});

function runtime({ availability = 'verified', submitError = false } = {}) {
    const f = fixture(), events = [], snapshot = { projectId: 'project', revision: 'revision' };
    const agent = createStore(() => ({ connected: true, url: 'http://local', token: 'token', sending: false, waiting: false, conversation: { status: 'idle' }, canvasContext: { getSnapshot: () => snapshot } }));
    const media = createStore(() => ({ intents: {}, receipts: {} }));
    f.mocks['@/stores/use-agent-store'] = { useAgentStore: agent };
    f.mocks['@/stores/canvas/use-canvas-store'] = { flushCanvasSave: async () => { events.push('canvas-save'); } };
    f.mocks['@/stores/use-agent-media-store'] = { useAgentMediaStore: media, recordAgentMediaIntent: async request => { events.push('intent'); media.setState({ intents: { [request.requestId]: request } }); }, recordAgentMediaTask: async task => { media.setState({ receipts: { [task.id]: { task, imported: {} } } }); } };
    f.mocks['@/features/tasks/task-store'] = { beginCreationTask: () => { events.push('task'); return 'task'; }, flushTaskSave: async () => { events.push('task-save'); }, updateCreationTask: (_, patch) => { events.push(patch.phase); } };
    f.mocks['@/lib/agent/agent-client-id'] = { acquireAgentClientId: async () => 'client' };
    f.mocks['@/services/api/canvas-agent'] = { postState: async () => { events.push('sync'); return true; } };
    f.mocks['@/services/api/local-agent-media'] = { fetchAgentMediaModels: async () => ({ data: [{ model: 'native-model' }] }), fetchAgentMediaCapabilities: async () => ({ data: [{ agentId: 'codex', capabilities: { 'text-to-image': availability, 'image-edit': availability } }] }), submitAgentMedia: async (_, __, ___, request) => { events.push('submit'); if (submitError) throw new Error('response lost'); return { data: { id: 'remote', request, status: 'running', artifacts: [] } }; } };
    f.mocks['@/lib/agent/import-agent-media'] = { importAgentMedia: async () => { events.push('import'); } };
    const step = { source: 'codex', mode: 'image', parameters: { imageModel: 'native-model' } };
    const input = { prompt: '画一棵树', referenceImages: [] };
    const target = { projectId: 'project', nodeId: 'output', requestId: 'request' };
    return { ...f, agent, media, events, step, input, target, execute: f.load('@/lib/canvas/workflow-codex').executeCodexWorkflow };
}

const settle = () => new Promise(resolve => setImmediate(resolve));

test('native executor persists intent before a single submission and awaits original artifact saving', async () => {
    const f = runtime(); let done = false;
    const operation = f.execute(f.step, f.input, f.target).then(() => { done = true; });
    await settle();
    assert.equal(done, false);
    assert.ok(f.events.indexOf('intent') < f.events.indexOf('submit'));
    assert.ok(f.events.indexOf('task-save') < f.events.indexOf('submit'));
    // Canvas bridge refreshes its context object on every render, preserving the same project.
    f.agent.setState({ canvasContext: { getSnapshot: () => ({ projectId: 'project', revision: 'next' }) } });
    const receipt = f.media.getState().receipts.remote;
    f.media.setState({ receipts: { remote: { ...receipt, task: { ...receipt.task, status: 'completed', artifacts: [{ id: 'artifact' }] } } } });
    await operation;
    assert.equal(f.events.filter(item => item === 'submit').length, 1);
    assert.ok(f.events.includes('import'));
});

test('disconnect, ambiguous submit and a persisted request stop without API fallback or another native submit', async () => {
    const f = runtime(), operation = f.execute(f.step, f.input, f.target);
    await settle();
    f.agent.setState({ connected: false });
    await assert.rejects(operation, error => error.interrupted === true);
    f.agent.setState({ connected: true });
    await assert.rejects(f.execute(f.step, f.input, f.target), /已有原请求/);
    assert.equal(f.events.filter(item => item === 'submit').length, 1);
    const lost = runtime({ submitError: true });
    await assert.rejects(lost.execute(lost.step, lost.input, lost.target), error => error.interrupted === true);
    assert.ok(lost.events.includes('unknown'));
    assert.equal(lost.events.filter(item => item === 'submit').length, 1);
});

test('unverified capability and missing originals stop before paid submission', async () => {
    const f = runtime({ availability: 'unverified' });
    await assert.rejects(f.execute(f.step, f.input, f.target), /尚未验证/);
    assert.equal(f.events.includes('submit'), false);
    f.step.allowUnverified = true;
    f.input.referenceImages = [{ id: 'image', name: 'image', dataUrl: 'blob:missing' }];
    await assert.rejects(f.execute(f.step, f.input, f.target), /原文件不可用/);
    assert.equal(f.events.includes('submit'), false);
});

test('a previous native turn finishing does not cause a busy rejection or early second submit', async () => {
    const f = runtime();
    f.agent.setState({ conversation: { status: 'running' } });
    const operation = f.execute(f.step, f.input, f.target);
    await settle();
    assert.equal(f.events.includes('submit'), false);
    f.agent.setState({ conversation: { status: 'idle' } });
    await settle();
    const receipt = f.media.getState().receipts.remote;
    f.media.setState({ receipts: { remote: { ...receipt, task: { ...receipt.task, status: 'completed', artifacts: [{ id: 'artifact' }] } } } });
    await operation;
    assert.equal(f.events.filter(item => item === 'submit').length, 1);
});

test('Agent proposals support explicit native image models and retain source message ownership', () => {
    const f = fixture(), config = { ...f.load('@/stores/use-config-store').defaultConfig, apiKey: '', channels: [] };
    const parser = f.load('@/lib/canvas/agent-workflow-plan').agentWorkflowPlan;
    const data = { title: '本机生图', steps: [{ id: 'image', mode: 'image', source: 'codex', model: 'native-model', prompt: '画一棵树' }] };
    const encode = value => '```dianran-plan\n' + JSON.stringify(value) + '\n```';
    const source = { threadId: 'thread', turnId: 'turn', itemId: 'item' };
    assert.equal(parser(encode(data), [], config, source).steps[0].source, 'codex');
    assert.deepEqual(parser(encode(data), [], config, source).steps[0].agentSource, source);
    delete data.steps[0].model;
    assert.throws(() => parser(encode(data), [], config, source), /必须明确模型/);
});
