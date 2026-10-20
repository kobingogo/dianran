import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const ts = createRequire(import.meta.url)('typescript');
function fixture() {
    const projects = new Map(), drafts = { agentResultProjects: {}, saveAgentResultProject: (key, id) => drafts.agentResultProjects[key] = id };
    let sequence = 0, saveFailure = false;
    const mocks = {
        '@/stores/canvas/use-canvas-store': { useCanvasStore: { getState: () => ({ createProject: title => { const id = `project-${++sequence}`; projects.set(id, { title, nodes: [], connections: [], viewport: {} }); return id; }, openProject: id => projects.get(id) }) }, flushCanvasSave: async () => { if (saveFailure) throw Error('保存失败'); } },
        '@/stores/use-composer-store': { useComposerStore: { getState: () => drafts }, flushComposerSave: async () => {} },
        '@/lib/canvas/agent-revision': { createAgentRevision: () => snapshot => ({ ...snapshot, revision: 'revision' }) },
    };
    const code = ts.transpileModule(readFileSync(new URL('../src/lib/agent/agent-result-target.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    const module = { exports: {} }; new Function('require', 'module', 'exports', code)(id => mocks[id], module, module.exports);
    return { prepare: module.exports.prepareAgentResultTarget, projects, failSave: value => saveFailure = value };
}
test('conversation result target survives continuation and separates threads and local agents', async () => {
    const f = fixture(), first = await f.prepare('agent-A', 'thread-A', '草稿');
    assert.deepEqual(await f.prepare('agent-A', 'thread-A', '继续修改'), first);
    assert.notEqual((await f.prepare('agent-A', 'thread-B', '另一会话')).projectId, first.projectId);
    assert.notEqual((await f.prepare('agent-B', 'thread-A', '另一服务')).projectId, first.projectId);
    assert.equal(f.projects.size, 3);
});
test('deleted result canvas blocks submission instead of silently replacing the target', async () => {
    const f = fixture(), first = await f.prepare('local', 'thread', '作品');
    f.projects.delete(first.projectId);
    await assert.rejects(f.prepare('local', 'thread', '继续'), /已删除/);
    assert.equal(f.projects.size, 0);
});
test('failed local save rejects submission and retry retains the same result identity', async () => {
    const f = fixture(); f.failSave(true);
    await assert.rejects(f.prepare('local', 'thread', '作品'), /保存失败/);
    f.failSave(false);
    assert.equal((await f.prepare('local', 'thread', '重试')).projectId, 'project-1');
    assert.equal(f.projects.size, 1);
});
