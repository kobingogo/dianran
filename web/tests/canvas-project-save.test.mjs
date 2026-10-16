import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './t11-loader.mjs';

test('unchanged project patches and titles preserve identity and modification time', async () => {
    const f = fixture({ window: undefined });
    f.mocks['@/lib/write-ownership'].writeOwnership = { assertOwned() {}, canWrite: () => true, getSnapshot: () => 'writer' };
    const { useCanvasStore } = f.load('@/stores/canvas/use-canvas-store');
    await useCanvasStore.persist.rehydrate();
    const state = useCanvasStore.getState();
    const id = state.createProject('原画布');
    const project = useCanvasStore.getState().openProject(id);
    const projects = useCanvasStore.getState().projects;
    state.updateProject(id, { nodes: [], connections: [], viewport: { ...project.viewport } });
    state.renameProject(id, ' 原画布 ');
    state.renameProject(id, '');
    assert.equal(useCanvasStore.getState().projects, projects);
    assert.equal(useCanvasStore.getState().openProject(id), project);
    state.updateProject(id, { viewport: { ...project.viewport, x: project.viewport.x + 10 } });
    assert.notEqual(useCanvasStore.getState().openProject(id), project);
    assert.equal(useCanvasStore.getState().openProject(id).viewport.x, project.viewport.x + 10);
    state.renameProject(id, '新标题');
    assert.equal(useCanvasStore.getState().openProject(id).title, '新标题');
});
