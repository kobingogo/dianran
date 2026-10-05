import { nanoid } from "nanoid";
import { CanvasNodeType, type CanvasNodeData, type CanvasConnection } from "@/types/canvas";
import { buildGenerationConfig, getGenerationCount } from "./canvas-generation-helpers";
import { isAiConfigReady, resolveModelRequestConfig, resolveModelScript, type AiConfig } from "@/stores/use-config-store";
import { createComposerSubmission, type ComposerMode, type ComposerParameters } from "@/lib/composer";
import { createCanvasNode } from "./canvas-node-factory";
import { canvasReferenceIds } from "./canvas-composer-references";

export type WorkflowInput = { nodeId: string; stepId?: string };
export type WorkflowStep = {
    id: string;
    title: string;
    mode: ComposerMode;
    prompt: string;
    parameters: ComposerParameters;
    actual: Record<string, string | number>;
    calls: number;
    endpoint: string;
    inputs: WorkflowInput[];
    agentSource?: NonNullable<CanvasNodeData["metadata"]>["agentSource"];
};
export type WorkflowPlan = { id: string; title: string; steps: WorkflowStep[]; resources: CanvasNodeData[] };
export type WorkflowStepRun = { stepId: string; status: "pending" | "running" | "succeeded" | "failed" | "interrupted"; configId?: string; resultIds: string[]; resultNodes?: CanvasNodeData[]; error?: string };
export type WorkflowRun = { id: string; plan: WorkflowPlan; steps: WorkflowStepRun[]; prepared?: boolean };

export function workflowScope(nodes: CanvasNodeData[], connections: CanvasConnection[], selected: string[], downstream = false) {
    const ids = new Set(selected);
    if (downstream) {
        let changed = true;
        while (changed) {
            changed = false;
            for (const edge of connections)
                if ((edge.kind === "input" || edge.kind === "generation") && ids.has(edge.fromNodeId) && !ids.has(edge.toNodeId)) {
                    ids.add(edge.toNodeId);
                    changed = true;
                }
        }
    }
    if ([...ids].some((id) => !nodes.some((node) => node.id === id))) throw new Error("所选节点已不存在");
    return [...ids];
}

