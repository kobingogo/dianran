import { test } from "node:test";
import assert from "node:assert/strict";
import { readMediaReferences } from "../src/lib/media-references.ts";

const ref = (storageKey: string) => ({ storageKey });
const persisted = (state: unknown) => JSON.stringify({ state, version: 0 });

function fixture() {
    const state = new Map<string, unknown>([
        ["asset_store", persisted({ assets: [ref("video:asset-on-disk")] })],
        ["canvas_store", persisted({ projects: [{ workflowRuns: [{ resourceSnapshot: [ref("audio:run-snapshot")] }] }] })],
        ["composer_drafts", persisted({ image: { references: [ref("image:draft")] }, video: {}, scoped: { canvas: { references: [ref("video:scoped-draft")] } } })],
        ["workflow_templates", [{ plan: { resources: [ref("audio:template")] } }]],
    ]);
    const logs = new Map<string, unknown[]>([
        ["image_generation_logs", [{ references: [ref("image:history-reference")], images: [ref("image:history-result")] }]],
        ["video_generation_logs", [{ references: [], video: ref("video:history-only") }]],
    ]);
    const scan = () => readMediaReferences({ currentProject: ref("video:unsaved-project") }, async (name) => state.get(name) ?? null, async (name) => logs.get(name)!);
    return { state, logs, scan };
}

test("cleanup retains video history, persisted assets, drafts, templates and run snapshots", async () => {
    const { scan } = fixture();
    const keys = await scan();
    for (const key of ["video:history-only", "video:asset-on-disk", "video:unsaved-project", "audio:run-snapshot", "image:draft", "video:scoped-draft", "audio:template", "image:history-reference", "image:history-result"]) assert.ok(keys.has(key), key);
    assert.equal(keys.has("video:unreferenced"), false);
});

test("a failed asset deletion still protects the old persisted file", async () => {
    const { state, scan } = fixture();
    assert.ok((await scan()).has("video:asset-on-disk"));
    state.set("asset_store", persisted({ assets: [] }));
    assert.equal((await scan()).has("video:asset-on-disk"), false);
});

for (const name of ["asset_store", "canvas_store", "composer_drafts", "workflow_templates"]) {
    test(`corrupt ${name} stops cleanup`, async () => {
        const { state, scan } = fixture();
        state.set(name, name === "workflow_templates" ? {} : persisted({}));
        await assert.rejects(scan(), /已停止清理/);
    });
}

test("unreadable state or history rejects rather than producing an empty keep-list", async () => {
    await assert.rejects(readMediaReferences({}, async () => { throw new Error("IndexedDB read failed"); }, async () => []), /IndexedDB read failed/);
    await assert.rejects(readMediaReferences({}, async () => null, async () => { throw new Error("history read failed"); }), /history read failed/);
});

test("malformed history stops cleanup, while genuinely empty stores are allowed", async () => {
    const { logs, scan } = fixture();
    logs.set("video_generation_logs", [null]);
    await assert.rejects(scan(), /已停止清理/);
    assert.equal((await readMediaReferences({}, async () => null, async () => [])).size, 0);
});
