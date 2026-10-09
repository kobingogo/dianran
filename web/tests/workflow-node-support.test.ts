import "./browser-storage";
import { expect, test } from "bun:test";
import { defaultConfig, type AiConfig } from "../src/stores/use-config-store";
import { CanvasNodeType, type CanvasNodeData, type CanvasGenerationMode } from "../src/types/canvas";
import { planWorkflow, prepareWorkflowStep, instantiateWorkflow, workflowResults, reconcileWorkflow, createWorkflowRun } from "../src/lib/canvas/workflow";
import { archivePlan } from "../src/lib/canvas/workflow-archive";
import { agentWorkflowPlan } from "../src/lib/canvas/agent-workflow-plan";
import { buildGenerationConfig } from "../src/lib/canvas/canvas-generation-helpers";
import { resultProvenance } from "../src/lib/canvas/canvas-composer";
import { workflowEstimateCondition, workflowStepEstimateCondition, conditionKey } from "../src/lib/creation-estimates";
import { registerNodeDefinitions, unregisterPluginNodes } from "../src/lib/canvas/node-registry";

const config: AiConfig = {
    ...defaultConfig, apiKey: "secret", systemPrompt: "只输出正文", reasoningEffort: "high", audioVoice: "nova", audioSpeed: "1.25",
    imageModel: "mock::image", videoModel: "mock::video", textModel: "mock::text", audioModel: "mock::audio",
    channels: [{ id: "mock", name: "mock", baseUrl: "https://mock.example/v1", apiKey: "secret", apiFormat: "openai", models: ["image", "video", "text", "audio"].map((mode) => ({ name: mode, capability: mode as CanvasGenerationMode })) }],
};
const node = (id: string, type: CanvasNodeData["type"], metadata: CanvasNodeData["metadata"]): CanvasNodeData => ({ id, type, title: id, metadata, position: { x: 0, y: 0 }, width: 200, height: 200 });
const step = (id: string, mode: CanvasGenerationMode, prompt = id) => node(id, CanvasNodeType.Config, { generationMode: mode, count: 1, prompt, composerContent: prompt });
const link = (fromNodeId: string, toNodeId: string) => ({ id: `${fromNodeId}:${toNodeId}`, fromNodeId, toNodeId, kind: "input" as const });

test("mixed plans distinguish text from images and count text alternatives without leaking credentials", () => {
    const nodes = [step("story", "text"), step("image", "image"), step("speech", "audio"), step("video", "video")];
    nodes[0].metadata!.textCount = 3;
    const plan = planWorkflow(nodes, [link("story", "image"), link("story", "speech"), link("image", "video"), link("speech", "video")], nodes.map((node) => node.id), config);
    expect(plan.steps.map((step) => [step.mode, step.calls])).toEqual([["text", 3], ["image", 1], ["audio", 1], ["video", 1]]);
    expect(plan.steps[0].parameters).toEqual({ textModel: config.textModel, count: "3", systemPrompt: "只输出正文", reasoningEffort: "high" });
    expect(plan.steps[2].actual).toEqual({ voice: "nova", response_format: "mp3", speed: 1.25 });
    expect(JSON.stringify(plan)).not.toContain("secret");
});

test("preflight rejects media that adapters would omit, unavailable models and unsupported audio adapters", () => {
    const media = [node("audio", "audio", { content: "https://mock.example/audio.mp3" }), node("video", "video", { content: "https://mock.example/video.mp4" }), node("image", "image", { content: "data:image/png;base64,a" })];
    for (const [mode, input] of [["text", "audio"], ["text", "video"], ["audio", "image"], ["image", "audio"]] as const) {
        expect(() => planWorkflow([...media, step("run", mode)], [link(input, "run")], ["run"], config)).toThrow("不支持此输入类型");
    }
    expect(() => planWorkflow([step("sound", "audio")], [], ["sound"], { ...config, channels: [{ ...config.channels[0], apiFormat: "gemini" }] })).toThrow("Gemini");
    const invalid = step("invalid", "text"); invalid.metadata!.model = config.imageModel;
    expect(() => planWorkflow([invalid], [], ["invalid"], config)).toThrow("所选模型");
    const text = planWorkflow([step("text", "text")], [], ["text"], { ...config, channels: [{ ...config.channels[0], apiFormat: "gemini" }] }).steps[0];
    expect(text.parameters.reasoningEffort).toBe("auto");
    expect(text.actual.reasoningEffort).toBeUndefined();
});