export function planWorkflow(nodes: CanvasNodeData[], connections: CanvasConnection[], selected: string[], config: AiConfig, title = "画布工作流"): WorkflowPlan {
    const selectedNodes = nodes.filter((node) => selected.includes(node.id));
    if (selectedNodes.some((node) => ![CanvasNodeType.Config, CanvasNodeType.Image, CanvasNodeType.Video, CanvasNodeType.Text].includes(node.type as CanvasNodeType))) throw new Error("工作流当前只支持生图/视频配置及图片、视频、文字输入");
    const configs = selectedNodes.filter((node) => node.type === CanvasNodeType.Config);
    if (!configs.length) throw new Error("请先选择要执行的配置节点");
    const configIds = new Set(configs.map((node) => node.id));
    const resources = new Map<string, CanvasNodeData>();
    const steps = configs.map((node): WorkflowStep => {
        const mode = node.metadata?.generationMode || "image";
        if (mode !== "image" && mode !== "video") throw new Error("工作流尚不支持文本或音频生成");
        const prompt = node.metadata?.composerContent ?? node.metadata?.prompt ?? "";
        if (!prompt.trim()) throw new Error(`${node.title}：请先填写提示词`);
        const request = buildGenerationConfig(config, node, mode);
        if (resolveModelScript(request, request.model)) throw new Error(`${node.title}：工作流 MVP 暂不支持自定义调用脚本`);
        if (!isAiConfigReady(request, request.model)) throw new Error(`${node.title}：模型或渠道未配置`);
        const inputs = [...new Set([...connections.filter((edge) => edge.toNodeId === node.id && edge.kind === "input").map((edge) => edge.fromNodeId), ...canvasReferenceIds(prompt), ...(node.metadata?.draftReferenceIds || [])])].map(
            (id): WorkflowInput => {
                const input = nodes.find((item) => item.id === id);
                if (!input) throw new Error(`${node.title}：输入 ${id} 已不存在`);
                const producer = connections.find((edge) => edge.kind === "generation" && edge.toNodeId === id && configIds.has(edge.fromNodeId));
                const stepId = configIds.has(id) ? id : producer?.fromNodeId;
                if (stepId) return { nodeId: id, stepId };
                if (![CanvasNodeType.Image, CanvasNodeType.Video, CanvasNodeType.Text].includes(input.type as CanvasNodeType) || !input.metadata?.content) throw new Error(`${node.title}：输入 ${input.title} 尚无可用内容`);
                if (mode === "image" && input.type === CanvasNodeType.Video) throw new Error(`${node.title}：生图不支持视频输入`);
                resources.set(id, structuredClone(input));
                return { nodeId: id };
            },
        );
        // A dependency will materialize an image or video; preview validates its declared media kind now.
        const imageInputs = inputs.filter((input) => (input.stepId ? configs.find((node) => node.id === input.stepId)?.metadata?.generationMode !== "video" : resources.get(input.nodeId)?.type === CanvasNodeType.Image));
        if (mode === "image" && inputs.some((input) => input.stepId && configs.find((node) => node.id === input.stepId)?.metadata?.generationMode === "video")) throw new Error(`${node.title}：生图不能依赖视频结果`);
        const submission = createComposerSubmission(
            mode,
            prompt.replace(/@\[node:[^\]]+\]/g, "参考输入"),
            imageInputs.map((input) => ({ id: input.nodeId, name: input.nodeId, type: "image/png", dataUrl: "", storageKey: input.nodeId })),
            { ...request, [mode === "image" ? "imageModel" : "videoModel"]: request.model },
            false,
            15,
        );
        if (mode === "image" && getGenerationCount(request.count) !== Number(submission.parameters.count)) throw new Error(`${node.title}：参数需要调整，请先在配置中确认`);
        return {
            id: node.id,
            title: node.title,
            mode,
            prompt,
            parameters: submission.parameters,
            actual: submission.actual,
            calls: mode === "image" ? getGenerationCount(request.count) : 1,
            endpoint: resolveModelRequestConfig(request, request.model).baseUrl,
            inputs,
            agentSource: node.metadata?.agentSource,
        };
    });
    const sorted: WorkflowStep[] = [];
    const visiting = new Set<string>();
    const done = new Set<string>();
    const visit = (id: string) => {
        if (visiting.has(id)) throw new Error("工作流存在循环依赖，请移除循环连线");
        if (done.has(id)) return;
        visiting.add(id);
        const step = steps.find((step) => step.id === id)!;
        step.inputs.forEach((input) => {
            if (input.stepId) visit(input.stepId);
        });
        visiting.delete(id);
        done.add(id);
        sorted.push(step);
    };
    steps.forEach((step) => visit(step.id));
    return { id: nanoid(), title, steps: sorted, resources: [...resources.values()] };
}

export function createWorkflowRun(plan: WorkflowPlan): WorkflowRun {
    return { id: nanoid(), plan: structuredClone(plan), steps: plan.steps.map((step) => ({ stepId: step.id, status: "pending", resultIds: [] })) };
}

/** Only untouched steps run; an interrupted request is never submitted again automatically. */
export async function executeWorkflow(
    run: WorkflowRun,
    execute: (step: WorkflowStep, inputs: string[], runStep: WorkflowStepRun, checkpoint: () => Promise<void>, frozenInputs: CanvasNodeData[]) => Promise<string[]>,
    save: (run: WorkflowRun) => Promise<void>,
    stopped: () => boolean,
) {
    for (const step of run.plan.steps) {
        const state = run.steps.find((item) => item.stepId === step.id)!;
        if (state.status === "succeeded") continue;
        if (state.status !== "pending") throw new Error("存在失败或中断步骤，请先在结果节点处理；不会重复提交已开始的请求");
        if (stopped()) return;
        let resolvedPrompt = step.prompt;
        const inputIds = step.inputs.flatMap((input) => {
            if (!input.stepId) return [input.nodeId];
            const dependency = run.steps.find((item) => item.stepId === input.stepId)!;
            if (dependency.status !== "succeeded" || !dependency.resultIds.length) throw new Error("上游步骤未完整成功，已停止执行下游");
            resolvedPrompt = resolvedPrompt.replaceAll(`@[node:${input.nodeId}]`, `@[node:${dependency.resultIds[0]}]`);
            return dependency.resultIds;
        });
        state.status = "running";
        await save(run); // Persist intent before any paid call.
        try {
            state.resultIds = await execute({ ...step, prompt: resolvedPrompt }, inputIds, state, () => save(run), [...run.plan.resources, ...run.steps.flatMap((item) => item.resultNodes || [])]);
            if (!state.resultIds.length) throw new Error("步骤没有完整可用结果");
            state.status = "succeeded";
        } catch (error) {
            state.status = "failed";
            state.error = error instanceof Error ? error.message : String(error);
            await save(run);
            throw error;
        }
        await save(run);
    }
}

