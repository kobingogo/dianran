import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createSaveQueue } from "../src/lib/canvas/save-queue.ts";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const input = (title) => ({ kind: "text", title, coverUrl: "", tags: [], data: { content: title } });
const oldAsset = { ...input("old"), id: "old", createdAt: "existing", updatedAt: "existing" };

async function fixture({ failRead = false, raw = JSON.stringify({ state: { assets: [oldAsset] }, version: 0 }) } = {}) {
    const database = { raw, failRead, failWrite: false, gate: undefined, writes: [] };
    const cleanups = [];
    const callbacks = [];
    let sequence = 0;
    const status = require("zustand").create(() => ({ status: "loading", error: "", readFailed: false }));
    const mocks = {
        "@/lib/write-ownership": { assertBusinessWriter() {}, businessOperation: (fn) => fn, writeOwnership: { canWrite: () => true, getSnapshot: () => "writer" } },
        zustand: require("zustand"),
        "zustand/middleware": require("zustand/middleware"),
        nanoid: { nanoid: () => `new-${++sequence}` },
        "@/constant/brand": { storageKey: (name) => `isolated:${name}` },
        "@/lib/canvas/save-queue": { createSaveQueue },
        "./use-asset-save-store": { useAssetSaveStore: status },
        "@/stores/canvas/use-canvas-store": { useCanvasStore: { getState: () => ({ projects: [] }) } },
        "@/services/image-storage": { cleanupUnusedImages: async () => cleanups.push("image"), ensureImagePreview: async () => {}, resolveImageUrl: async (_key, url) => url },
        "@/services/file-storage": { cleanupUnusedMedia: async () => cleanups.push("media"), resolveMediaUrl: async (_key, url) => url },
        "@/lib/localforage-storage": { canvasIndexedStorage: {
            async getItem() { if (database.failRead) throw new Error("read failed"); return database.raw; },
            async setItem(_key, value) {
                if (database.gate) await database.gate;
                if (database.failWrite) throw new Error("QuotaExceededError");
                database.writes.push(value);
                database.raw = value;
            },
        } },
    };
    const source = readFileSync(new URL("../src/stores/use-asset-store.ts", import.meta.url), "utf8");
    const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
    const module = { exports: {} };
    new Function("require", "module", "exports", "window", "document", code)((id) => {
        assert.ok(id in mocks, `unexpected dependency: ${id}`);
        return mocks[id];
    }, module, module.exports, { addEventListener() {}, setTimeout: (callback) => callbacks.push(callback) }, { addEventListener() {} });
    const { useAssetStore: store, retryAssetSave, flushAssetSave } = module.exports;
    await store.persist.rehydrate();
    return { store, status, database, retryAssetSave, flushAssetSave, cleanups, runCleanup: async () => { for (const callback of callbacks.splice(0)) await callback(); } };
}

test("failed save rejects, retains memory, retries the same IndexedDB record and reads it after rehydration", async () => {
    const f = await fixture();
    f.database.failWrite = true;
    await assert.rejects(f.store.getState().addAsset(input("new")), /QuotaExceededError/);
    assert.equal(f.status.getState().status, "error");
    assert.equal(f.store.getState().assets[0].title, "new");
    assert.equal(JSON.parse(f.database.raw).state.assets[0].title, "old");
    f.database.failWrite = false;
    await f.retryAssetSave();
    await f.store.persist.rehydrate();
    assert.deepEqual(f.store.getState().assets.map((asset) => asset.title), ["new", "old"]);
    assert.equal(f.status.getState().status, "saved");
});

test("success receipt waits for the write and includes changes made during an in-flight save", async () => {
    const f = await fixture();
    let finish;
    f.database.gate = new Promise((resolve) => { finish = resolve; });
    let settled = false;
    const first = f.store.getState().addAsset(input("first")).then(() => { settled = true; });
    const second = f.store.getState().addAsset(input("second"));
    await Promise.resolve();
    assert.equal(settled, false);
    assert.equal(f.status.getState().status, "saving");
    finish();
    await Promise.all([first, second]);
    assert.deepEqual(JSON.parse(f.database.raw).state.assets.map((asset) => asset.title), ["second", "first", "old"]);
});

test("read failure blocks all mutation entry points and does not overwrite disk with an empty list", async () => {
    const f = await fixture({ failRead: true });
    assert.equal(f.store.getState().hydrated, false);
    assert.equal(f.status.getState().readFailed, true);
    for (const action of [() => f.store.getState().addAsset(input("new")), () => f.store.getState().updateAsset("old", { title: "changed" }), () => f.store.getState().removeAsset("old"), () => f.store.getState().replaceAssets([])]) await assert.rejects(action(), /读取成功/);
    assert.deepEqual(f.database.writes, []);
    f.database.failRead = false;
    await f.retryAssetSave();
    assert.equal(f.store.getState().assets[0].title, "old");
});

test("corrupt records refuse hydration and writes", async () => {
    for (const raw of ["{broken", "null", JSON.stringify({ state: { assets: {} }, version: 0 }), JSON.stringify({ state: { assets: [null] }, version: 0 }), JSON.stringify({ state: { assets: [oldAsset] }, version: 99 })]) {
        const f = await fixture({ raw });
        assert.equal(f.status.getState().readFailed, true);
        await assert.rejects(f.store.getState().replaceAssets([]));
        assert.equal(f.database.raw, raw);
        assert.deepEqual(f.database.writes, []);
    }
});

test("a failed deletion never starts cleanup; retry commits before cleanup", async () => {
    const f = await fixture();
    f.database.failWrite = true;
    await assert.rejects(f.store.getState().removeAsset("old"));
    await f.runCleanup();
    assert.deepEqual(f.cleanups, []);
    assert.equal(JSON.parse(f.database.raw).state.assets.length, 1);
    f.database.failWrite = false;
    await f.retryAssetSave();
    assert.equal(JSON.parse(f.database.raw).state.assets.length, 0);
    await f.runCleanup();
    assert.deepEqual(f.cleanups, ["image", "media"]);
});

test("rehydration with unsaved changes refuses to discard them when the pending write still fails", async () => {
    const f = await fixture();
    f.database.failWrite = true;
    await assert.rejects(f.store.getState().addAsset(input("unsaved")));
    await f.store.persist.rehydrate();
    assert.equal(f.store.getState().assets[0].title, "unsaved");
    assert.equal(JSON.parse(f.database.raw).state.assets[0].title, "old");
    f.database.failWrite = false;
    await f.flushAssetSave();
});
