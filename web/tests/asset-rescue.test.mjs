import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";

const ts = createRequire(import.meta.url)("typescript");

function fixture() {
    let entries;
    const downloads = [];
    const mocks = {
        "@/lib/write-ownership": { businessOperation: (fn) => fn },
        "file-saver": { saveAs: (_blob, name) => downloads.push(name) },
        "@/constant/brand": { EXPORT_APP_ID: "dianran" },
        "@/lib/zip": {
            createZip: async (files) => { entries = files; return new Blob(["zip"]); },
            readZip: async () => new Map(entries.map((file) => [file.name, new Blob([file.data])])),
        },
        "@/services/image-storage": { getImageBlob: async (key) => key === "image:good" ? new Blob(["image"], { type: "image/png" }) : null },
        "@/services/file-storage": { getMediaBlob: async () => { throw new Error("media read failed"); } },
    };
    const source = readFileSync(new URL("../src/pages/assets/asset-transfer.ts", import.meta.url), "utf8");
    const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true, target: ts.ScriptTarget.ES2022 } }).outputText;
    const module = { exports: {} };
    new Function("require", "module", "exports", code)((id) => { assert.ok(id in mocks); return mocks[id]; }, module, module.exports);
    return { ...module.exports, downloads, entries: () => entries };
}
const assets = [
    { kind: "image", data: { storageKey: "image:good" } },
    { kind: "image", data: { storageKey: "image:missing" } },
    { kind: "video", data: { storageKey: "video:unreadable" } },
];

test("normal export refuses missing media before triggering a download", async () => {
    const f = fixture();
    await assert.rejects(f.exportAssets(assets, "normal.zip"));
    assert.deepEqual(f.downloads, []);
    assert.equal(f.entries(), undefined);
});

test("rescue export preserves the in-memory list, available files and explicit missing/read-error records", async () => {
    const f = fixture();
    await f.exportAssets(assets, "rescue.zip", true);
    assert.deepEqual(f.downloads, ["rescue.zip"]);
    const entries = f.entries();
    const manifest = JSON.parse(entries.find((file) => file.name === "assets.json").data);
    assert.deepEqual(manifest.assets, assets);
    assert.equal(manifest.files.length, 1);
    assert.equal(manifest.files[0].storageKey, "image:good");
    assert.deepEqual(manifest.rescue.unavailableFiles.map((file) => file.storageKey).sort(), ["image:missing", "video:unreadable"]);
    assert.ok(entries.some((file) => file.name === "抢救说明.txt"));
    await assert.rejects(f.readAssetPackage(new File([], "rescue.zip")), /抢救包包含未恢复/);
});