export function instantiateWorkflow(plan: WorkflowPlan, position = { x: 80, y: 80 }) {
    const ids = new Map<string, string>();
    const nodes = plan.resources.map((source, index) => {
        const node = { ...structuredClone(source), id: nanoid(), position: { x: position.x, y: position.y + index * 360 } };
        ids.set(source.id, node.id);
        return node;
    });
    const configs = plan.steps.map((step, index) => {
        const p = step.parameters;
        const node = createCanvasNode(
            CanvasNodeType.Config,
            { x: position.x + 456 + index * 456, y: position.y + 160 },
            {
                generationMode: step.mode,
                model: p[step.mode === "image" ? "imageModel" : "videoModel"],
                size: step.mode === "image" ? p.size : p.videoSize,
                quality: p.quality,
                background: p.background,
                count: Number(p.count),
                seconds: p.videoSeconds,
                vquality: p.vquality,
                generateAudio: p.videoGenerateAudio,
                watermark: p.videoWatermark,
                videoMode: p.videoMode,
                status: "idle",
                agentSource: step.agentSource,
            },
        );
        node.title = step.title;
        ids.set(step.id, node.id);
        return node;
    });
    const connections: CanvasConnection[] = [];
    plan.steps.forEach((step, index) => {
        const config = configs[index];
        const inputs = step.inputs.map((input) => ids.get(input.stepId || input.nodeId)!);
        let prompt = step.prompt;
        step.inputs.forEach((input) => {
            prompt = prompt.replaceAll(`@[node:${input.nodeId}]`, `@[node:${ids.get(input.stepId || input.nodeId)}]`);
        });
        config.metadata = { ...config.metadata, prompt, composerContent: prompt, draftReferenceIds: inputs };
        inputs.forEach((fromNodeId) => connections.push({ id: nanoid(), fromNodeId, toNodeId: config.id, kind: "input" }));
    });
    return { nodes: [...nodes, ...configs], connections, configIds: configs.map((node) => node.id) };
}

export function workflowResults(step: WorkflowStep, state: WorkflowStepRun, nodes: CanvasNodeData[], connections: CanvasConnection[]) {
    const results = connections
        .filter((edge) => edge.kind === "generation" && edge.fromNodeId === state.configId)
        .map((edge) => nodes.find((node) => node.id === edge.toNodeId)!)
        .filter(Boolean);
    if (
        !results.length ||
        results.some((node) => node.type !== step.mode || node.metadata?.status !== "success" || !node.metadata.content || (step.mode === "image" && (node.metadata.images?.filter((image) => image.status === "success").length || 0) < step.calls))
    )
        throw new Error("步骤未完整成功，下游已停止；请在结果节点重试或取任务状态");
    return results.map((node) => node.id);
}

export function reconcileWorkflow(run: WorkflowRun, nodes: CanvasNodeData[], connections: CanvasConnection[]) {
    const recovered = structuredClone(run);
    for (const state of recovered.steps) {
        if (state.status === "pending" || state.status === "succeeded") continue;
        state.resultIds = workflowResults(recovered.plan.steps.find((step) => step.id === state.stepId)!, state, nodes, connections);
        state.resultNodes = state.resultIds.map((id) => structuredClone(nodes.find((node) => node.id === id)!));
        state.status = "succeeded";
        state.error = undefined;
    }
    return recovered;
}
