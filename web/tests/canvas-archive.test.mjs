import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { collectMediaStorageKeys } from "../src/lib/media-references.ts";

const require = createRequire(import.meta.url);
const ts = require("typescript");
function load(path, mocks) {
    const source = readFileSync(new URL(path, import.meta.url), "utf8");
    const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
    const module = { exports: {} };
    new Function("require", "module", "exports", code)((id) => { assert.ok(id in mocks, `unexpected dependency: ${id}`); return mocks[id]; }, module, module.exports);
    return module.exports;
}
const zip = load("../src/lib/zip.ts", { fflate: require("fflate"), "./zip-worker-client": { createZipWorker: () => ({ terminate() {}, postMessage(entries) { queueMicrotask(() => this.onmessage({ data: require("fflate").zipSync(Object.fromEntries(entries), { level: 0 }) })); } }) } });
const node = (id, type, metadata) => ({ id, type, title: id, width: 200, height: 100, position: { x: 10, y: 20 }, metadata });
const project = () => ({
    id: "project", title: "测试画布", createdAt: "saved", updatedAt: "saved", backgroundMode: "lines", showImageInfo: false,
    viewport: { x: 12, y: 34, k: 1.5 }, activeChatId: null,
    nodes: [node("image", "image", { storageKey: "image:original", content: "blob:old", creation: { parameters: { size: "1024x1024", quality: "high" } }, inputSnapshot: { prompt: "山水", referenceImages: [{ storageKey: "image:original", dataUrl: "blob:old" }] } }), node("video", "video", { storageKey: "video:original", content: "blob:video" })],
    connections: [{ id: "edge", fromNodeId: "image", toNodeId: "video", kind: "generation" }],
    chatSessions: [], workflowRuns: [{ resourceSnapshot: [node("audio", "audio", { storageKey: "audio:original", content: "blob:audio" })] }],
});
function fixture() {
    const blobs = new Map([
        ["image:original", new Blob(["image bytes"], { type: "image/png" })],
        ["video:original", new Blob(["video bytes"], { type: "video/mp4" })],
        ["audio:original", new Blob(["audio bytes"], { type: "audio/mpeg" })],
    ]);
    const state = { projects: [], writes: [], deleted: [], downloads: [], hydrated: true, readFailed: false, failFile: false, failCommit: false, flushes: 0, unreadable: false };
    let id = 0;
    const read = async (key) => { if (state.unreadable) throw new Error("IndexedDB unavailable"); return blobs.get(key) || null; };
    const write = async (key, blob) => { state.writes.push(key); if (state.failFile && state.writes.length === 2) throw new Error("file write failed"); blobs.set(key, blob); return `blob:new-${key}`; };
    const remove = async (keys) => { for (const key of keys) { state.deleted.push(key); blobs.delete(key); } };
    const mocks = {
        "@/lib/write-ownership": { assertBusinessWriter() {}, businessOperation: (fn) => fn, writeOwnership: { canWrite: () => true, getSnapshot: () => "writer" } },
        nanoid: { nanoid: () => `fresh-${++id}` },
        "@/lib/zip": zip,
        "@/lib/media-references": { collectMediaStorageKeys },
        "@/constant/brand": { EXPORT_APP_ID: "dianran" },
        "@/services/image-storage": { getImageBlob: read, setImageBlob: write, deleteStoredImages: remove },
        "@/services/file-storage": { getMediaBlob: read, setMediaBlob: write, deleteStoredMedia: remove },
        "@/stores/canvas/use-canvas-save-store": { useCanvasSaveStore: { getState: () => state } },
        "@/stores/canvas/use-canvas-store": {
            useCanvasStore: { getState: () => ({ ...state, importProject: (value) => { state.projects.push(value); return `project-${state.projects.length}`; } }) },
            flushCanvasSave: async () => { state.flushes++; if (state.failCommit && state.flushes === 2) throw new Error("project save failed"); },
        },
    };
    const archive = load("../src/lib/canvas/canvas-archive.ts", mocks);
    const exported = load("../src/lib/canvas/canvas-export.ts", { ...mocks, "./canvas-archive": archive, "file-saver": { saveAs: (blob, name) => state.downloads.push({ blob, name }) }, "@/i18n": { t: (key) => key }, "@/types/canvas": { CanvasNodeType: { Text: "text" } } });
    const pack = async (prepared) => zip.createZip([{ name: "projects.json", data: JSON.stringify(prepared.manifest) }, ...prepared.files]);
    return { ...archive, ...exported, blobs, state, pack };
}

test("real ZIP restores original bytes, prompt parameters, topology and snapshots in an independent store", async () => {
    const source = fixture(), target = fixture();
    const original = project();
    await source.exportCanvasProjects([original], "完整备份");
    const payload = source.state.downloads[0].blob;
    target.blobs.clear();
    const archive = await target.readCanvasArchive(payload);
    const ids = await target.restoreCanvasArchive(archive);
    assert.equal(ids.length, 1);
    const restored = target.state.projects[0];
    assert.deepEqual(restored.connections, original.connections);
    assert.deepEqual(restored.viewport, original.viewport);
    assert.equal(restored.nodes[0].metadata.inputSnapshot.prompt, "山水");
    assert.deepEqual(restored.nodes[0].metadata.creation.parameters, original.nodes[0].metadata.creation.parameters);
    assert.equal(restored.nodes[0].metadata.storageKey, restored.nodes[0].metadata.inputSnapshot.referenceImages[0].storageKey);
    assert.equal(collectMediaStorageKeys(restored).size, 3);
    assert.ok(restored.nodes[0].metadata.content.startsWith("blob:new-"));
    for (const item of archive.manifest.projects[0].files) {
        const newKey = [...target.blobs.keys()].find((key) => key.startsWith(item.storageKey.split(":")[0] + ":"));
        assert.notEqual(newKey, item.storageKey);
        assert.equal(await target.blobs.get(newKey).text(), await source.blobs.get(item.storageKey).text());
    }
    assert.deepEqual(original, project());
});

