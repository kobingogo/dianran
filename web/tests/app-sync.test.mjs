import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { webcrypto } from "node:crypto";
const require = createRequire(import.meta.url), ts = require("typescript");
function load(path, mocks, globals = {}) {
    const code = ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
    const module = { exports: {} };
    new Function("require", "module", "exports", "crypto", ...Object.keys(globals), code)((id) => { assert.ok(id in mocks, `unexpected import ${id}`); return mocks[id]; }, module, module.exports, webcrypto, ...Object.values(globals));
    return module.exports;
}
const merger = load("../src/services/app-sync-merge.ts", {});
const project = (title = "local", value = "a") => ({ id: "p", title, updatedAt: "2099-01-01", nodes: [{ id: "n", text: value }], connections: [] });
const config = { url: "https://dav.example", directory: "dianran", username: "u", password: "p" };
function fixture() {
    const events = [], stores = new Map(), media = new Map(), remote = new Map(), writes = [];
    let canvas = { hydrated: true, projects: [project()], deletedProjects: [] }, assets = { hydrated: true, assets: [] };
    let conditional = true, saveFailure = false, conflict = false, failDomain = "", beforeCommit;
    const db = (name) => {
        if (!stores.has(name)) stores.set(name, new Map());
        const map = stores.get(name);
        return { getItem: async (key) => map.get(key) ?? null, setItem: async (key, value) => { map.set(key, structuredClone(value)); return value; }, clear: async () => map.clear(), iterate: async (fn) => { for (const item of map.values()) fn(structuredClone(item)); } };
    };
    const flush = async () => { events.push("flush"); if (saveFailure) throw new Error("disk full"); };
    const canvasStore = { getState: () => ({ ...canvas, replaceProjects: (projects, deletedProjects) => { canvas = { ...canvas, projects, deletedProjects }; } }) };
    const assetStore = { getState: () => ({ ...assets, replaceAssets: async (items) => { assets = { ...assets, assets: items }; } }), persist: { rehydrate: async () => {} } };
    class WebdavRevisionConflict extends Error {}
    const dav = {
        WEBDAV_MANIFEST_FILE_NAME: "manifest.json", WebdavRevisionConflict,
        verifyWebdavConditionalWrites: async () => { events.push("probe"); if (!conditional) throw new Error("条件写入不可用"); },
        readWebdavRevision: async (_, path) => { events.push("read"); const value = remote.get(path); return value ? { file: new Blob([JSON.stringify(value)]), etag: value.etag ?? '"etag-1"' } : null; },
        downloadWebdavFile: async (_, path) => remote.get(path) || null,
        uploadWebdavFile: async (_, path, file, mime, condition) => {
            writes.push({ path, condition });
            if (path.startsWith(failDomain + "/") && failDomain) throw new Error("upload interrupted");
            if (path.endsWith("manifest.json")) {
                if (beforeCommit && path === "canvas/manifest.json") beforeCommit();
                if (conflict) { remote.set(path, manifest(path.split("/")[0], { projects: [project("latest", "racing")], deleted: [] })); throw new WebdavRevisionConflict("远端变化"); }
                remote.set(path, JSON.parse(await file.text()));
            } else remote.set(path, file);
        },
    };
    const storage = { getMediaBlob: async (key) => media.get(key) || null, setMediaBlob: async (key, blob) => media.set(key, blob), resolveMediaUrl: async (key) => `blob:${key}` };
    const app = load("../src/services/app-sync.ts", {
        "@/lib/write-ownership": { businessOperation: (fn) => fn, writeOwnership: { checkpoint: () => events.push("checkpoint") } },
        localforage: { createInstance: ({ storeName }) => db(storeName) }, "@/i18n": { t: (key) => key }, "./app-sync-merge": merger,
        "@/lib/install-write-barrier": { assertStorageSaved: () => {} }, "@/stores/use-composer-store": { flushComposerSave: flush },
        "@/services/file-storage": storage, "@/services/image-storage": { getImageBlob: storage.getMediaBlob, setImageBlob: storage.setMediaBlob, resolveImageUrl: storage.resolveMediaUrl },
        "@/services/webdav-sync": dav, "@/stores/use-asset-store": { flushAssetSave: flush, useAssetStore: assetStore },
        "@/stores/canvas/use-canvas-store": { useCanvasStore: canvasStore, flushCanvasSave: flush },
        "@/constant/brand": { EXPORT_APP_ID: "dianran", STORAGE_NS: "dianran", isAcceptedAppId: (app) => app === "dianran" },
    });
    return { app, remote, media, writes, events, stores, canvas: () => canvas, setCanvas: (value) => { canvas = { ...canvas, ...value }; }, unsupported: () => { conditional = false; }, saveFailure: () => { saveFailure = true; }, conflict: () => { conflict = true; }, failDomain: (value) => { failDomain = value; }, beforeCommit: (fn) => { beforeCommit = fn; } };
}
const manifest = (domain, data, files = [], etag) => ({ app: "dianran", version: 1, domain, data, files, etag });

