import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { fixture } from "./t11-loader.mjs";
const require = createRequire(import.meta.url);
const fakeIndexedDB = require("fake-indexeddb");
globalThis.indexedDB = fakeIndexedDB.indexedDB;
globalThis.IDBKeyRange = fakeIndexedDB.IDBKeyRange;
globalThis.window = globalThis;
const { load } = fixture();
const { mergeStorageValue, StorageConflictError } = load("@/lib/storage-conflicts");
const { atomicStorageWrite, CONFLICT_STORE, preserveConflictCopies, MEDIA_PIN_PREFIX, storageConflictId } = load("@/lib/atomic-storage");
const { collectStoredReferenceValue } = load("@/lib/media-references");
const localforage = require("localforage");
const indexedDBTest = localforage.supports(localforage.INDEXEDDB) ? test : test.skip;
const snapshot = (projects) => JSON.stringify({ state: { projects, deletedProjects: [] }, version: 0 });
async function database() {
    const name = `conflict-test-${crypto.randomUUID()}`;
    const db = await new Promise((resolve, reject) => {
        const request = globalThis.indexedDB.open(name);
        request.onupgradeneeded = () => ["app_state", CONFLICT_STORE, "creation_tasks", "image_files"].forEach((store) => request.result.createObjectStore(store));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
    const read = (store, key) => new Promise((resolve, reject) => {
        const request = db.transaction(store).objectStore(store).get(key);
        request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    const put = (store, key, value) => new Promise((resolve, reject) => {
        const transaction = db.transaction(store, "readwrite"); transaction.objectStore(store).put(value, key);
        transaction.oncomplete = resolve; transaction.onabort = () => reject(transaction.error);
    });
    return { name, read, put, close: () => db.close() };
}

test("two stale pages add records and continue editing without deleting the other page's additions", async () => {
    const db = await database(); const key = "infinite-canvas:canvas_store";
    try {
        const base = snapshot([]), a = snapshot([{ id: "A", title: "A" }]), b = snapshot([{ id: "B", title: "B" }]);
        await db.put("app_state", key, base);
        await Promise.all([atomicStorageWrite(db.name, "app_state", key, base, a), atomicStorageWrite(db.name, "app_state", key, base, b)]);
        await atomicStorageWrite(db.name, "app_state", key, a, snapshot([{ id: "A", title: "A edited" }]));
        const records = JSON.parse(await db.read("app_state", key)).state.projects;
        assert.equal(records.length, 2); assert.equal(records.find((item) => item.id === "A").title, "A edited"); assert.ok(records.some((item) => item.id === "B"));
    } finally { db.close(); }
});

test("same-record edit and delete conflicts keep authoritative data and persist the rejected snapshot", async () => {
    const db = await database(); const key = "infinite-canvas:canvas_store";
    const base = snapshot([{ id: "A", title: "original", nodes: [] }]);
    const remote = snapshot([{ id: "A", title: "other page", nodes: [] }]);
    const local = snapshot([{ id: "A", title: "this page", nodes: [] }]);
    try {
        await db.put("app_state", key, remote);
        await assert.rejects(atomicStorageWrite(db.name, "app_state", key, base, local), StorageConflictError);
        assert.equal(await db.read("app_state", key), remote);
        const conflict = await db.read(CONFLICT_STORE, storageConflictId(db.name, "app_state", key));
        assert.equal(conflict.local, local);
        await preserveConflictCopies(conflict);
        const copies = JSON.parse(await db.read("app_state", key)).state.projects;
        assert.equal(copies.length, 2); assert.equal(copies.find((item) => item.id === "A").title, "other page");
        assert.ok(copies.some((item) => item.id !== "A" && item.title === "this page（冲突副本）"));
        await assert.rejects(atomicStorageWrite(db.name, "app_state", key, base, snapshot([])), StorageConflictError);
        assert.equal(JSON.parse(await db.read("app_state", key)).state.projects.length, 2);
    } finally { db.close(); }
});

test("independent asset edits and deletions merge, but concurrent editing of one asset does not", () => {
    const base = [{ id: "A", title: "a" }, { id: "B", title: "b" }];
    assert.deepEqual(mergeStorageValue(base, [base[0]], [{ id: "A", title: "new" }, base[1]]), [{ id: "A", title: "new" }]);
    assert.throws(() => mergeStorageValue(base, [{ id: "A", title: "ours" }, base[1]], [{ id: "A", title: "theirs" }, base[1]]), StorageConflictError);
});

test("different canvas drafts merge while same prompt edits conflict; blob URL renewal is not an edit", () => {
    const base = { scoped: { a: { prompt: "old" }, b: { prompt: "old" } } };
    assert.deepEqual(mergeStorageValue(base, { scoped: { ...base.scoped, a: { prompt: "A" } } }, { scoped: { ...base.scoped, b: { prompt: "B" } } }), { scoped: { a: { prompt: "A" }, b: { prompt: "B" } } });
    assert.throws(() => mergeStorageValue({ prompt: "old" }, { prompt: "ours" }, { prompt: "theirs" }), StorageConflictError);
    const item = { id: "image", storageKey: "image:x", dataUrl: "blob:tab-a" };
    assert.deepEqual(mergeStorageValue(item, { ...item, dataUrl: "blob:tab-b" }, { ...item, title: "edited" }), { ...item, title: "edited" });
});

test("task additions from different pages preserve both identities", async () => {
    const db = await database();
    try {
        await db.put("creation_tasks", "tasks", []);
        await Promise.all([atomicStorageWrite(db.name, "creation_tasks", "tasks", [], [{ id: "a", phase: "generating" }]), atomicStorageWrite(db.name, "creation_tasks", "tasks", [], [{ id: "b", phase: "generating" }])]);
        assert.deepEqual(new Set((await db.read("creation_tasks", "tasks")).map((item) => item.id)), new Set(["a", "b"]));
    } finally { db.close(); }
});

indexedDBTest("the installed localforage barrier detects conflicts across separate page baselines", async () => {
    const original = localforage.createInstance;
    const name = `real-barrier-${crypto.randomUUID()}`;
    const key = "infinite-canvas:canvas_store";
    const makePage = async () => {
        localforage.createInstance = original;
        const page = fixture();
        page.load("@/lib/install-write-barrier").installWriteBarrier();
        const ownership = page.load(fileURLToPath(new URL("../src/lib/write-ownership.ts", import.meta.url))).writeOwnership;
        await ownership.acquire(async () => {});
        const storage = localforage.createInstance({ name, storeName: "app_state", driver: localforage.INDEXEDDB });
        await storage.getItem(key);
        return storage;
    };
    try {
        const a = await makePage(), b = await makePage();
        await Promise.all([a.setItem(key, snapshot([{ id: "a", title: "A" }])), b.setItem(key, snapshot([{ id: "b", title: "B" }]))]);
        const reader = original.call(localforage, { name, storeName: "app_state", driver: localforage.INDEXEDDB });
        assert.equal(JSON.parse(await reader.getItem(key)).state.projects.length, 2);
        const c = await makePage(), d = await makePage(); // Both read before A changes again.
        await a.setItem(key, snapshot([{ id: "a", title: "A updated" }]));
        await Promise.all([
            assert.rejects(c.setItem(key, snapshot([{ id: "a", title: "conflicting C" }, { id: "b", title: "B" }])), /另一页面/),
            assert.rejects(d.setItem(key, snapshot([{ id: "a", title: "conflicting D" }, { id: "b", title: "B" }])), /另一页面/),
        ]);
        assert.equal(JSON.parse(await reader.getItem(key)).state.projects.find((item) => item.id === "a").title, "A updated");
        const backups = original.call(localforage, { name, storeName: CONFLICT_STORE, driver: localforage.INDEXEDDB });
        assert.equal(await backups.length(), 2); // Conflicting pages must not overwrite each other's backups.
    } finally { localforage.createInstance = original; await localforage.dropInstance({ name }); }
});

test("a failed business write retains the media pin; only successful registration releases it", async () => {
    const db = await database(); const key = "infinite-canvas:asset_store";
    const base = JSON.stringify({ state: { assets: [{ id: "a", title: "original" }] } });
    const remote = JSON.stringify({ state: { assets: [{ id: "a", title: "remote" }] } });
    const local = JSON.stringify({ state: { assets: [{ id: "a", title: "local", data: { storageKey: "image:new" } }] } });
    try {
        await db.put("app_state", MEDIA_PIN_PREFIX + "image:new", { storageKey: "image:new" });
        await db.put("app_state", key, remote);
        await assert.rejects(atomicStorageWrite(db.name, "app_state", key, base, local), StorageConflictError);
        assert.ok(await db.read("app_state", MEDIA_PIN_PREFIX + "image:new"));
        await atomicStorageWrite(db.name, "app_state", key, remote, local);
        assert.equal(await db.read("app_state", MEDIA_PIN_PREFIX + "image:new"), undefined);
    } finally { db.close(); }
});

test("corrupt authoritative records stop collection and conflict backups protect rejected media", () => {
    assert.throws(() => collectStoredReferenceValue("app_state", "infinite-canvas:canvas_store", '{"state":{"projects":null}}', new Set()), /停止清理/);
    assert.throws(() => collectStoredReferenceValue("video_generation_logs", "video", { references: null }, new Set()), /停止清理/);
    const keys = new Set();
    collectStoredReferenceValue(CONFLICT_STORE, "conflict", { local: snapshot([{ id: "A", nodes: [{ metadata: { storageKey: "image:rejected" } }] }]) }, keys);
    // Serialized snapshots inside a conflict are expanded by the collector.
    assert.ok(keys.has("image:rejected"));
});
