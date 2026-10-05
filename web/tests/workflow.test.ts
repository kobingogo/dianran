import "./browser-storage";
import { expect, test } from "bun:test";
const { defaultConfig } = await import("../src/stores/use-config-store");
const { planWorkflow, createWorkflowRun, executeWorkflow, instantiateWorkflow } = await import("../src/lib/canvas/workflow");
const { workflowTemplate } = await import("../src/stores/canvas/use-workflow-store");
const { agentWorkflowPlan } = await import("../src/lib/canvas/agent-workflow-plan");
import type { CanvasNodeData, CanvasConnection } from "../src/types/canvas";
const config = {
    ...defaultConfig,
    apiKey: "test-secret",
    channels: [
        {
            id: "test",
            name: "test",
            baseUrl: "https://mock.example",
            apiKey: "test-secret",
            apiFormat: "openai" as const,
            models: [
                { name: "gpt-image-1", capability: "image" as const },
                { name: "sora-2", capability: "video" as const },
            ],
        },
    ],
    imageModel: "test::gpt-image-1",
    videoModel: "test::sora-2",
};
const nodes: CanvasNodeData[] = [
    { id: "first", type: "config", title: "海报", position: { x: 0, y: 0 }, width: 200, height: 200, metadata: { prompt: "海报", generationMode: "image", count: 1 } },
    { id: "second", type: "config", title: "视频", position: { x: 400, y: 0 }, width: 200, height: 200, metadata: { prompt: "@[node:first] 运动", generationMode: "video", count: 1 } },
];
const edge: CanvasConnection = { id: "dependency", fromNodeId: "first", toNodeId: "second", kind: "input" };

test("sorts declared dependencies, excludes visual edges, blocks cycles and missing inputs", () => {
    const plan = planWorkflow(nodes, [edge], ["second", "first"], config);
    expect(plan.steps.map((step) => step.id)).toEqual(["first", "second"]);
    expect(plan.steps[1].inputs[0].stepId).toBe("first");
    expect(JSON.stringify(plan)).not.toContain("test-secret");
    expect(() => planWorkflow(nodes, [edge, { ...edge, id: "cycle", fromNodeId: "second", toNodeId: "first" }], ["first", "second"], config)).toThrow();
    expect(() => planWorkflow(nodes, [{ ...edge, fromNodeId: "missing" }], ["second"], config)).toThrow("不存在");
    expect(planWorkflow([nodes[0]], [{ ...edge, fromNodeId: "missing", toNodeId: "first", kind: undefined }], ["first"], config).steps[0].inputs).toEqual([]);
});
test("checkpoints before paid calls, resolves new outputs, skips success and never resubmits interrupted steps", async () => {
    const run = createWorkflowRun(planWorkflow(nodes, [edge], ["first", "second"], config));
    const calls: string[] = [];
    let checkpointed = false;
    await executeWorkflow(
        run,
        async (step, inputs) => {
            expect(checkpointed).toBe(true);
            calls.push(step.id);
            if (step.id === "second") {
                expect(inputs).toEqual(["new-image"]);
                expect(step.prompt).toBe("@[node:new-image] 运动");
            }
            checkpointed = false;
            return [step.id === "first" ? "new-image" : "new-video"];
        },
        async () => {
            checkpointed = true;
        },
        () => false,
    );
    expect(calls).toEqual(["first", "second"]);
    await executeWorkflow(
        run,
        async () => {
            throw new Error("unexpected paid call");
        },
        async () => {},
        () => false,
    );
    run.steps[1].status = "running";
    await expect(
        executeWorkflow(
            run,
            async () => {
                throw new Error("unexpected paid call");
            },
            async () => {},
            () => false,
        ),
    ).rejects.toThrow("不会重复提交");
});
test("partial failure preserves prior success and blocks downstream", async () => {
    const run = createWorkflowRun(planWorkflow(nodes, [edge], ["first", "second"], config));
    await expect(
        executeWorkflow(
            run,
            async (step) => {
                if (step.id === "second") throw new Error("remote failure");
                return ["saved-image"];
            },
            async () => {},
            () => false,
        ),
    ).rejects.toThrow("remote failure");
    expect(run.steps[0].status).toBe("succeeded");
    expect(run.steps[0].resultIds).toEqual(["saved-image"]);
    expect(run.steps[1].status).toBe("failed");
});
test("templates create independent graphs and remap references without task identity", () => {
    const plan = planWorkflow(nodes, [edge], ["first", "second"], config);
    const template = workflowTemplate(plan, "海报到视频");
    const first = instantiateWorkflow(template.plan);
    const second = instantiateWorkflow(template.plan);
    expect(first.configIds[0]).not.toBe(second.configIds[0]);
    expect(first.nodes[1].metadata?.composerContent).toBe(`@[node:${first.configIds[0]}] 运动`);
    expect(first.connections[0].fromNodeId).toBe(first.configIds[0]);
    expect(JSON.stringify(template)).not.toContain("test-secret");
});
test("Agent plan keeps authoritative source identity and rejects credentials or arbitrary instructions", () => {
    const source = { threadId: "thread", turnId: "turn", itemId: "item" };
    const text = '```dianran-plan\n{"title":"流程","steps":[{"id":"one","mode":"image","prompt":"海报"},{"id":"two","mode":"video","prompt":"运动","dependsOn":["one"]}]}\n```';
    const plan = agentWorkflowPlan(text, [], config, source);
    expect(plan.steps[1].agentSource).toEqual(source);
    expect(plan.steps[1].inputs[0].stepId).toBe(plan.steps[0].id);
    expect(() => agentWorkflowPlan(text.replace('"title":"流程"', '"apiKey":"secret","title":"流程"'), [], config, source)).toThrow("未知字段");
});

