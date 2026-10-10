import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url), ts = require('typescript');
function load(path, mocks) {
    const module = { exports: {} };
    const code = ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
    new Function('require', 'module', 'exports', code)((id) => { assert.ok(id in mocks, `dependency ${id}`); return mocks[id]; }, module, module.exports);
    return module.exports;
}
function fixture(disk = new Map()) {
    let fail = false;
    const queue = load('../src/lib/canvas/save-queue.ts', {});
    const mocks = { zustand: require('zustand'), localforage: { createInstance: () => ({ getItem: async (key) => disk.get(key), setItem: async (key, value) => { if (fail) throw Error('disk full'); disk.set(key, structuredClone(value)); } }) }, '@/constant/brand': { STORAGE_NS: 'test' }, '@/lib/canvas/save-queue': queue, '@/lib/write-ownership': { writeOwnership: { canWrite: () => true }, assertBusinessWriter: () => {} }, nanoid: { nanoid: () => 'task-id' } };
    const api = load('../src/features/tasks/task-store.ts', mocks);
    return { api, disk, fail: (value) => { fail = value; } };
}
const input = (id) => ({ id, kind: 'image', model: 'model', sourcePath: '/image', summary: id });
test('concurrent business tasks retain independent phases, remote identities and saves', async () => {
    const { api } = fixture(); await api.reloadCreationTasks();
    api.beginCreationTask({ ...input('A'), startedAt: 123 }); api.beginCreationTask(input('B'));
    api.beginCreationTask(input('A'));
    assert.equal(api.useTaskStore.getState().tasks.find((task) => task.id === 'A').startedAt, 123);
    api.updateCreationTask('A', { phase: 'done', saveState: 'error', saveError: 'disk full' });
    api.updateCreationTask('B', { phase: 'generating', remoteId: 'remote-B', progress: 22 });
    await api.flushTaskSave();
    const tasks = api.useTaskStore.getState().tasks;
    assert.equal(tasks.find((task) => task.id === 'A').saveState, 'error');
    assert.equal(tasks.find((task) => task.id === 'B').progress, 22);
    assert.equal(tasks.find((task) => task.id === 'B').endedAt, undefined);
});
test('refresh restores saved results and interrupts waiting without declaring remote failure or resubmitting', async () => {
    const { api, disk } = fixture(); await api.reloadCreationTasks();
    api.beginCreationTask(input('waiting')); api.beginCreationTask(input('saved'));
    api.updateCreationTask('saved', { phase: 'done', saveState: 'saved', nodeId: 'result-node' });
    await api.flushTaskSave();
    const restored = fixture(disk).api; await restored.reloadCreationTasks();
    assert.equal(restored.useTaskStore.getState().tasks.find((task) => task.id === 'waiting').phase, 'unknown');
    assert.equal(restored.useTaskStore.getState().tasks.find((task) => task.id === 'saved').nodeId, 'result-node');
    assert.equal(restored.useTaskStore.getState().tasks.length, 2);
});
test('clear hides finished display while retaining unresolved saving and unknown task records', async () => {
    const { api, disk } = fixture(); await api.reloadCreationTasks();
    for (const id of ['done', 'unknown', 'save-error', 'saving']) api.beginCreationTask(input(id));
    api.updateCreationTask('done', { phase: 'done', saveState: 'saved' });
    api.updateCreationTask('unknown', { phase: 'unknown' });
    api.updateCreationTask('save-error', { phase: 'done', saveState: 'error' });
    api.updateCreationTask('saving', { phase: 'done', saveState: 'saving' });
    api.useTaskStore.getState().clearFinished(); await api.flushTaskSave();
    assert.equal(disk.get('tasks').length, 4);
    assert.deepEqual(disk.get('tasks').filter((task) => task.hidden).map((task) => task.id), ['done']);
});
test('storage failure is exposed and damaged storage is not overwritten', async () => {
    const f = fixture(); await f.api.reloadCreationTasks(); f.fail(true);
    f.api.beginCreationTask(input('A')); await assert.rejects(f.api.flushTaskSave(), /disk full/);
    assert.match(f.api.useTaskStore.getState().storageError, /未保存/);
    const broken = fixture(); broken.disk.set('tasks', { broken: true });
    await assert.rejects(broken.api.reloadCreationTasks(), /损坏/);
    assert.deepEqual(broken.disk.get('tasks'), { broken: true });
});
test('accepted receipt clears only the unchanged draft; late receipt protects new text, references and canvas inputs', () => {
    const api = load('../src/stores/use-composer-store.ts', { zustand: require('zustand'), 'zustand/middleware': { persist: (creator) => creator, createJSONStorage: () => ({}) }, localforage: { createInstance: () => ({}) }, '@/constant/brand': { STORAGE_NS: 'test', storageKey: (key) => key }, '@/lib/canvas/save-queue': { createSaveQueue: () => ({ flush: async () => {} }) }, '@/lib/write-ownership': { assertBusinessWriter: () => {}, writeOwnership: { canWrite: () => true } }, '@/services/image-storage': {}, '@/lib/composer': { uniqueReferences: (refs) => refs } });
    const store = api.useComposerStore;
    store.getState().patch('image', { prompt: 'accepted', references: [] });
    api.consumeComposerDraft('image', store.getState().image);
    assert.equal(store.getState().image.prompt, '');
    store.getState().patch('image', { prompt: 'old' }); const old = store.getState().image;
    store.getState().patch('image', { prompt: 'next draft' }); api.consumeComposerDraft('image', old);
    assert.equal(store.getState().image.prompt, 'next draft');
    store.getState().patch('image', { prompt: 'new canvas input', nodeIds: ['A'] }, 'canvas:new:image');
    const canvas = store.getState().scoped['canvas:new:image'];
    store.getState().patch('image', { nodeIds: ['B'] }, 'canvas:new:image');
    api.consumeComposerDraft('image', canvas, 'canvas:new:image');
    assert.deepEqual(store.getState().scoped['canvas:new:image'].nodeIds, ['B']);
});
