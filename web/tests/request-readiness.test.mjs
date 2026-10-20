import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { webcrypto } from "node:crypto";
const require = createRequire(import.meta.url), ts = require("typescript");
function load(path, mocks = {}, globals = {}) {
    const code = ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
    const module = { exports: {} };
    new Function("require", "module", "exports", ...Object.keys(globals), code)((id) => { assert.ok(id in mocks, `unexpected import ${id}`); return mocks[id]; }, module, module.exports, ...Object.values(globals));
    return module.exports;
}
const diagnostics = { recordLocalDiagnostic: async () => {} };
const outcomes = load("../src/lib/generation-outcome.ts", { "@/stores/use-local-diagnostics-store": diagnostics });
test("lost response, server timeout and stopping local wait remain unknown, explicit 4xx refusal is distinct", () => {
    for (const error of [new TypeError("Failed to fetch"), new DOMException("Aborted", "AbortError"), { response: { status: 408 } }, { response: { status: 502 } }]) {
        assert.equal(outcomes.requestOutcome(error), "unknown");
        assert.match(outcomes.generationError(error, "响应丢失").message, /可能再次计费/);
    }
    for (const status of [400, 401, 403, 429]) { assert.equal(outcomes.requestOutcome({ response: { status } }), "rejected"); assert.equal(outcomes.requestOutcome({ status }), "rejected"); }
    const wrapped = outcomes.generationError({ response: { status: 403 } }, "Key 错误");
    assert.equal(outcomes.generationError(wrapped, "另一次包装"), wrapped);
    assert.match(wrapped.message, /明确拒绝/);
});
function evidenceFixture() {
    const db = new Map(); let fail = false, writer = true;
    const modelName = (model) => model.split("::").at(-1);
    const configHelpers = { modelOptionName: modelName, resolveModelChannel: (config, model) => config.channels.find((channel) => channel.id === model.split("::")[0]) || config.channels[0], modelCapabilityOf: (config, model) => config.channels.find((channel) => channel.id === model.split("::")[0])?.models.find((entry) => entry.name === modelName(model))?.capability };
    const channel = { id: "first", baseUrl: "https://api.example/v1", apiKey: "private-key", apiFormat: "openai", models: [{ name: "image", capability: "image" }, { name: "text", capability: "text" }] };
    const config = { ...channel, channels: [channel] };
    const storage = { getItem: async (key) => db.get(key), setItem: async (key, value) => { if (fail) throw new Error("disk full"); db.set(key, structuredClone(value)); } };
    const evidence = load("../src/stores/use-capability-evidence-store.ts", { "@/lib/canvas/save-queue": load("../src/lib/canvas/save-queue.ts"), "@/stores/use-local-diagnostics-store": diagnostics, react: require("react"), zustand: require("zustand"), localforage: { createInstance: () => storage }, "@/constant/brand": { STORAGE_NS: "test", storageKey: (key) => key }, "@/lib/write-ownership": { assertBusinessWriter: () => { if (!writer) throw new Error("readonly"); } }, "@/stores/use-config-store": configHelpers }, { crypto: webcrypto });
    return { evidence, db, config, channel, fail: () => { fail = true; }, readonly: () => { writer = false; } };
}
test("capability readiness rejects placeholder and text-only models; successful evidence is scoped to model/channel/key", async () => {
    const f = evidenceFixture();
    assert.equal(f.evidence.capabilityReadiness(f.config, "image", "first::text").ready, false);
    assert.equal(f.evidence.capabilityReadiness(f.config, "image", "default-image").ready, false);
    assert.equal(f.evidence.capabilityReadiness(f.config, "image", "first::image").stage, "configured");
    await f.evidence.observeGeneration(f.config, "image", "first::image", async () => "actual result");
    const key = await f.evidence.capabilityIdentity(f.config, "image", "first::image");
    assert.ok(f.evidence.useCapabilityEvidenceStore.getState().records[key].succeededAt);
    for (const [config, model] of [[f.config, "first::text"], [{ ...f.config, channels: [{ ...f.channel, apiKey: "new-key" }] }, "first::image"], [{ ...f.config, channels: [{ ...f.channel, id: "second" }] }, "second::image"]]) assert.notEqual(await f.evidence.capabilityIdentity(config, "image", model), key);
    assert.ok(!JSON.stringify([...f.db.values()]).includes("private-key"));
    const value = await f.evidence.observeGeneration(f.config, "text", "first::text", async () => "text");
    assert.equal(value, "text");
});
test("parallel success records survive reload, model reads do not claim generation success, persistence failure cannot fail paid result", async () => {
    const f = evidenceFixture();
    await Promise.all([f.evidence.observeGeneration(f.config, "image", "first::image", async () => "image"), f.evidence.observeGeneration(f.config, "text", "first::text", async () => "text")]);
    await f.evidence.recordCapabilityEvidence(f.channel, "models", "");
    await f.evidence.flushCapabilityEvidence();
    await f.evidence.reloadCapabilityEvidence();
    assert.equal(Object.keys(f.evidence.useCapabilityEvidenceStore.getState().records).length, 3);
    const modelsKey = await f.evidence.capabilityIdentity(f.channel, "models");
    assert.equal(f.evidence.useCapabilityEvidenceStore.getState().records[modelsKey].succeededAt, undefined);
    f.fail();
    assert.equal(await f.evidence.observeGeneration(f.config, "image", "first::image", async () => "paid image already returned"), "paid image already returned");
    assert.match(f.evidence.useCapabilityEvidenceStore.getState().error, /尚未保存/);
    await assert.rejects(f.evidence.flushCapabilityEvidence(), /disk full/);
    f.readonly(); await assert.rejects(f.evidence.recordCapabilityEvidence(f.channel, "models", ""), /readonly/);
});
test("failed creative call preserves failure evidence and never manufactures a first success", async () => {
    const f = evidenceFixture();
    await assert.rejects(f.evidence.observeGeneration(f.config, "image", "first::image", async () => { throw outcomes.generationError({ response: { status: 401 } }, "Key 错误"); }), /明确拒绝/);
    const key = await f.evidence.capabilityIdentity(f.config, "image", "first::image");
    assert.equal(f.evidence.useCapabilityEvidenceStore.getState().records[key].succeededAt, undefined);
    assert.match(f.evidence.useCapabilityEvidenceStore.getState().records[key].error, /Key/);
});
function videoFixture() {
    const calls = []; let createResult = { id: "original-remote-task", status: "queued" }, pollResult = { id: "original-remote-task", status: "queued" };
    const axios = { post: async (url, body) => { calls.push({ method: "POST", url, body }); if (createResult instanceof Error || createResult.response) throw createResult; return { data: createResult }; }, get: async (url) => { calls.push({ method: "GET", url }); return { data: pollResult }; }, isCancel: () => false, isAxiosError: (error) => Boolean(error?.response) };
    const config = { model: "first::video", videoModel: "first::video", baseUrl: "https://api.example/v1", apiKey: "key", apiFormat: "openai", channels: [{ id: "first", models: [{ name: "video" }] }] };
    const video = load("../src/services/api/video.ts", { axios, nanoid: { nanoid: () => "local-id" }, "@/lib/generation-outcome": outcomes, "@/stores/use-capability-evidence-store": { observeGeneration: (_config, _cap, _model, run) => run() }, "@/services/api/proxy-transport": { proxyFetch: fetch }, "@/lib/write-ownership": { businessOperation: (fn) => fn }, "@/i18n": { t: (key) => key }, "@/lib/image-utils": {}, "@/lib/model-capabilities": { planVideoRequest: () => ({ caps: { paramStyle: "openai-sora" }, fields: {}, seconds: 4 }) }, "@/services/file-storage": {}, "@/services/image-storage": {}, "@/stores/use-config-store": { resolveModelRequestConfig: (value, model) => ({ ...value, model: model.split("::").at(-1) }), decodeChannelModel: (value) => value.includes("::") ? { channelId: value.split("::")[0], model: value.split("::")[1] } : undefined, resolveModelScript: () => "", modelOptionName: (model) => model.split("::").at(-1), buildApiUrl: (base, path) => base + path, boolConfig: (_value, fallback) => fallback, resolveVideoSize: () => "1280x720", withLocalProxy: (url) => url }, "./model-plugin": {} });
    return { video, config, calls, create: (value) => { createResult = value; }, poll: (value) => { pollResult = value; } };
}
test("video creation preserves remote identity; polling never submits again and cannot move to another channel", async () => {
    const f = videoFixture(), task = await f.video.createVideoGenerationTask(f.config, "prompt");
    assert.equal(task.id, "original-remote-task"); assert.equal(task.model, "first::video"); assert.equal(task.endpoint, f.config.baseUrl);
    assert.deepEqual(await f.video.pollVideoGenerationTask(f.config, task), { status: "pending" });
    assert.equal(f.calls.filter((call) => call.method === "POST").length, 1);
    await assert.rejects(f.video.pollVideoGenerationTask({ ...f.config, baseUrl: "https://other.example/v1" }, task), /渠道地址已改变/);
    await assert.rejects(f.video.pollVideoGenerationTask({ ...f.config, channels: [] }, task), /原任务所属渠道/);
    assert.equal(f.calls.length, 2);
});
test("video response loss and accepted response without ID remain unknown; explicit denial remains rejected", async () => {
    const f = videoFixture();
    for (const response of [new TypeError("response lost"), { status: "queued" }, { response: { status: 502 } }]) {
        f.create(response); await assert.rejects(f.video.createVideoGenerationTask(f.config, "prompt"), (error) => error.outcome === "unknown");
    }
    f.create({ response: { status: 403, data: { error: { message: "denied" } } } });
    await assert.rejects(f.video.createVideoGenerationTask(f.config, "prompt"), (error) => error.outcome === "rejected");
});