test("reconciliation accepts only complete saved results and never calls a model", async () => {
    const { reconcileWorkflow } = await import("../src/lib/canvas/workflow");
    const run = createWorkflowRun(planWorkflow(nodes, [edge], ["first", "second"], config));
    run.steps[0].status = "running";
    run.steps[0].configId = "runtime-config";
    const output: CanvasNodeData = {
        id: "saved-result",
        type: "image",
        title: "结果",
        position: { x: 0, y: 0 },
        width: 100,
        height: 100,
        metadata: { status: "success", content: "blob:saved", images: [{ id: "slot", status: "success", content: "blob:saved", naturalWidth: 100, naturalHeight: 100, bytes: 1, mimeType: "image/png" }] },
    };
    const links: CanvasConnection[] = [{ id: "generated", fromNodeId: "runtime-config", toNodeId: output.id, kind: "generation" }];
    expect(reconcileWorkflow(run, [output], links).steps[0].resultIds).toEqual([output.id]);
    expect(run.steps[0].status).toBe("running");
    output.metadata!.images![0].status = "error";
    expect(() => reconcileWorkflow(run, [output], links)).toThrow("未完整成功");
});

test("approved inputs and intermediate results are retained for later steps", async () => {
    const plan = planWorkflow(nodes, [edge], ["first", "second"], config);
    const resource: CanvasNodeData = { id: "frozen", type: "text", title: "输入", position: { x: 0, y: 0 }, width: 100, height: 100, metadata: { content: "批准时的内容" } };
    plan.resources.push(resource);
    const run = createWorkflowRun(plan);
    resource.metadata!.content = "随后修改的草稿";
    await executeWorkflow(
        run,
        async (step, _inputs, state, _checkpoint, frozen) => {
            expect(frozen.find((node) => node.id === "frozen")?.metadata?.content).toBe("批准时的内容");
            if (step.id === "first") state.resultNodes = [{ ...resource, id: "intermediate", metadata: { content: "首步结果", storageKey: "image:original-output" } }];
            else expect(frozen.find((node) => node.id === "intermediate")?.metadata?.storageKey).toBe("image:original-output");
            return [step.id === "first" ? "intermediate" : "last"];
        },
        async () => {},
        () => false,
    );
});
