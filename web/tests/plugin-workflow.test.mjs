import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './t11-loader.mjs';

const image = (id, requestId) => ({ id, type: 'image', title: id, position: { x: 0, y: 0 }, width: 200, height: 200, metadata: requestId ? { pluginActionRequestId: requestId, status: 'loading' } : { storageKey: 'image:original', content: 'blob:original', naturalWidth: 800, naturalHeight: 600, status: 'success' } });
function setup() {
    const f = fixture(), registry = f.load('@/lib/canvas/node-registry'), actions = f.load('@/lib/canvas/plugin-actions');
    const definition = { type: 'test:process', title: '处理', defaultSize: { width: 200, height: 200 }, workflowAction: { id: 'process', version: '1', title: '处理图片', description: '处理图片', validate: p => ({ width: Number(p.width) }), execute: async () => [] } };
    registry.registerNodeDefinitions([definition], 'test'); actions.markBundledAction(definition, 'bundled:test:1');
    const node = { id: 'process', type: definition.type, title: '处理', position: { x: 0, y: 0 }, width: 200, height: 200, metadata: { pluginActionParameters: { width: 400 } } };
    return { ...f, definition, node, registry, actions, workflow: f.load('@/lib/canvas/workflow'), config: { ...f.load('@/stores/use-config-store').defaultConfig, channels: [], apiKey: '' } };
}

test('processing steps freeze authorized parameters without API Key, require images and block changed plugins', () => {
    const f = setup(), source = image('source'), links = [{ id: 'in', fromNodeId: 'source', toNodeId: 'process', kind: 'input' }];
    const plan = f.workflow.planWorkflow([source, f.node], links, ['process'], f.config);
    assert.equal(plan.steps[0].action.parameters.width, 400);
    assert.equal(plan.steps[0].endpoint, '');
    const graph = f.workflow.prepareWorkflowStep(plan.steps[0], ['source'], f.config, [], [], { x: 0, y: 0 }, plan.resources);
    assert.equal(graph.config.type, 'test:process');
    assert.equal(graph.input.referenceImages[0].id, 'source');
    const portable = f.load('@/lib/canvas/workflow-archive').archivePlan(plan);
    assert.deepEqual(portable.steps[0].action, plan.steps[0].action);
    assert.equal(f.workflow.instantiateWorkflow(portable).nodes[1].type, 'test:process');
    f.definition.workflowAction.version = '2';
    assert.throws(() => f.workflow.prepareWorkflowStep(plan.steps[0], ['source'], f.config, [], [], { x: 0, y: 0 }, plan.resources), /重新预览/);
    assert.throws(() => f.workflow.planWorkflow([f.node], [], ['process'], f.config), /图片输入/);
    f.registry.unregisterPluginNodes('test');
    assert.throws(() => f.actions.resolvePluginAction(plan.steps[0].action), /未启用/);
});

test('crop and dimension adaptation use original pixel geometry and reject invalid parameters', () => {
    const f = fixture(), tools = f.load('@/lib/canvas/image-tool-parameters');
    assert.deepEqual(tools.imageToolGeometry('crop', { x: 100, y: 50, width: 400, height: 300 }, 800, 600).source, [100, 50, 400, 300]);
    assert.throws(() => tools.imageToolGeometry('crop', { x: 700, y: 0, width: 400, height: 300 }, 800, 600), /超出/);
    assert.deepEqual(tools.imageToolGeometry('resize', { width: 100, height: 100, fit: 'contain' }, 200, 100).destination, [0, 25, 100, 50]);
    assert.deepEqual(tools.imageToolGeometry('resize', { width: 100, height: 100, fit: 'cover' }, 200, 100).destination, [-50, 0, 200, 100]);
    assert.throws(() => tools.imageToolParameters('crop', { x: 0, y: 0, width: -1, height: 50 }), /正整数/);
    assert.throws(() => tools.imageToolParameters('convert', { format: 'gif', quality: 1, background: '#ffffff' }), /格式/);
    assert.throws(() => tools.imageToolParameters('upscale', { apiKey: 'secret' }), /未知字段/);
});

function executor({ failSave = false } = {}) {
    const f = setup(), disk = new Map(), original = image('original'), target = image('output', 'request');
    let project = { id: 'project', nodes: [original, target], connections: [] }, executions = 0, uploads = 0;
    const tasks = [];
    f.definition.workflowAction.execute = async () => { executions++; return [new Blob(['result'], { type: 'image/png' })]; };
    f.mocks['localforage'] = { createInstance: () => ({ getItem: async key => disk.get(key), setItem: async (key, value) => { disk.set(key, structuredClone(value)); return value; } }) };
    f.mocks['@/stores/use-agent-store'] = { useAgentStore: { getState: () => ({ canvasContext: null }) } };
    f.mocks['@/stores/canvas/use-canvas-store'] = { useCanvasStore: { getState: () => ({ openProject: () => project, updateProject: (_, patch) => { if (failSave) throw new Error('quota'); project = { ...project, ...patch }; } }) }, flushCanvasSave: async () => {} };
    f.mocks['@/features/tasks/task-store'] = { beginCreationTask: input => { tasks.push(input); return input.id; }, updateCreationTask: (_, patch) => tasks.push(patch), flushTaskSave: async () => {} };
    f.mocks['@/services/image-storage'] = { getImageBlob: async () => new Blob(['original'], { type: 'image/png' }), uploadImage: async blob => { uploads++; return { storageKey: 'image:result', url: 'blob:result', width: 400, height: 300, mimeType: blob.type, bytes: blob.size }; } };
    const api = f.load('@/lib/canvas/plugin-action-executor'), action = f.actions.planPluginAction('test:process', { width: 400 });
    return { ...f, api, action, target: { requestId: 'request', projectId: 'project', nodeIds: ['output'] }, original, disk, tasks, counts: () => ({ executions, uploads }), getProject: () => project, allowSave: () => { failSave = false; } };
}

