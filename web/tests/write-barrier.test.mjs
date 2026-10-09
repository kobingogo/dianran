import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createWriteOwnership } from "../src/lib/write-ownership.ts";
import { createSaveQueue } from "../src/lib/canvas/save-queue.ts";
const require = createRequire(import.meta.url), ts = require("typescript");
globalThis.requestAnimationFrame = (fn) => { queueMicrotask(fn); return 0; };
const locks = { request: async (_name, _options, callback) => callback({}) };
function load(path, mocks) {
    const code = ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
    const module = { exports: {} };
    new Function("require", "module", "exports", code)((id) => { assert.ok(id in mocks, `unexpected import ${id}`); return mocks[id]; }, module, module.exports);
    return module.exports;
}

test("real localforage driver initialization cannot replace the write barrier; save failure blocks release until retry", async () => {
    const localforage = require("localforage"), ownership = createWriteOwnership(locks);
    const data = new Map(); let fail = false;
    await localforage.defineDriver({
        _driver: "T04_ISOLATED_DRIVER", _support: true, _initStorage: async () => {},
        clear: async () => data.clear(), getItem: async (key) => data.get(key) ?? null,
        iterate: async (fn) => { for (const [key, value] of data) fn(value, key); },
        key: async (index) => [...data.keys()][index] ?? null, keys: async () => [...data.keys()], length: async () => data.size,
        removeItem: async (key) => data.delete(key),
        setItem: async (key, value) => { if (fail) throw new Error("quota"); data.set(key, value); return value; },
        dropInstance: async () => data.clear(),
    });
    const original = localforage.createInstance;
    const barrier = load("../src/lib/install-write-barrier.ts", { localforage, "./write-ownership": { writeOwnership: ownership }, "./atomic-storage": { guardedStores: new Set(), storageBaselines: new Map() } });
    try {
        barrier.installWriteBarrier();
        const store = localforage.createInstance({ name: "isolated", storeName: "business", driver: "T04_ISOLATED_DRIVER" });
        await store.ready(); // Replaces stubs with the actual driver.
        for (const write of [() => store.setItem("old", "bad"), () => store.removeItem("old"), () => store.clear(), () => store.dropInstance()]) await assert.rejects(write(), /编辑权/);
        assert.equal(data.size, 0);
        await ownership.acquire(async () => {});
        await store.setItem("old", "authoritative");
        fail = true; await assert.rejects(store.setItem("old", "new"), /quota/);
        await assert.rejects(ownership.relinquish(async () => barrier.assertStorageSaved()), /写入失败/);
        assert.equal(ownership.getSnapshot(), "writer");
        assert.equal(data.get("old"), "authoritative");
        fail = false; await store.setItem("old", "new");
        await ownership.relinquish(async () => barrier.assertStorageSaved());
        await Promise.resolve(); await Promise.resolve();
        await assert.rejects(store.setItem("old", "late old tab"), /编辑权/);
        assert.equal(data.get("old"), "new");
    } finally { localforage.createInstance = original; }
});

test("actual canvas store rejects same/different-project mutation before memory or persistence changes", async () => {
    const ownership = createWriteOwnership(), status = require("zustand").create(() => ({}));
    let writes = 0;
    const canvas = load("../src/stores/canvas/use-canvas-store.ts", {
        zustand: require("zustand"), "zustand/middleware": require("zustand/middleware"),
        "@/lib/write-ownership": { writeOwnership: ownership },
        "@/lib/localforage-storage": { canvasIndexedStorage: { getItem: async () => null, setItem: async () => { writes++; } } },
        "@/lib/canvas/save-queue": { createSaveQueue }, "./use-canvas-save-store": { useCanvasSaveStore: status },
        nanoid: { nanoid: () => "isolated-id" }, "@/i18n": { t: (value) => value }, "@/constant/brand": { storageKey: (value) => value },
    });
    await canvas.useCanvasStore.persist.rehydrate();
    const state = canvas.useCanvasStore.getState();
    for (const write of [() => state.createProject("A"), () => state.importProject({}), () => state.renameProject("A", "bad"), () => state.deleteProjects(["B"]), () => state.replaceProjects([]), () => state.updateProject("B", { nodes: [] })]) assert.throws(write, /编辑权/);
    assert.deepEqual(canvas.useCanvasStore.getState().projects, []);
    assert.equal(writes, 0);
});
