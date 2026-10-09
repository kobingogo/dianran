import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fixture } from "./t11-loader.mjs";
const require = createRequire(import.meta.url);
require("fake-indexeddb/auto");

function locks() {
    const held = new Map();
    return { async request(name, options, callback) {
        // Browser lock grant/release occurs after the requesting microtask.
        await Promise.resolve(); await Promise.resolve();
        const readers = held.get(name) || 0;
        if (options.ifAvailable && readers) return callback(null);
        held.set(name, readers + 1);
        try { return await callback({ name }); } finally { held.set(name, held.get(name) - 1); }
    } };
}

async function setup() {
    Object.defineProperty(globalThis, "navigator", { configurable: true, value: { locks: locks() } });
    const db = await new Promise((resolve, reject) => {
        const request = indexedDB.open("infinite-canvas");
        request.onupgradeneeded = () => ["app_state", "image_files", "image_previews", "media_files", "video_generation_logs", "write_conflicts"].forEach((name) => request.result.createObjectStore(name));
        request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    const put = (store, key, value) => new Promise((resolve, reject) => {
        const tx = db.transaction(store, "readwrite"); tx.objectStore(store).put(value, key);
        tx.oncomplete = resolve; tx.onabort = () => reject(tx.error);
    });
    const get = (store, key) => new Promise((resolve, reject) => {
        const request = db.transaction(store).objectStore(store).get(key);
        request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    const cleanup = fixture().load("@/services/media-references").cleanupStoredMedia;
    const close = async () => {
        db.close();
        await new Promise((resolve, reject) => { const request = indexedDB.deleteDatabase("infinite-canvas"); request.onsuccess = resolve; request.onerror = () => reject(request.error); });
    };
    return { put, get, cleanup, close };
}

test("atomic cleanup retains video history, images, durable pending files and conflict backups", async () => {
    const f = await setup();
    try {
        await f.put("video_generation_logs", "history", { references: [{ storageKey: "image:history" }], video: { storageKey: "video:history" } });
        await f.put("app_state", "pending-media:image:pending", { storageKey: "image:pending" });
        await f.put("write_conflicts", "rejected", { local: JSON.stringify({ image: { storageKey: "image:rejected" } }) });
        for (const key of ["image:history", "image:pending", "image:rejected", "image:orphan"]) { await f.put("image_files", key, new Blob([key])); await f.put("image_previews", key, {}); }
        for (const key of ["video:history", "video:orphan"]) await f.put("media_files", key, new Blob([key]));
        await f.cleanup("image_files", {}); await f.cleanup("media_files", {});
        for (const key of ["image:history", "image:pending", "image:rejected"]) assert.ok(await f.get("image_files", key), key);
        assert.ok(await f.get("media_files", "video:history"));
        assert.equal(await f.get("image_files", "image:orphan"), undefined);
        assert.equal(await f.get("image_previews", "image:orphan"), undefined);
        assert.equal(await f.get("media_files", "video:orphan"), undefined);
    } finally { await f.close(); }
});

test("corrupt authoritative data aborts the transaction before any file is deleted", async () => {
    const f = await setup();
    try {
        await f.put("app_state", "infinite-canvas:canvas_store", '{"state":{"projects":null}}');
        await f.put("image_files", "image:orphan", new Blob(["original"]));
        await assert.rejects(f.cleanup("image_files", {}), /停止清理/);
        assert.ok(await f.get("image_files", "image:orphan"));
    } finally { await f.close(); }
});

test("another open page prevents collection of its potentially unsaved references", async () => {
    const f = await setup(); let release, ready;
    try {
        await f.put("image_files", "image:unsaved-other-page", new Blob(["original"]));
        const registered = new Promise((resolve) => { ready = resolve; });
        const otherPage = navigator.locks.request("dianran:media-page", { mode: "shared" }, async () => new Promise((resolve) => { release = resolve; ready(); }));
        await registered;
        await f.cleanup("image_files", {});
        assert.ok(await f.get("image_files", "image:unsaved-other-page"));
        release(); await otherPage;
        await f.cleanup("image_files", {});
        assert.equal(await f.get("image_files", "image:unsaved-other-page"), undefined);
    } finally { release?.(); await f.close(); }
});
