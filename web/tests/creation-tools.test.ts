import "./browser-storage";
import { expect, test } from "bun:test";
const { defaultConfig } = await import("../src/stores/use-config-store");
const { presetParameters, applyCreationPreset } = await import("../src/lib/creation-preferences");
const { createComposerSubmission } = await import("../src/lib/composer");
const { conditionKey, workflowEstimateCondition, estimateCondition, estimateCreation, validateQuote } = await import("../src/lib/creation-estimates");
const { archivePlan } = await import("../src/lib/canvas/workflow-archive");
const { planWorkflow, instantiateWorkflow } = await import("../src/lib/canvas/workflow");
const { CanvasNodeType } = await import("../src/types/canvas");
const config = {
    ...defaultConfig,
    apiKey: "secret",
    count: "3",
    channels: [{ id: "mock", name: "mock", baseUrl: "https://mock.example/v1", apiKey: "secret", apiFormat: "openai" as const, models: [{ name: "gpt-image-1", capability: "image" as const }] }],
    imageModel: "mock::gpt-image-1",
};
test("presets are mode-specific and revalidate against retained model without credentials", () => {
    const parameters = presetParameters(config, "image");
    expect(JSON.stringify(parameters)).not.toContain("secret");
    expect(parameters.videoSize).toBeUndefined();
    const preset = { id: "p", title: "p", mode: "image" as const, parameters: { ...parameters, count: "99" } };
    const applied = applyCreationPreset(preset, { ...config, imageModel: "gpt-image-1", videoSize: "1920x1080" }, true, 10);
    expect(applied.config.imageModel).toBe("gpt-image-1");
    expect(applied.config.count).toBe("10");
    expect(applied.config.videoSize).toBe("1920x1080");
    expect(applied.config.apiKey).toBe("secret");
});
test("quotes require matching channel, parameters and references; count changes cost but not unit rate", () => {
    const condition = estimateCondition(config, createComposerSubmission("image", "图", [], config));
    const quotes = [{ id: "q", condition, amount: 0.2, currency: "CNY", unit: "output" as const, source: "用户合同报价", recordedAt: 1 }];
    const samples = [1000, 3000].map((durationMs, index) => ({ id: String(index), condition, durationMs, recordedAt: 1 }));
    expect(estimateCreation(condition, quotes, samples).amount).toBeCloseTo(0.6);
    expect(estimateCreation(condition, quotes, samples).durationMs).toBe(2000);
    expect(estimateCreation({ ...condition, calls: 1 }, quotes, samples).amount).toBe(0.2);
    expect(estimateCreation({ ...condition, calls: 1 }, quotes, samples).durationMs).toBeUndefined();
    expect(estimateCreation({ ...condition, endpoint: "https://other.example" }, quotes, samples).amount).toBeUndefined();
    expect(estimateCreation({ ...condition, actual: { size: "different" } }, quotes, samples).amount).toBeUndefined();
    expect(estimateCreation({ ...condition, references: 1 }, quotes, samples).amount).toBeUndefined();
    expect(conditionKey({ ...condition, actual: { a: 1, b: 2 } })).toBe(conditionKey({ ...condition, actual: { b: 2, a: 1 } }));
    expect(() => validateQuote(NaN, "CNY", "source", "output", condition)).toThrow();
    expect(() => validateQuote(1, "CNY", "", "output", condition)).toThrow();
    expect(() => validateQuote(1, "CNY", "source", "second", condition)).toThrow();
});
test("video quotes use actual seconds and never fabricate missing duration", () => {
    const condition = { mode: "video" as const, model: "veo", endpoint: "e", apiFormat: "gemini", actual: { durationSeconds: 8 }, references: 0, videos: 0, audios: 0, calls: 1 };
    const quotes = [{ id: "q", condition, amount: 2, currency: "USD", unit: "second" as const, source: "合同", recordedAt: 1 }];
    expect(estimateCreation(condition, quotes, []).amount).toBe(16);
    const noSeconds = { ...condition, actual: {} };
    expect(estimateCreation(noSeconds, [{ ...quotes[0], condition: noSeconds }], []).amount).toBeUndefined();
});
test("portable template accepts only data, rejects cycles/missing inputs and instantiates independent IDs", () => {
    const node = { id: "c", type: CanvasNodeType.Config, title: "配置", position: { x: 0, y: 0 }, width: 300, height: 200, metadata: { prompt: "春山", generationMode: "image" as const, model: config.imageModel } };
    const plan = planWorkflow([node], [], [node.id], config);
    const injected = structuredClone(plan);
    Object.assign(injected.steps[0].parameters, { apiKey: "secret", callScript: "evil" });
    const clean = archivePlan(injected);
    expect(JSON.stringify(clean)).not.toContain("secret");
    expect(JSON.stringify(clean)).not.toContain("evil");
    const sameFile = { ...node, id: "material-a", type: CanvasNodeType.Image, metadata: { content: "blob:material", storageKey: "image:shared" } };
    const duplicate = { ...sameFile, id: "material-b" };
    const withResources = { ...clean, resources: [sameFile, duplicate], steps: [{ ...clean.steps[0], inputs: [{ nodeId: "material-a" }, { nodeId: "material-b" }] }] };
    expect(workflowEstimateCondition(withResources.steps[0], withResources, config).references).toBe(1);
    expect(instantiateWorkflow(clean).nodes[0].id).not.toBe(instantiateWorkflow(clean).nodes[0].id);
    const cyclic = structuredClone(plan);
    cyclic.steps[0].inputs = [{ nodeId: "c", stepId: "c" }];
    expect(() => archivePlan(cyclic)).toThrow("循环");
    const missing = structuredClone(plan);
    missing.steps[0].inputs = [{ nodeId: "gone" }];
    expect(() => archivePlan(missing)).toThrow("缺失");
});