test("differing project edits survive clock skew; identical object key order does not create conflict", () => {
    const conflicts = [], local = project("same", "a"), remote = { ...project("same", "b"), updatedAt: "1900-01-01" };
    const merged = merger.mergeCanvasSnapshots({ projects: [local], deleted: [] }, { projects: [remote], deleted: [] }, (item) => conflicts.push(item));
    assert.equal(merged.projects.length, 2); assert.deepEqual(merged.projects.map((item) => item.nodes[0].text), ["a", "b"]); assert.equal(conflicts.length, 1);
    assert.equal(merger.mergeRecords([local], [Object.fromEntries(Object.entries(local).reverse())], assert.fail).length, 1);
});
test("delete-versus-edit retains the tombstone and an independent recovery project", () => {
    const value = merger.mergeCanvasSnapshots({ projects: [project()], deleted: [] }, { projects: [], deleted: [{ id: "p", deletedAt: "2100-01-01" }] }, () => {});
    assert.notEqual(value.projects[0].id, "p"); assert.equal(value.deleted[0].id, "p"); assert.match(value.projects[0].title, /删除冲突/);
});
test("flush and blob backup precede network; absent manifests use create-only CAS", async () => {
    const f = fixture(); const result = await f.app.syncAppDataToWebdav(config);
    assert.equal(result.completed.length, 4); assert.equal(result.failed.length, 0);
    assert.ok(f.events.indexOf("flush") < f.events.indexOf("probe"));
    assert.ok(f.writes.every((item) => item.condition?.etag === null));
    assert.ok(f.stores.get("webdav_sync_backups").get(result.backupId));
});
test("unreliable local writes or unsupported condition semantics stop all manifest writes", async () => {
    for (const setup of [(f) => f.saveFailure(), (f) => f.unsupported()]) { const f = fixture(); setup(f); await assert.rejects(f.app.syncAppDataToWebdav(config)); assert.equal(f.writes.length, 0); }
});
test("missing strong ETag rejects only affected domain and reports reliable completed domains", async () => {
    const f = fixture(); f.remote.set("canvas/manifest.json", manifest("canvas", { projects: [project()], deleted: [] }, [], "W/\"weak\""));
    const result = await f.app.syncAppDataToWebdav(config);
    assert.deepEqual(result.completed, ["assets", "image-workbench", "video-workbench"]); assert.equal(result.failed[0].domain, "canvas"); assert.match(result.failed[0].error, /ETag/);
    assert.ok(!f.writes.some((item) => item.path === "canvas/manifest.json"));
});
test("CAS race rereads differences without applying a stale local result or automatically retrying", async () => {
    const f = fixture(); f.remote.set("canvas/manifest.json", manifest("canvas", { projects: [project("remote", "b")], deleted: [] })); f.conflict();
    const result = await f.app.syncAppDataToWebdav(config);
    assert.match(result.failed.find((item) => item.domain === "canvas").error, /重新读取远端.*内容不同/);
    assert.equal(f.canvas().projects.length, 1); assert.equal(f.canvas().projects[0].title, "local");
    assert.equal(f.writes.filter((item) => item.path === "canvas/manifest.json").length, 1);
});
test("same storage key with different media preserves both blobs under independent keys", async () => {
    const f = fixture(), local = project("local", "a"), remote = project("remote", "b");
    local.nodes[0].storageKey = "image:shared"; remote.nodes[0].storageKey = "image:shared";
    f.setCanvas({ projects: [local] }); f.media.set("image:shared", new Blob(["local media"], { type: "image/png" }));
    f.remote.set("canvas/files/remote.png", new Blob(["remote media"], { type: "image/png" }));
    f.remote.set("canvas/manifest.json", manifest("canvas", { projects: [remote], deleted: [] }, [{ storageKey: "image:shared", path: "canvas/files/remote.png", bytes: 12, mimeType: "image/png" }]));
    const result = await f.app.syncAppDataToWebdav(config); assert.equal(result.failed.length, 0);
    const nodes = f.canvas().projects.map((item) => item.nodes[0]); assert.notEqual(nodes[0].storageKey, nodes[1].storageKey);
    assert.equal(await f.media.get(nodes[0].storageKey).text(), "local media"); assert.equal(await f.media.get(nodes[1].storageKey).text(), "remote media");
    assert.ok(f.writes.filter((item) => item.path.includes("/files/")).every((item) => /files\/[a-f0-9]{64}\.png$/.test(item.path)));
});
test("upload interruption is partial completion; local editing during sync is preserved", async () => {
    const f = fixture(); f.failDomain("canvas"); let result = await f.app.syncAppDataToWebdav(config); assert.equal(result.completed.length, 3); assert.match(result.failed[0].error, /interrupted/);
    const other = fixture(); other.remote.set("canvas/manifest.json", manifest("canvas", { projects: [project("remote")], deleted: [] })); other.beforeCommit(() => other.setCanvas({ projects: [project("new live edit")] }));
    result = await other.app.syncAppDataToWebdav(config); assert.match(result.failed.find((item) => item.domain === "canvas").error, /本地又有修改/); assert.equal(other.canvas().projects[0].title, "new live edit");
});
test("backup restores original projects and media after later files are removed", async () => {
    const f = fixture(); const original = project(); original.nodes[0].storageKey = "image:original"; f.setCanvas({ projects: [original] }); f.media.set("image:original", new Blob(["original bytes"]));
    await f.app.syncAppDataToWebdav(config); f.setCanvas({ projects: [project("later edits")] }); f.media.delete("image:original");
    await f.app.restoreLatestSyncBackup(); assert.equal(f.canvas().projects[0].title, "local"); const restoredKey = f.canvas().projects[0].nodes[0].storageKey; assert.notEqual(restoredKey, "image:original"); assert.equal(await f.media.get(restoredKey).text(), "original bytes");
    const backups = [...f.stores.get("webdav_sync_backups").values()].filter((value) => typeof value === "object"); assert.ok(backups.some((value) => value.canvas.projects[0].title === "later edits"));
});

