import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const ts = createRequire(import.meta.url)("typescript");
const source = (path) => readFileSync(new URL(`../src/${path}.ts`, import.meta.url), "utf8");
function load(code, mocks = {}) {
    const module = { exports: {} };
    const js = ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
    new Function("require", "module", "exports", js)((id) => { assert.ok(id in mocks, `Unexpected dependency: ${id}`); return mocks[id]; }, module, module.exports);
    return module.exports;
}
const brand = load(source("constant/brand").replace("import.meta.env", "{}"));
const configSource = ts.createSourceFile("config.ts", source("stores/use-config-store"), ts.ScriptTarget.Latest, true);
const helpers = load(configSource.statements.filter((node) => node.name?.text === "guessCapability" || node.declarationList?.declarations.some((item) => ["VIDEO_KEYWORDS", "AUDIO_KEYWORDS", "IMAGE_KEYWORDS"].includes(item.name.text))).map((node) => node.getText(configSource)).join("\n"));
const defaults = load(source("features/onboarding/model-defaults"), { "@/stores/use-config-store": helpers });

test("WhatsToken recommendations select defaults without restricting fetched models", () => {
    const preset = brand.PRESET_PROVIDERS.find((item) => item.id === "whatstoken");
    assert.equal(preset.baseUrl, "https://www.whatstoken.ai/v1");
    const built = defaults.buildChannelModels(["gpt-image-2-official", "wan3.0-video", "flux-image-new", "wan3.0-video-prime", "gpt-5.5"], preset);
    assert.equal(built.defaults.image, "gpt-image-2-official");
    assert.equal(built.defaults.video, "wan3.0-video");
    assert.ok(built.models.some((model) => model.name === "flux-image-new" && model.capability === "image"));
    assert.ok(built.models.some((model) => model.name === "wan3.0-video-prime" && model.capability === "video"));
    assert.equal(brand.presetApiFlags("https://www.whatstoken.ai.evil.test/v1").videoApi, undefined);
    assert.equal(defaults.buildChannelModels(["flux-image-new"], preset).defaults.image, "flux-image-new");
});

function fixture(model = "wan3.0-video") {
    const calls = [], responses = [];
    const axios = {
        post: async (...args) => { calls.push({ method: "POST", args }); return { data: responses.shift() }; },
        get: async (...args) => { calls.push({ method: "GET", args }); return { data: responses.shift() }; },
        isCancel: () => false, isAxiosError: () => false,
    };
    const outcomes = load(source("lib/generation-outcome"), { "@/stores/use-local-diagnostics-store": { recordLocalDiagnostic() {} } });
    const config = { baseUrl: "https://www.whatstoken.ai/v1", apiKey: "fixture-only-token", model, videoModel: model, apiFormat: "openai", channels: [], videoMode: "frames" };
    const api = load(source("services/api/video"), {
        "@/constant/brand": brand, "@/lib/generation-outcome": outcomes,
        "@/stores/use-capability-evidence-store": {}, "@/services/api/proxy-transport": {},
        "@/lib/write-ownership": { businessOperation: (fn) => fn }, axios, nanoid: {}, "@/i18n": { t: (key) => key },
        "@/lib/image-utils": {}, "@/lib/model-capabilities": { planVideoRequest: () => ({ resolution: "720p", ratio: "16:9", seconds: 5, fields: { seconds: 5 }, caps: { paramStyle: "openai-sora" } }) },
        "@/services/file-storage": {}, "@/services/image-storage": { imageToDataUrl: async (image) => { if (!image.dataUrl) throw Error("missing image"); return image.dataUrl; } },
        "@/stores/use-config-store": { resolveModelRequestConfig: (value, selected) => ({ ...value, model: selected.split("::").at(-1) }), resolveModelScript: () => "", modelOptionName: (value) => value.split("::").at(-1), decodeChannelModel: (value) => value.includes("::") ? { channelId: value.split("::")[0], model: value.split("::")[1] } : null, buildApiUrl: (base, path) => base + path, withLocalProxy: (url) => url, resolveVideoSize: () => "1280x720", boolConfig: (_value, fallback) => fallback },
        "./model-plugin": {},
    });
    return { api, config, calls, responses };
}

