import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url), ts = require('typescript');
function fixture() {
    const jsx = (type, props) => ({ type, props }), navigation = [];
    const receipts = Object.fromEntries(['old', 'new'].map((id, index) => [id, { task: { id, createdAt: index + 1, request: { requestId: id, projectId: 'canvas', prompt: id, codexModel: 'model' }, status: 'completed', artifacts: [{ id: `${id}-image` }] }, imported: { [`${id}-image`]: { storageKey: `${id}-file`, nodeId: `${id}-node` } } }]));
    const state = { receipts, intents: {}, error: '' };
    const media = () => state; media.getState = () => state;
    const mocks = {
        react: { useEffect: () => {}, useState: (value) => [value, () => {}] }, 'react/jsx-runtime': { jsx, jsxs: jsx },
        'react-router-dom': { useNavigate: () => (url) => navigation.push(url) }, antd: {}, 'file-saver': {},
        '@/stores/canvas/use-canvas-store': { useCanvasStore: (select) => select({ projects: [] }) },
        '@/stores/use-agent-store': { useAgentStore: () => ({ connected: false, conversation: { status: 'idle' } }) },
        '@/stores/use-agent-media-store': { useAgentMediaStore: media, selectImageSource: (source) => { state.source = source; } },
        '@/services/api/local-agent-media': {}, '@/lib/write-ownership': {}, '@/lib/agent/import-agent-media': {}, '@/services/image-storage': {},
        '@/components/ui/ink-button': { InkButton: 'InkButton' }, '@/features/tasks/generation-status': {},
        '@/features/tasks/task-store': { useTaskStore: (select) => select({ tasks: [] }) },
        '@/hooks/use-reuse-creation': {}, '@/hooks/use-asset-mutation': {}, '@/stores/use-asset-store': {},
    };
    const code = ts.transpileModule(readFileSync(new URL('../src/components/agent/agent-media-panel.tsx', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
    const module = { exports: {} };
    new Function('require', 'module', 'exports', code)((id) => { assert.ok(id in mocks, `dependency ${id}`); return mocks[id]; }, module, module.exports);
    return { api: module.exports, state, navigation };
}
function all(tree) { return tree && typeof tree === 'object' ? [tree, ...[tree.props?.children].flat(Infinity).flatMap(all)] : []; }
const cards = (tree) => all(tree).filter((node) => node.props?.receipt);
test('workbench current and history use saved native receipts offline, with exact task return identity', () => {
    const f = fixture();
    assert.deepEqual(cards(f.api.AgentMediaPanel({ embedded: true })).map((node) => node.props.receipt.task.id), ['new']);
    assert.deepEqual(cards(f.api.AgentMediaPanel({ embedded: true, history: true })).map((node) => node.props.receipt.task.id), ['new', 'old']);
    const selected = cards(f.api.AgentMediaPanel({ embedded: true, focusTaskId: 'agent:old' }));
    assert.equal(selected[0].props.receipt.imported['old-image'].storageKey, 'old-file');
    assert.equal(selected.length, 1);
});
test('assistant routes to the workbench without a duplicate submit or results list', () => {
    const f = fixture(), tree = f.api.AgentMediaPanel({});
    assert.equal(cards(tree).length, 0);
    const action = all(tree).find((node) => node.type === 'InkButton');
    action.props.onClick();
    assert.deepEqual(f.navigation, ['/image']);
    assert.equal(f.state.source, 'agent');
});

test('conversation artwork never includes another thread or an unrelated pending intent', () => {
    const f = fixture();
    f.state.receipts.old.task.native = { threadId: 'thread-A', turnId: 'turn-A' };
    f.state.receipts.new.task.native = { threadId: 'thread-B', turnId: 'turn-B' };
    f.state.intents.other = { requestId: 'unrelated', projectId: 'elsewhere' };
    const tree = f.api.AgentMediaPanel({ embedded: true, history: true, threadId: 'thread-A' });
    assert.deepEqual(cards(tree).map((node) => node.props.receipt.task.id), ['old']);
    assert.equal(all(tree).some((node) => node.props?.children === 'unrelated'), false);
    assert.equal(cards(f.api.AgentMediaPanel({ embedded: true, history: true, threadId: 'unknown' })).length, 0);
});