test("WebDAV transport attaches real ETag conditions and verifies server enforcement", async () => {
    const calls = []; let response = new Response(null, { status: 201 }), probeStage = 0, enforceProbe = false;
    const dav = load("../src/services/webdav-sync.ts", { "@/services/api/proxy-transport": { proxyFetch: async (url, init) => { calls.push({ url, init }); if (enforceProbe && url.includes(".dianran-condition") && init.method === "PUT") return new Response(null, { status: ++probeStage === 2 ? 201 : 412 }); return response; } }, "@/i18n": { t: (key) => key }, "@/stores/use-config-store": { withLocalProxy: (url) => url } }, { window: { setTimeout, clearTimeout } });
    await dav.uploadWebdavFile({ ...config, directory: "" }, "manifest.json", new Blob(["a"]), "application/json", { etag: '"strong"' });
    assert.equal(calls.at(-1).init.headers.get("If-Match"), '"strong"');
    await dav.uploadWebdavFile({ ...config, directory: "" }, "manifest.json", new Blob(["a"]), "application/json", { etag: null });
    assert.equal(calls.at(-1).init.headers.get("If-None-Match"), "*");
    response = new Response(null, { status: 412 }); enforceProbe = true; await dav.verifyWebdavConditionalWrites({ ...config, directory: "" }); enforceProbe = false;
    await assert.rejects(dav.uploadWebdavFile({ ...config, directory: "" }, "manifest.json", new Blob(["a"]), "application/json", { etag: '"old"' }), dav.WebdavRevisionConflict);
    response = new Response(null, { status: 201 }); await assert.rejects(dav.verifyWebdavConditionalWrites({ ...config, directory: "" }), /条件写入/);
});