const receipts = load("../src/lib/video-task-receipt.ts");
test("remote ID receipt failure keeps the exact task recoverable and does not proceed to polling or resubmission", async () => {
    const task = { id: "accepted-remote-id", model: "first::video", provider: "openai", endpoint: "https://api.example/v1" };
    let polls = 0;
    await assert.rejects(async () => { await receipts.persistVideoTask(task, async () => { throw new Error("storage denied"); }); polls++; }, (error) => error.task === task && error.outcome === "unknown" && /accepted-remote-id/.test(error.message));
    assert.equal(polls, 0);
    await receipts.persistVideoTask(task, async () => "actual write receipt");
});

function trackerFixture(pathname = "/") {
    const state = { tasks: [], add(task) { this.tasks.unshift(task); }, update(id, patch) { const task = this.tasks.find((item) => item.id === id); Object.assign(task, patch); } };
    const window = { location: { href: `http://localhost:3001${pathname}`, origin: "http://localhost:3001", pathname }, setInterval() {}, fetch: async () => { throw new TypeError("response lost"); } };
    class XMLHttpRequest { open() {} send() {} }
    const tracker = load("../src/features/tasks/request-tracker.ts", { nanoid: { nanoid: () => String(state.tasks.length + 1) }, "./task-store": { useTaskStore: { getState: () => state } } }, { window, XMLHttpRequest });
    return { tracker, window, state };
}
test("request tracker labels network loss unknown rather than refusal; video success without query identity remains unknown", async () => {
    const lost = trackerFixture(); lost.tracker.installRequestTracker();
    await assert.rejects(lost.window.fetch("https://api.example/v1/images/generations", { method: "POST", body: JSON.stringify({ model: "image" }) }), /response lost/);
    assert.equal(lost.state.tasks[0].phase, "unknown");
    assert.equal(lost.state.tasks[0].sourcePath, "/");
    const rejected = trackerFixture(); rejected.window.fetch = async () => Response.json({ error: { message: "invalid key" } }, { status: 401 }); rejected.tracker.installRequestTracker();
    await rejected.window.fetch("https://api.example/v1/images/generations", { method: "POST" });
    assert.equal(rejected.state.tasks[0].phase, "failed");
    const noId = trackerFixture(); noId.window.fetch = async () => Response.json({ status: "queued" }); noId.tracker.installRequestTracker();
    await noId.window.fetch("https://api.example/v1/videos", { method: "POST" });
    assert.equal(noId.state.tasks[0].phase, "unknown");
    assert.equal(noId.state.tasks.length, 1);
    const canvas = trackerFixture("/canvas/project-1"); canvas.tracker.installRequestTracker();
    await assert.rejects(canvas.window.fetch("https://api.example/v1/images/generations", { method: "POST" }));
    assert.equal(canvas.state.tasks[0].sourcePath, "/canvas/project-1");
    const unrelated = trackerFixture("/admin/keys"); unrelated.tracker.installRequestTracker();
    await assert.rejects(unrelated.window.fetch("https://api.example/v1/images/generations", { method: "POST" }));
    assert.equal(unrelated.state.tasks[0].sourcePath, undefined);
});

test("pre-submission validation and missing references do not imply remote acceptance or channel refusal", async () => {
    const rejectedBeforeNetwork = outcomes.generationError({ outcome: "not-submitted" }, "本地代理未授权");
    assert.match(rejectedBeforeNetwork.message, /尚未发送/); assert.doesNotMatch(rejectedBeforeNetwork.message, /渠道明确拒绝|可能已被渠道接受/);
    await assert.rejects(outcomes.prepareGenerationInput(async () => { throw new Error("原引用文件缺失"); }), (error) => error.outcome === "not-submitted");
    const f = videoFixture(); f.config.apiKey = "";
    await assert.rejects(f.video.createVideoGenerationTask(f.config, "prompt"), (error) => error.outcome === "not-submitted");
    assert.equal(f.calls.length, 0);
});