test('saved processing artifacts feed workflow results without replacing original images', async () => {
    const f = executor();
    await f.api.executePluginWorkflow(f.action, f.target, [f.original]);
    assert.equal(f.getProject().nodes[0].metadata.storageKey, 'image:original');
    assert.equal(f.getProject().nodes[1].metadata.storageKey, 'image:result');
    assert.equal(f.disk.get('request').status, 'done');
    assert.equal(f.disk.get('request').files, undefined);
    assert.equal(f.tasks[0].source, 'plugin');
    assert.deepEqual(f.counts(), { executions: 1, uploads: 1 });
    const step = { mode: 'image', action: f.action };
    assert.deepEqual(f.workflow.workflowResults(step, { configId: 'config', requestId: 'request' }, f.getProject().nodes, [{ kind: 'generation', fromNodeId: 'config', toNodeId: 'output' }]), ['output']);
    await assert.rejects(f.api.executePluginWorkflow(f.action, f.target, [f.original]), /已有原处理任务/);
});

test('save failure persists exact output; recovery neither executes processing nor uploads twice', async () => {
    const f = executor({ failSave: true });
    await assert.rejects(f.api.executePluginWorkflow(f.action, f.target, [f.original]), /处理文件已保留/);
    const receipt = f.disk.get('request');
    assert.equal(await receipt.files[0].blob.text(), 'result');
    assert.equal(receipt.saved[0].storageKey, 'image:result');
    f.allowSave();
    await f.api.recoverPluginAction('request');
    assert.deepEqual(f.counts(), { executions: 1, uploads: 1 });
    assert.equal(f.getProject().nodes[1].metadata.storageKey, 'image:result');
});


test('worker keeps source transparency when model preprocessing mutates RGB and disposes the model', async () => {
    for (const action of ['upscale', 'removeBackground']) {
        const f = fixture(), events = []; let disposed = 0;
        class RawImage {
            constructor(alpha) { this.channels = 4; this.width = 1; this.height = 1; this.data = new Uint8Array([100, 100, 100, alpha]); }
            static async fromBlob() { return new RawImage(128); }
            clone() { return new RawImage(this.data[3]); }
            async resize() { return this; }
            rgba() { return this; }
            async toBlob() { return new Blob([this.data], { type: 'image/png' }); }
        }
        const processor = async image => { image.data[3] = 255; return new RawImage(128); };
        processor.dispose = async () => { disposed++; };
        f.mocks['@huggingface/transformers'] = { env: {}, RawImage, pipeline: async () => processor };
        globalThis.self = { postMessage: event => events.push(event) };
        try {
            f.load('@/services/api/image-processing.worker.ts');
            await self.onmessage({ data: { action, image: new Blob(['original']) } });
            const result = events.find(event => event.result)?.result;
            assert.ok(result);
            assert.equal(new Uint8Array(await result.arrayBuffer())[3], action === 'upscale' ? 128 : 64);
            assert.equal(disposed, 1);
        } finally { delete globalThis.self; }
    }
});

test('output persistence rejection never claims success and does not automatically repeat processing', async () => {
    const f = executor();
    const store = f.mocks.localforage.createInstance();
    f.mocks.localforage.createInstance = () => ({ ...store, setItem: async (key, value) => { if (value.files) throw new Error('quota'); return store.setItem(key, value); } });
    // A fresh executor module captures the failing persistence adapter.
    const g = setup();
    for (const [key, value] of Object.entries(f.mocks)) g.mocks[key] = value;
    const api = g.load('@/lib/canvas/plugin-action-executor');
    g.definition.workflowAction.execute = f.definition.workflowAction.execute;
    await assert.rejects(api.executePluginWorkflow(g.actions.planPluginAction('test:process', { width: 400 }), f.target, [f.original]), /输出保存失败/);
    assert.equal(f.disk.get('request').status, 'processing');
    assert.ok(f.tasks.some(task => task.phase === 'done' && task.saveState === 'error'));
    assert.equal(f.tasks.some(task => task.saveState === 'saved'), false);
    await assert.rejects(api.recoverPluginAction('request'), /不会自动重新执行/);
    assert.equal(f.counts().executions, 1);
});


test('native image to processing to native editing preserves frozen dependencies and saved references', () => {
    const f = setup();
    const native = id => ({ id, type: 'config', title: id, position: { x: 0, y: 0 }, width: 200, height: 200, metadata: { generationMode: 'image', generationSource: 'codex', codexModel: 'chosen-model', prompt: 'Create an image' } });
    const plan = f.workflow.planWorkflow([native('create'), f.node, native('edit')], [{ id: 'a', fromNodeId: 'create', toNodeId: 'process', kind: 'input' }, { id: 'b', fromNodeId: 'process', toNodeId: 'edit', kind: 'input' }], ['create', 'process', 'edit'], f.config);
    assert.deepEqual(plan.steps.map(step => step.id), ['create', 'process', 'edit']);
    assert.equal(plan.steps[1].inputs[0].stepId, 'create');
    assert.equal(plan.steps[2].inputs[0].stepId, 'process');
    const saved = image('saved-native');
    const graph = f.workflow.prepareWorkflowStep(plan.steps[1], [saved.id], f.config, [], [], { x: 0, y: 0 }, [saved]);
    assert.equal(graph.input.referenceImages[0].storageKey, 'image:original');
    saved.metadata.storageKey = undefined;
    assert.throws(() => f.workflow.prepareWorkflowStep(plan.steps[1], [saved.id], f.config, [], [], { x: 0, y: 0 }, [saved]), /完整保存/);
});