test("groups and plugin resources freeze ordinary materials and deduplicate media identity", () => {
    registerNodeDefinitions([{ type: "test:caption", title: "插件文字", icon: null, defaultSize: { width: 200, height: 100 }, resource: (node) => ({ kind: "text", text: node.metadata?.content }) }], "workflow-test");
    try {
        const group = node("group", "group", {});
        const caption = node("caption", "test:caption", { groupId: "group", content: "固定旁白", videoTaskId: "old-task" });
        const image = node("image", "image", { groupId: "group", content: "blob:image", storageKey: "image:original" });
        const copy = node("copy", "image", { content: "blob:copy", storageKey: "image:original" });
        const target = step("target", "text", "分析 @[node:group] 和 @[node:copy]");
        const plan = planWorkflow([group, caption, image, copy, target], [link("group", "target"), link("copy", "target")], ["group", "target"], config);
        expect(plan.steps[0].prompt).toContain("@[node:caption] @[node:image]");
        expect(plan.steps[0].prompt).not.toContain("@[node:group]");
        expect(plan.resources.find((node) => node.id === "caption")?.type).toBe("text");
        expect(JSON.stringify(plan)).not.toContain("old-task");
        caption.metadata!.content = "后来改动";
        unregisterPluginNodes("workflow-test");
        const graph = prepareWorkflowStep(plan.steps[0], plan.steps[0].inputs.map((input) => input.nodeId), config, [caption], [], { x: 0, y: 0 }, plan.resources);
        expect(graph.input.prompt).toContain("固定旁白");
        expect(graph.input.referenceImages).toHaveLength(1);
        expect(graph.nodes[0].metadata?.content).toBe("后来改动");
        expect(conditionKey(workflowEstimateCondition(plan.steps[0], plan, config), true)).toBe(conditionKey(workflowStepEstimateCondition(plan.steps[0], config, graph.input), true));
    } finally { unregisterPluginNodes("workflow-test"); }
});

test("runtime and retries preserve approved parameters, source identities and input even after drafts change", () => {
    const input = node("source", "text", { content: "批准的正文" });
    const target = step("sound", "audio", "朗读 @[node:source]");
    target.metadata!.agentSource = { threadId: "t", turnId: "u", itemId: "i" };
    const plan = planWorkflow([input, target], [link("source", "sound")], ["sound"], config);
    const changed = { ...config, audioVoice: "alloy", audioSpeed: "4", audioInstructions: "后来修改" };
    const graph = prepareWorkflowStep(plan.steps[0], ["source"], changed, [], [], { x: 0, y: 0 }, plan.resources);
    const result = node("result", "audio", resultProvenance(graph.config));
    const retry = buildGenerationConfig(changed, result, "audio");
    expect(retry.audioVoice).toBe("nova"); expect(retry.audioSpeed).toBe("1.25"); expect(retry.audioInstructions).toBe("");
    expect(result.metadata?.inputSnapshot?.prompt).toContain("批准的正文");
    expect(result.metadata?.agentSource).toEqual(target.metadata!.agentSource);
    const altered = { ...config, channels: [{ ...config.channels[0], apiFormat: "gemini" as const }] };
    expect(() => prepareWorkflowStep(plan.steps[0], ["source"], altered, [], [], { x: 0, y: 0 }, plan.resources)).toThrow("重新预览");
    const scripted = { ...config, channels: [{ ...config.channels[0], models: config.channels[0].models.map((model) => ({ ...model, script: "changed" })) }] };
    expect(() => prepareWorkflowStep(plan.steps[0], ["source"], scripted, [], [], { x: 0, y: 0 }, plan.resources)).toThrow("调用脚本");
});

