import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { webcrypto } from 'node:crypto';
const require = createRequire(import.meta.url), ts = require('typescript');
globalThis.crypto ||= webcrypto;
globalThis.window = { innerWidth: 1000, innerHeight: 800 };

function fixture() {
    const calls = [], states = [], refs = []; let stateIndex = 0, refIndex = 0, revision = 0;
    const draft = { prompt: '画布草稿 @[node:reference]', references: [], nodeIds: ['reference'], parameters: {} };
    const imageDraft = { prompt: '其他页面草稿', references: [] };
    const nodes = [], media = { source: 'agent', codexModel: 'codex-model', receipts: {} };
    const context = { getSnapshot: () => ({ projectId: 'canvas-A', revision: String(revision), nodes, viewport: { x: 0, y: 0, k: 2 } }), importMediaNodes: async values => { nodes.push(...values); revision++; agent.canvasContext = { ...context }; } };
    const agent = { url: 'local', token: 'token', connected: true, models: [{ model: 'codex-model' }], conversation: { status: 'idle' }, canvasContext: context, setAgentState: value => Object.assign(agent, value) };
    const agentStore = Object.assign(() => agent, { getState: () => agent });
    const mediaStore = Object.assign(() => media, { getState: () => media, setState: value => Object.assign(media, value) });
    const reference = { id: 'reference', name: '画布参考', dataUrl: 'data:image/png;base64,AAA=' };
    const mocks = {
        react: { useEffect: () => {}, useState: initial => { const i = stateIndex++; if (!(i in states)) states[i] = initial; return [states[i], value => states[i] = value]; }, useRef: initial => { const i = refIndex++; return refs[i] ||= { current: initial }; } },
        antd: { App: { useApp: () => ({ modal: {} }) } },
        '@/stores/use-agent-store': { useAgentStore: agentStore },
        '@/stores/use-composer-store': { useComposerStore: { getState: () => ({ image: imageDraft, scoped: { scope: draft } }) }, consumeComposerDraft: (mode, submitted, scope) => calls.push(['consume', mode, submitted, scope]) },
        '@/stores/use-agent-media-store': { useAgentMediaStore: mediaStore, recordAgentMediaIntent: async (request, target) => calls.push(['intent', structuredClone(request), target]), recordAgentMediaTask: async task => calls.push(['receipt', task]) },
        '@/stores/canvas/use-canvas-store': { useCanvasStore: { getState: () => ({ createProject: () => { throw Error('must not create another canvas'); } }) }, flushCanvasSave: async () => {} },
        '@/services/api/local-agent-media': { fetchAgentMediaCapabilities: async () => ({ data: [{ agentId: 'codex', capabilities: { 'image-edit': 'verified' } }] }), fetchAgentMediaModels: async () => ({ data: agent.models }), submitAgentMedia: async (_url, _token, _client, request) => { calls.push(['submit', request]); return { data: { id: 'remote', request } }; } },
        '@/services/api/canvas-agent': { postState: async (_url, _token, _client, snapshot) => { assert.equal(snapshot.revision, String(revision)); calls.push(['state', snapshot]); return true; } },
        '@/services/image-storage': { getImageBlob: async () => undefined },
        '@/lib/write-ownership': { assertBusinessWriter: () => {}, businessOperation: fn => fn },
        '@/lib/agent/agent-client-id': { acquireAgentClientId: async () => 'client' },
        '@/lib/canvas/agent-revision': { createAgentRevision: () => value => value },
        '@/lib/canvas/canvas-node-factory': { createCanvasNode: (type, position, metadata) => ({ id: 'temporary', type, position, metadata }) },
        '@/types/canvas': { CanvasNodeType: { Image: 'image' } },
        '@/stores/use-config-store': { useConfigStore: { getState: () => ({ config: {} }) } },
        '@/lib/composer': { uniqueReferences: values => values, creationSnapshot: () => ({}) },
        '@/lib/canvas/canvas-composer': { vacantCanvasPosition: () => ({ x: 250, y: 200 }) },
        '@/features/tasks/task-store': { beginCreationTask: value => { calls.push(['task', value]); return value.id; }, updateCreationTask: (id, patch) => calls.push(['update', id, patch]) },
    };
    const code = ts.transpileModule(readFileSync(new URL('../src/hooks/use-local-image-generation.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    const module = { exports: {} };
    new Function('require', 'module', 'exports', code)(id => { assert.ok(id in mocks, id); return mocks[id]; }, module, module.exports);
    const render = () => { stateIndex = refIndex = 0; return module.exports.useLocalImageGeneration(true, { scope: 'scope', projectId: 'canvas-A', prepareNative: () => ({ prompt: '展开后的画布提示词', references: [reference] }) }); };
    return { render, calls, nodes, draft };
}

test('canvas submits its scoped prompt and references, saves an in-place target and consumes only that draft', async () => {
    const f = fixture(); await f.render().refresh(); await f.render().generate();
    const submit = f.calls.find(call => call[0] === 'submit'); assert.ok(submit);
    assert.equal(submit[1].projectId, 'canvas-A'); assert.equal(submit[1].prompt, '展开后的画布提示词');
    assert.equal(submit[1].references[0].id, 'reference'); assert.equal(submit[1].capability, 'image-edit');
    assert.deepEqual(f.nodes[0].position, { x: 250, y: 200 });
    assert.equal(f.calls.find(call => call[0] === 'task')[1].sourcePath, '/canvas/canvas-A');
    const intent = f.calls.filter(call => call[0] === 'intent').at(-1);
    assert.equal(intent[2].nodeId, f.nodes[0].id); assert.equal(intent[1].revision, '1');
    assert.deepEqual(f.calls.find(call => call[0] === 'consume'), ['consume', 'image', f.draft, 'scope']);
    assert.equal(f.calls.filter(call => call[0] === 'submit').length, 1);
});
