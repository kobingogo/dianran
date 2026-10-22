import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";

const ts = createRequire(import.meta.url)("typescript");
function fixture() {
    const empty = () => ({ initialized: true, prompt: "", references: [], canvas: false });
    const calls = { confirmations: [], messages: [], errors: [], routes: [], events: [], patches: [] };
    const state = { hydrated: true, image: empty(), video: empty(), mode: "image", patch: (mode, patch) => { calls.patches.push({ mode, patch }); state[mode] = { ...state[mode], ...patch }; }, setMode: (mode) => { state.mode = mode; } };
    let save = async () => {};
    const dependencies = {
        antd: { App: { useApp: () => ({ modal: { confirm: (options) => calls.confirmations.push(options) }, message: { info: (text) => calls.messages.push(text) } }) } },
        "@/stores/use-composer-store": { useComposerStore: { getState: () => state }, flushComposerSave: () => save() },
        "react-router-dom": { useNavigate: () => (route) => calls.routes.push(route) },
        "@/features/errors/error-toast": { showErrorToast: (_message, error) => calls.errors.push(error) },
    };
    const load = (file) => {
        const module = { exports: {} };
        const source = ts.transpileModule(readFileSync(new URL(`../src/hooks/${file}.ts`, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
        vm.runInNewContext(source, { exports: module.exports, require: (name) => { if (!(name in dependencies)) throw Error(`Unexpected dependency: ${name}`); return dependencies[name]; }, window: { dispatchEvent: (event) => calls.events.push(event) }, CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } } });
        return module.exports;
    };
    const reuse = load("use-reuse-creation").useReuseCreation;
    dependencies["@/hooks/use-reuse-creation"] = { useReuseCreation: reuse };
    return { state, calls, reuse: reuse(), open: load("use-open-creation-draft").useOpenCreationDraft(), save: (fn) => { save = fn; } };
}

test("unread drafts cannot be replaced or opened", async () => {
    const f = fixture();
    f.state.hydrated = false;
    assert.equal(await f.open("image", { prompt: "new", references: [] }), false);
    assert.equal(f.calls.patches.length, 0);
    assert.equal(f.calls.routes.length, 0);
});

test("cancelling replacement preserves the existing prompt and references", async () => {
    const f = fixture();
    f.state.image = { ...f.state.image, prompt: "original", references: [{ id: "original" }] };
    const original = f.state.image;
    const pending = f.open("image", { prompt: "new", references: [] });
    f.calls.confirmations[0].onCancel();
    assert.equal(await pending, false);
    assert.equal(f.state.image, original);
    assert.equal(f.calls.routes.length, 0);
});

test("accepting a stale confirmation cannot overwrite edits made while it was open", async () => {
    const f = fixture();
    f.state.image = { ...f.state.image, prompt: "original" };
    const pending = f.reuse("image", { prompt: "new" });
    f.state.image = { ...f.state.image, prompt: "edited during confirmation" };
    f.calls.confirmations[0].onOk();
    assert.equal(await pending, false);
    assert.equal(f.state.image.prompt, "edited during confirmation");
    assert.equal(f.calls.patches.length, 0);
});

test("accepted draft is saved before navigation and does not touch the other mode", async () => {
    const f = fixture();
    f.state.image = { ...f.state.image, prompt: "keep image" };
    let saved;
    let started;
    const saving = new Promise((resolve) => { started = resolve; });
    f.save(() => { started(); return new Promise((resolve) => { saved = resolve; }); });
    const pending = f.open("video", { prompt: "video prompt", references: [{ id: "selected-result", dataUrl: "blob:selected" }] });
    await saving;
    assert.equal(f.calls.routes.length, 0);
    saved();
    assert.equal(await pending, true);
    assert.equal(f.state.mode, "video");
    assert.equal(f.state.image.prompt, "keep image");
    assert.equal(f.state.video.prompt, "video prompt");
    assert.equal(f.state.video.references[0].id, "selected-result");
    assert.equal(f.state.video.canvas, false);
    assert.equal(f.state.video.nodeIds.length, 0);
    assert.deepEqual(f.calls.routes, ["/video"]);
    assert.equal(f.calls.events[0].detail, "video");
});

test("save failure retains the prepared draft and prevents navigation", async () => {
    const f = fixture();
    f.save(async () => { throw Error("storage unavailable"); });
    assert.equal(await f.open("image", { prompt: "recoverable draft", references: [] }), false);
    assert.equal(f.state.image.prompt, "recoverable draft");
    assert.equal(f.calls.errors.length, 1);
    assert.equal(f.calls.routes.length, 0);
    assert.equal(f.calls.events.length, 0);
});