test("partial text is not recoverable until every alternative succeeds; audio recovers without another call", () => {
    const first = step("text", "text"); first.metadata!.textCount = 2;
    const run = createWorkflowRun(planWorkflow([first, step("audio", "audio")], [link("text", "audio")], ["text", "audio"], config));
    run.steps[0].status = "failed"; run.steps[0].configId = "runtime";
    const output = node("text-result", "text", { content: "主文本", status: "success", texts: [{ id: "a", status: "success", content: "主文本" }, { id: "b", status: "error", content: "" }] });
    const edges = [{ ...link("runtime", output.id), kind: "generation" as const }];
    expect(() => workflowResults(run.plan.steps[0], run.steps[0], [output], edges)).toThrow("未完整成功");
    output.metadata!.texts![1] = { id: "b", status: "success", content: "备选" };
    expect(reconcileWorkflow(run, [output], edges).steps[0].status).toBe("succeeded");
    run.steps[1].configId = "runtime-audio"; run.steps[1].status = "interrupted";
    const audio = node("audio-result", "audio", { content: "blob:audio", storageKey: "audio:original", status: "success" });
    expect(reconcileWorkflow(run, [output, audio], [...edges, { ...link("runtime-audio", audio.id), kind: "generation" }]).steps[1].resultIds).toEqual([audio.id]);
});

test("four-mode portable templates contain data only and instantiate independent editable configurations", () => {
    const input = node("audio-file", "audio", { content: "blob:audio", storageKey: "audio:original" });
    const nodes = [input, step("text", "text"), step("audio", "audio"), step("video", "video")];
    const plan = planWorkflow(nodes, [link("text", "audio"), link("audio-file", "video")], ["text", "audio", "video"], config);
    Object.assign(plan.steps[0].parameters, { apiKey: "secret", callScript: "evil" });
    plan.steps[0].agentSource = { threadId: "historical", turnId: "u", itemId: "i" };
    const clean = archivePlan(plan);
    expect(JSON.stringify(clean)).not.toMatch(/secret|evil|historical/);
    expect(clean.resources[0].type).toBe("audio");
    const graph = instantiateWorkflow(clean), other = instantiateWorkflow(clean);
    expect(graph.configIds).not.toEqual(other.configIds);
    const text = graph.nodes.find((node) => node.id === graph.configIds[0])!;
    const audio = graph.nodes.find((node) => node.id === graph.configIds[1])!;
    expect(text.metadata?.systemPrompt).toBe("只输出正文");
    expect(audio.metadata?.audioVoice).toBe("nova");
    expect(audio.metadata?.draftReferenceIds).toEqual([text.id]);
    expect(audio.metadata?.workflowStep).toBeUndefined();
});

test("Agent text-to-speech plans share preflight, restrict parameters by mode and preserve message ownership", () => {
    const source = { threadId: "t", turnId: "u", itemId: "i" };
    const data = { title: "旁白", steps: [{ id: "script", mode: "text", prompt: "写一段旁白", parameters: { textCount: "2", reasoningEffort: "low" } }, { id: "speech", mode: "audio", prompt: "朗读", dependsOn: ["script"], parameters: { audioVoice: "nova" } }] };
    const encode = (data: unknown) => "```dianran-plan\n" + JSON.stringify(data) + "\n```";
    const plan = agentWorkflowPlan(encode(data), [], config, source);
    expect(plan.steps[0].calls).toBe(2); expect(plan.steps[1].agentSource).toEqual(source);
    expect(plan.steps[1].inputs[0].stepId).toBe(plan.steps[0].id);
    expect(() => agentWorkflowPlan(encode({ ...data, steps: [{ ...data.steps[0], parameters: { audioVoice: "nova" } }] }), [], config, source)).toThrow("未知字段");
    expect(() => agentWorkflowPlan(encode({ ...data, steps: [{ ...data.steps[0], model: config.imageModel }] }), [], config, source)).toThrow("所选模型");
});