test("missing or unreadable originals prevent complete download and produce explicit rescue entries", async () => {
    const f = fixture();
    f.blobs.delete("video:original");
    await assert.rejects(f.exportCanvasProjects([project()], "backup"), f.CanvasBackupError);
    assert.deepEqual(f.state.downloads, []);
    await f.exportCanvasProjects([project()], "backup", true);
    const archive = await f.readCanvasArchive(f.state.downloads[0].blob);
    assert.equal(archive.manifest.backup.mode, "rescue");
    assert.equal(archive.manifest.backup.unavailableFiles[0].reference, "video:original");
    f.state.unreadable = true;
    await assert.rejects(f.prepareCanvasArchive([project()]), f.CanvasBackupError);
});

test("remote and unowned blob media are listed, including alternative images, while prompt URLs remain text", async () => {
    const f = fixture(), p = project();
    p.nodes.push(node("text", "text", { content: "https://example.com/article" }));
    p.nodes.push(node("remote", "image", { content: "https://example.com/image.png", images: [{ content: "blob:unowned" }] }));
    await assert.rejects(f.prepareCanvasArchive([p]), f.CanvasBackupError);
    const prepared = await f.prepareCanvasArchive([p], true);
    assert.equal(prepared.manifest.backup.externalLinks.length, 1);
    assert.equal(prepared.manifest.backup.unavailableFiles.length, 1);
});

test("missing, corrupted, unlisted or duplicate ZIP files reject before any local write", async () => {
    const f = fixture();
    const prepared = await f.prepareCanvasArchive([project()]);
    for (const damage of ["missing", "corrupt", "unlisted", "duplicate", "version", "edge"]) {
        const copy = { manifest: structuredClone(prepared.manifest), files: [...prepared.files] };
        if (damage === "missing") copy.files.pop();
        if (damage === "corrupt") copy.files[0] = { ...copy.files[0], data: new Blob(["other bytes"]) };
        if (damage === "unlisted") copy.manifest.projects[0].files.pop();
        if (damage === "duplicate") copy.manifest.projects[0].files.push(copy.manifest.projects[0].files[0]);
        if (damage === "version") copy.manifest.version = 3;
        if (damage === "edge") copy.manifest.projects[0].project.connections[0].toNodeId = "unknown";
        await assert.rejects(f.readCanvasArchive(await f.pack(copy)));
        assert.deepEqual(f.state.writes, []);
        assert.deepEqual(f.state.projects, []);
    }
});

test("rescue restore requires consent and cannot bind a missing original to an existing user's file", async () => {
    const source = fixture(), target = fixture();
    source.blobs.delete("video:original");
    const prepared = await source.prepareCanvasArchive([project()], true);
    const archive = await target.readCanvasArchive(await source.pack(prepared));
    await assert.rejects(target.restoreCanvasArchive(archive), /先确认/);
    assert.deepEqual(target.state.writes, []);
    await target.restoreCanvasArchive(archive, true);
    const missing = target.state.projects[0].nodes[1].metadata;
    assert.notEqual(missing.storageKey, "video:original");
    assert.equal(missing.content, "");
    assert.equal(await target.blobs.get("video:original").text(), "video bytes");
});

test("file-write failure removes only staged new identities and leaves projects and existing media intact", async () => {
    const f = fixture();
    const archive = await f.readCanvasArchive(await f.pack(await f.prepareCanvasArchive([project()])));
    f.state.failFile = true;
    await assert.rejects(f.restoreCanvasArchive(archive), /file write failed/);
    assert.deepEqual(f.state.projects, []);
    assert.equal(f.blobs.size, 3);
    assert.ok(f.state.deleted.every((key) => key.includes("fresh-")));
});

test("project-save failure preserves newly imported memory and media for retry or rescue", async () => {
    const f = fixture();
    const archive = await f.readCanvasArchive(await f.pack(await f.prepareCanvasArchive([project()])));
    f.state.failCommit = true;
    await assert.rejects(f.restoreCanvasArchive(archive), /project save failed/);
    assert.equal(f.state.projects.length, 1);
    assert.equal(f.blobs.size, 6);
    assert.deepEqual(f.state.deleted, []);
});

test("unreadable local project store blocks import before media writes", async () => {
    const f = fixture();
    const archive = await f.readCanvasArchive(await f.pack(await f.prepareCanvasArchive([project()])));
    f.state.readFailed = true;
    await assert.rejects(f.restoreCanvasArchive(archive), /尚未读取成功/);
    assert.deepEqual(f.state.writes, []);
});