test("Wan submits JSON once, retains task identity and polls its documented endpoint", async () => {
    const f = fixture();
    f.responses.push({ task_id: "original/id", status: "pending" }, { status: "pending" }, { status: "completed", data: [{ url: "https://cdn.example/result.mp4" }] }, new Blob(["video"], { type: "video/mp4" }));
    const task = await f.api.createVideoGenerationTask(f.config, "陶瓷杯缓慢旋转");
    assert.equal(task.endpoint, f.config.baseUrl);
    assert.equal(task.id, "original/id");
    assert.deepEqual(f.calls[0].args[1], { model: "wan3.0-video", prompt: "陶瓷杯缓慢旋转", resolution: "720P", ratio: "16:9", duration: 5 });
    assert.equal(f.calls[0].args[0], f.config.baseUrl + "/video/generations");
    assert.equal(f.calls[0].args[2].headers.Authorization, "Bearer fixture-only-token");
    assert.equal(f.calls[0].args[2].headers["Content-Type"], "application/json");
    assert.equal((await f.api.pollVideoGenerationTask(f.config, task)).status, "pending");
    const completed = await f.api.pollVideoGenerationTask(f.config, task);
    assert.equal(completed.status, "completed");
    assert.equal(completed.result.blob.type, "video/mp4");
    assert.equal(f.calls[1].args[0], f.config.baseUrl + "/video/generations/original%2Fid");
    assert.equal(f.calls.at(-1).args[1].headers, undefined, "CDN receives no channel credential");
    assert.equal(f.calls.filter((call) => call.method === "POST").length, 1);
});

test("failed or incomplete Wan results never become completed or trigger another create", async () => {
    const f = fixture(), task = { id: "task", provider: "openai", model: f.config.model, endpoint: f.config.baseUrl };
    f.responses.push({ status: "failed", error: { message: "渠道拒绝" }, data: [{ url: "https://cdn.example/result.mp4" }] }, { status: "completed", data: [] });
    assert.deepEqual(await f.api.pollVideoGenerationTask(f.config, task), { status: "failed", error: "渠道拒绝" });
    assert.equal((await f.api.pollVideoGenerationTask(f.config, task)).status, "failed");
    assert.equal(f.calls.length, 2);
    assert.ok(f.calls.every((call) => call.method === "GET"));
});

test("Wan reference roles are explicit and invalid inputs stop before submission", async () => {
    const f = fixture(), refs = [0, 1].map((id) => ({ id: String(id), dataUrl: "data:image/png;base64,fixture" }));
    f.responses.push({ id: "frames" }, { id: "reference" });
    await f.api.createVideoGenerationTask(f.config, "首尾帧", refs);
    assert.deepEqual(f.calls[0].args[1].images.map((image) => image.role), ["first_frame", "last_frame"]);
    f.config.videoMode = "reference";
    await f.api.createVideoGenerationTask(f.config, "参考", refs, { videos: [{ url: "https://cdn.example/ref.mp4" }] });
    assert.deepEqual(f.calls[1].args[1].images.map((image) => image.role), ["reference_image", "reference_image"]);
    const notSubmitted = (error) => error.outcome === "not-submitted";
    await assert.rejects(f.api.createVideoGenerationTask(f.config, "local", [], { videos: [{ url: "blob:local" }] }), notSubmitted);
    await assert.rejects(f.api.createVideoGenerationTask(f.config, "audio", [], { audios: [{ url: "https://cdn.example/ref.mp3" }] }), notSubmitted);
    await assert.rejects(f.api.createVideoGenerationTask(f.config, "missing", [{ id: "lost" }]), notSubmitted);
    f.config.videoMode = "frames";
    await assert.rejects(f.api.createVideoGenerationTask(f.config, "mixed", refs, { videos: [{ url: "https://cdn.example/ref.mp4" }] }), notSubmitted);
    assert.equal(f.calls.length, 2);
});

test("Wan tasks cannot move to another endpoint or a removed channel", async () => {
    const f = fixture();
    await assert.rejects(f.api.pollVideoGenerationTask(f.config, { id: "task", model: f.config.model, provider: "openai", endpoint: "https://other.example/v1" }), /地址已改变/);
    await assert.rejects(f.api.pollVideoGenerationTask(f.config, { id: "task", model: "removed::wan3.0-video", provider: "openai", endpoint: f.config.baseUrl }), /已移除/);
    assert.equal(f.calls.length, 0);
});

test("other selectable video models retain the existing multipart route", async () => {
    const f = fixture("sora-2");
    f.responses.push({ id: "sora-task" });
    await f.api.createVideoGenerationTask(f.config, "text video");
    assert.equal(f.calls[0].args[0], f.config.baseUrl + "/videos");
    assert.ok(f.calls[0].args[1] instanceof FormData);
    assert.equal(f.calls[0].args[1].get("model"), "sora-2");
});