test("actual HTTP WebDAV through the paired proxy exposes ETag and refuses stale writes", async () => {
    const { createServer } = await import("node:http"), { createProxyServer } = await import("../../canvas-proxy/index.js");
    let body, revision = 0;
    const upstream = createServer(async (req, res) => {
        const path = new URL(req.url, "http://fixture").pathname;
        if (req.method === "DELETE") { res.writeHead(204).end(); return; }
        if (req.method === "GET") { if (!body) { res.writeHead(404).end(); return; } res.writeHead(200, { ETag: `"${revision}"` }).end(body); return; }
        if (req.method === "PUT") {
            if (req.headers["if-match"] && req.headers["if-match"] !== `"${revision}"`) { res.writeHead(412).end(); return; }
            if (req.headers["if-none-match"] === "*" && (path.includes(".dianran-condition") ? upstream.probed : body)) { res.writeHead(412).end(); return; }
            let content = ""; for await (const chunk of req) content += chunk;
            if (path.includes(".dianran-condition")) upstream.probed = true;
            else { body = content; revision++; }
            res.writeHead(201).end(); return;
        }
        res.writeHead(201).end();
    });
    await new Promise((resolve) => upstream.listen(0, "127.0.0.1", resolve));
    const target = `http://127.0.0.1:${upstream.address().port}`, origin = "http://localhost:3001", token = "fixture-pairing-secret";
    const proxy = createProxyServer({ origins: [origin], targets: [target], token, logger: () => {} });
    await new Promise((resolve) => proxy.listen(0, "127.0.0.1", resolve));
    const base = `http://127.0.0.1:${proxy.address().port}`;
    const dav = load("../src/services/webdav-sync.ts", { "@/services/api/proxy-transport": { proxyFetch: async (url, init) => { const headers = new Headers(init.headers); headers.set("Origin", origin); headers.set("x-dianran-proxy-token", token); return fetch(url, { ...init, headers }); } }, "@/i18n": { t: (key) => key }, "@/stores/use-config-store": { withLocalProxy: (url) => `${base}/${url}` } }, { window: { setTimeout, clearTimeout } });
    try {
        const actual = { ...config, url: target, directory: "" };
        await dav.verifyWebdavConditionalWrites(actual);
        await dav.uploadWebdavFile(actual, "manifest.json", new Blob(["original"]), "text/plain", { etag: null });
        const first = await dav.readWebdavRevision(actual, "manifest.json"); assert.equal(first.etag, '"1"');
        const response = await fetch(`${base}/${target}/manifest.json`, { headers: { origin, "x-dianran-proxy-token": token } }); assert.match(response.headers.get("access-control-expose-headers"), /etag/i);
        await dav.uploadWebdavFile(actual, "manifest.json", new Blob(["new"]), "text/plain", { etag: first.etag });
        await assert.rejects(dav.uploadWebdavFile(actual, "manifest.json", new Blob(["stale"]), "text/plain", { etag: first.etag }), dav.WebdavRevisionConflict);
        assert.equal(body, "new");
    } finally { proxy.closeAllConnections(); upstream.closeAllConnections(); await Promise.all([new Promise((resolve) => proxy.close(resolve)), new Promise((resolve) => upstream.close(resolve))]); }
});


test("temporary addresses on stored media do not create conflicts; ordinary text is still compared", () => {
    const local = project("same"), remote = structuredClone(local);
    local.nodes[0].metadata = { storageKey: "image:one", content: "blob:local" };
    remote.nodes[0].metadata = { storageKey: "image:one", content: "blob:remote" };
    assert.equal(merger.mergeRecords([local], [remote], assert.fail).length, 1);
    const a = { id: "text", metadata: { content: "blob:ordinary text one" } }, b = { id: "text", metadata: { content: "blob:ordinary text two" } };
    assert.equal(merger.mergeRecords([a], [b], () => {}).length, 2);
    const assetA = { id: "asset", coverUrl: "blob:local", data: { storageKey: "image:one", dataUrl: "data:image/png;base64,AAAA" } };
    const assetB = { id: "asset", coverUrl: "blob:remote", data: { storageKey: "image:one", dataUrl: "data:image/png;base64,BBBB" } };
    assert.equal(merger.mergeRecords([assetA], [assetB], assert.fail).length, 1);
});

test("restoring different bytes remaps identities and does not replace unrelated draft media", async () => {
    const f = fixture(); const original = project(); original.nodes[0].storageKey = "image:shared-with-draft";
    f.setCanvas({ projects: [original] }); f.media.set("image:shared-with-draft", new Blob(["old project bytes"]));
    await f.app.syncAppDataToWebdav(config);
    f.media.set("image:shared-with-draft", new Blob(["new draft bytes"]));
    await f.app.restoreLatestSyncBackup();
    const restoredKey = f.canvas().projects[0].nodes[0].storageKey;
    assert.notEqual(restoredKey, "image:shared-with-draft");
    assert.equal(await f.media.get(restoredKey).text(), "old project bytes");
    assert.equal(await f.media.get("image:shared-with-draft").text(), "new draft bytes");
});
