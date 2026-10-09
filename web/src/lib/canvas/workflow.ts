import { nanoid } from "nanoid";
import { CanvasNodeType, type CanvasNodeData, type CanvasConnection, type CanvasGenerationMode, type Position } from "@/types/canvas";
import { buildGenerationConfig, getGenerationCount } from "./canvas-generation-helpers";
import { isAiConfigReady, modelMatchesCapability, resolveModelRequestConfig, resolveModelScript, type AiConfig } from "@/stores/use-config-store";
import { createComposerSubmission, type ComposerParameters } from "@/lib/composer";
import { parameterKeys } from "@/lib/creation-preferences";
import { normalizeAudioFormatValue, normalizeAudioSpeedValue, normalizeAudioVoiceValue } from "@/lib/audio-generation";
import { buildNodeGenerationContext, type NodeGenerationContext } from "@/components/canvas/canvas-node-generation";
import { createCanvasSubmissionGraph, freezeCanvasInput, prepareCanvasSubmission } from "./canvas-composer";
import { getGroupResourceNodes, isCanvasReferenceNode } from "./canvas-resource-references";
import { getNodeDefinition } from "./node-registry";
import { createCanvasNode } from "./canvas-node-factory";
import { canvasReferenceIds } from "./canvas-composer-references";
import { planPluginAction, resolvePluginAction, type WorkflowPluginAction } from "./plugin-actions";

export type WorkflowInput = { nodeId: string; stepId?: string };
export type WorkflowParameters = Partial<ComposerParameters & Pick<AiConfig, "textModel" | "audioModel" | "reasoningEffort" | "systemPrompt" | "audioVoice" | "audioFormat" | "audioSpeed" | "audioInstructions">>;
export const workflowModelKeys = { image: "imageModel", video: "videoModel", text: "textModel", audio: "audioModel" } as const;
export const workflowParameterKeys: Record<CanvasGenerationMode, (keyof WorkflowParameters)[]> = {
    image: parameterKeys.image,
    video: parameterKeys.video,
    text: ["textModel", "reasoningEffort", "systemPrompt", "count"],
    audio: ["audioModel", "audioVoice", "audioFormat", "audioSpeed", "audioInstructions"],
};
export const workflowModeLabels = { image: "图片", video: "视频", text: "文本", audio: "音频" };
export const workflowModel = (step: WorkflowStep) => step.parameters[workflowModelKeys[step.mode]] || "";
export type WorkflowStep = {
    action?: WorkflowPluginAction;
    id: string;
    title: string;
    mode: CanvasGenerationMode;
    prompt: string;
    parameters: WorkflowParameters;
    actual: Record<string, string | number>;
    calls: number;
    endpoint: string;
    apiFormat?: AiConfig["apiFormat"];
    source?: "codex";
    allowUnverified?: boolean;
    inputs: WorkflowInput[];
    agentSource?: NonNullable<CanvasNodeData["metadata"]>["agentSource"];
};
export type WorkflowPlan = { id: string; title: string; steps: WorkflowStep[]; resources: CanvasNodeData[] };
export type WorkflowStepRun = { stepId: string; status: "pending" | "running" | "succeeded" | "failed" | "interrupted"; configId?: string; requestId?: string; resultIds: string[]; resultNodes?: CanvasNodeData[]; error?: string };
export type WorkflowRun = { id: string; plan: WorkflowPlan; steps: WorkflowStepRun[]; prepared?: boolean };

function workflowParameters(request: AiConfig, mode: "text" | "audio", textCount = 1): { parameters: WorkflowParameters; actual: WorkflowStep["actual"] } {
    if (mode === "text") {
        const apiFormat = resolveModelRequestConfig(request, request.model).apiFormat;
        const parameters: WorkflowParameters = { textModel: request.model, count: String(textCount), systemPrompt: request.systemPrompt.trim(), reasoningEffort: apiFormat === "gemini" ? "auto" : request.reasoningEffort };
        return { parameters, actual: { systemPrompt: parameters.systemPrompt!, ...(parameters.reasoningEffort === "auto" ? {} : { reasoningEffort: parameters.reasoningEffort! }) } };
    }
    const parameters: WorkflowParameters = {
        audioModel: request.model, audioVoice: normalizeAudioVoiceValue(request.audioVoice), audioFormat: normalizeAudioFormatValue(request.audioFormat),
        audioSpeed: normalizeAudioSpeedValue(request.audioSpeed), audioInstructions: request.audioInstructions.trim(),
    };
    return { parameters, actual: { voice: parameters.audioVoice!, response_format: parameters.audioFormat!, speed: Number(parameters.audioSpeed), ...(parameters.audioInstructions ? { instructions: parameters.audioInstructions } : {}) } };
}

function validateWorkflowInputs(mode: CanvasGenerationMode, types: string[], title: string) {
    const allowed = mode === "video" ? ["text", "image", "video", "audio"] : mode === "audio" ? ["text"] : ["text", "image"];
    if (types.some((type) => !allowed.includes(type))) throw new Error(`${title}：${workflowModeLabels[mode]}生成不支持此输入类型，请移除未发送的引用`);
}

/** Display-only plugin resources become ordinary frozen materials. */
function workflowResource(node: CanvasNodeData): CanvasNodeData {
    const builtin = [CanvasNodeType.Image, CanvasNodeType.Video, CanvasNodeType.Audio, CanvasNodeType.Text].includes(node.type as CanvasNodeType);
    const resource = builtin ? undefined : getNodeDefinition(node.type)?.resource?.(node);
    const type = builtin ? node.type : resource?.kind;
    const content = builtin ? node.metadata?.content || (type === "text" ? node.metadata?.prompt : "") : type === "text" ? resource?.text : resource?.url;
    if (!type || !content || node.metadata?.status === "loading") throw new Error(`输入 ${node.title} 尚无可用内容`);
    return { ...structuredClone(node), type, metadata: { content, storageKey: type === "text" ? undefined : node.metadata?.storageKey, naturalWidth: node.metadata?.naturalWidth, naturalHeight: node.metadata?.naturalHeight, mimeType: node.metadata?.mimeType, bytes: node.metadata?.bytes, status: "success" } };
}

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
    if (selectedNodes.some((node) => node.type !== CanvasNodeType.Config && !getNodeDefinition(node.type)?.workflowAction && !isCanvasReferenceNode(node, nodes))) throw new Error("工作流支持生成配置、处理插件和可引用的素材节点");
    const configs = selectedNodes.filter((node) => node.type === CanvasNodeType.Config || getNodeDefinition(node.type)?.workflowAction);
    if (!configs.length) throw new Error("请先选择要执行的配置节点");
    const configIds = new Set(configs.map((node) => node.id));
    const resources = new Map<string, CanvasNodeData>();
    const steps = configs.map((node): WorkflowStep => {
        const mode = node.metadata?.generationMode || "image";
        if (!workflowModelKeys[mode]) throw new Error(`${node.title}：生成模式无效`);
        const action = getNodeDefinition(node.type)?.workflowAction ? planPluginAction(node.type, node.metadata?.pluginActionParameters || {}) : undefined;
        if (action && mode !== "image") throw new Error(`${node.title}：处理动作只支持图片结果`);
        let prompt = action ? getNodeDefinition(node.type)!.workflowAction!.title : node.metadata?.composerContent ?? node.metadata?.prompt ?? "";
        if (!prompt.trim()) throw new Error(`${node.title}：请先填写提示词`);
        const native = !action && node.metadata?.generationSource === "codex";
        if (native && (mode !== "image" || !node.metadata?.codexModel)) throw new Error(`${node.title}：本机 Codex 步骤仅支持图片，请明确选择模型`);
        if (!native && !action && node.metadata?.model && !modelMatchesCapability(config, node.metadata.model, mode)) throw new Error(`${node.title}：所选模型不存在或不支持此模式，请重新选择`);
        const request = buildGenerationConfig(config, node, mode);
        request[workflowModelKeys[mode]] = request.model;
        if (!native && !action && !modelMatchesCapability(request, request.model, mode)) throw new Error(`${node.title}：请配置此模式的可用模型`);
        if (!native && !action && resolveModelScript(request, request.model)) throw new Error(`${node.title}：工作流暂不支持自定义调用脚本`);
        if (!native && !action && !isAiConfigReady(request, request.model)) throw new Error(`${node.title}：模型或渠道未配置`);
        const channel = resolveModelRequestConfig(request, request.model);
        if (mode === "audio" && channel.apiFormat === "gemini") throw new Error(`${node.title}：当前 Gemini 适配器不支持音频生成`);
        const ids = [...new Set([...connections.filter((edge) => edge.toNodeId === node.id && edge.kind === "input").map((edge) => edge.fromNodeId), ...canvasReferenceIds(prompt), ...(node.metadata?.draftReferenceIds || [])])];
        const expanded = ids.flatMap((id) => {
            const input = nodes.find((item) => item.id === id);
            if (!input) throw new Error(`${node.title}：输入 ${id} 已不存在`);
            if (input.type !== CanvasNodeType.Group) return [id];
            const children = getGroupResourceNodes(id, nodes);
            if (!children.length) throw new Error(`${node.title}：分组 ${input.title} 没有可用素材`);
            prompt = prompt.replaceAll(`@[node:${id}]`, children.map((child) => `@[node:${child.id}]`).join(" "));
            return children.map((child) => child.id);
        });
        const inputs = [...new Set(expanded)].map((id): WorkflowInput => {
            const input = nodes.find((item) => item.id === id)!;
            const producer = connections.find((edge) => edge.kind === "generation" && edge.toNodeId === id && configIds.has(edge.fromNodeId));
            const stepId = configIds.has(id) ? id : producer?.fromNodeId;
            if (stepId) return { nodeId: id, stepId };
            resources.set(id, workflowResource(input));
            return { nodeId: id };
        });
        const types = inputs.map((input) => input.stepId ? configs.find((node) => node.id === input.stepId)?.metadata?.generationMode || "image" : resources.get(input.nodeId)!.type);
        validateWorkflowInputs(mode, types, node.title);
        if (action && (!types.length || types.some((type) => type !== "image"))) throw new Error(`${node.title}：处理步骤需要连接图片输入`);
        // Deduplicate real file identities, but keep each future output as a distinct reference.
        const imageInputs = [...new Map(inputs.filter((_input, index) => types[index] === "image").map((input) => [input.stepId || resources.get(input.nodeId)?.metadata?.storageKey || resources.get(input.nodeId)?.metadata?.content || input.nodeId, input])).values()];
        const preview: { parameters: WorkflowParameters; actual: WorkflowStep["actual"] } = action ? { parameters: { count: "1" }, actual: { plugin: action.pluginId, action: action.actionId, version: action.version, parameters: JSON.stringify(action.parameters) } } : native ? { parameters: { imageModel: node.metadata!.codexModel, count: "1" }, actual: { source: "codex", model: node.metadata!.codexModel! } }
            : mode === "image" || mode === "video"
            ? createComposerSubmission(mode, prompt.replace(/@\[node:[^\]]+\]/g, "参考输入"), imageInputs.map((input) => ({ id: input.nodeId, name: input.nodeId, type: "image/png", dataUrl: "", storageKey: input.nodeId })), request, false, 15)
            : workflowParameters(request, mode, getGenerationCount(String(node.metadata?.textCount || 1)));
        if (!native && !action && mode === "image" && getGenerationCount(request.count) !== Number(preview.parameters.count)) throw new Error(`${node.title}：参数需要调整，请先在配置中确认`);
        if (mode === "video" && channel.apiFormat === "gemini") {
            const count = (type: string) => new Set(inputs.filter((_input, index) => types[index] === type).map((input) => input.stepId || resources.get(input.nodeId)?.metadata?.storageKey || resources.get(input.nodeId)?.metadata?.content || input.nodeId)).size;
            if (count("video") > 1 || count("audio") > 1) throw new Error(`${node.title}：当前 Gemini 视频适配器仅发送一个视频和一个音频，请移除多余引用`);
        }
        return {
            id: node.id, title: node.title, mode, prompt,
            parameters: Object.fromEntries(workflowParameterKeys[mode].map((key) => [key, (preview.parameters as WorkflowParameters)[key]])),
            actual: preview.actual,
            calls: mode === "image" || mode === "text" ? Number(preview.parameters.count) : 1,
            endpoint: native || action ? "" : channel.baseUrl, apiFormat: native || action ? undefined : channel.apiFormat, source: native ? "codex" : undefined, action, inputs, agentSource: node.metadata?.agentSource,
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
            state.status = (error as { interrupted?: boolean })?.interrupted ? "interrupted" : "failed";
            state.error = error instanceof Error ? error.message : String(error);
            await save(run);
            throw error;
        }
        await save(run);
    }
}

function workflowConfigNode(step: WorkflowStep, position: Position) {
    const p = step.parameters;
    const node = createCanvasNode(step.action?.nodeType || CanvasNodeType.Config, position, {
        pluginActionParameters: step.action?.parameters,
        generationMode: step.mode, model: workflowModel(step),
        size: step.mode === "image" ? p.size : p.videoSize, quality: p.quality, background: p.background, count: Number(p.count || 1),
        seconds: p.videoSeconds, vquality: p.vquality, generateAudio: p.videoGenerateAudio, watermark: p.videoWatermark, videoMode: p.videoMode,
        textCount: step.mode === "text" ? Number(p.count) : undefined, reasoningEffort: p.reasoningEffort, systemPrompt: p.systemPrompt,
        audioVoice: p.audioVoice, audioFormat: p.audioFormat, audioSpeed: p.audioSpeed, audioInstructions: p.audioInstructions,
        status: "idle", agentSource: step.agentSource, generationSource: step.source === "codex" ? "codex" : "api", codexModel: step.source === "codex" ? workflowModel(step) : undefined,
    });
    node.title = step.title;
    return node;
}

/** Prepare a fresh graph using the approved parameters and frozen inputs before any paid request. */
export function prepareWorkflowStep(step: WorkflowStep, inputIds: string[], config: AiConfig, nodes: CanvasNodeData[], connections: CanvasConnection[], position: Position, frozenInputs = nodes) {
    if (step.action) {
        resolvePluginAction(step.action);
        const source = workflowConfigNode(step, position);
        const resources = inputIds.map((id) => frozenInputs.find((node) => node.id === id));
        if (!resources.length || resources.some((node) => node?.type !== "image" || !node.metadata?.storageKey || !node.metadata?.content)) throw new Error("处理步骤需要完整保存的图片原文件");
        source.metadata = { ...source.metadata, inputNodeIds: inputIds, workflowStep: structuredClone(step), prompt: step.prompt };
        const input = buildNodeGenerationContext(source.id, [...frozenInputs, source], inputIds.map((id) => ({ id: nanoid(), fromNodeId: id, toNodeId: source.id, kind: "input" })), step.prompt);
        return { nodes: [...nodes, source], connections: [...connections, ...inputIds.map((id) => ({ id: nanoid(), fromNodeId: id, toNodeId: source.id, kind: "input" as const }))], config: source, input };
    }
    const request = { ...config, ...step.parameters, model: workflowModel(step) };
    const native = step.source === "codex";
    if (native && (step.mode !== "image" || !request.model || step.calls !== 1)) throw new Error("本机 Codex 图片步骤须明确模型，每步提交一个原生任务");
    const channel = resolveModelRequestConfig(request, request.model);
    if (!native && (channel.baseUrl !== step.endpoint || channel.apiFormat !== step.apiFormat)) throw new Error("渠道地址或接口格式已改变，请重新预览计划");
    if (!native && resolveModelScript(request, request.model)) throw new Error("调用脚本已改变，请重新预览计划");
    if (!native && !modelMatchesCapability(request, request.model, step.mode)) throw new Error("模型已移除或能力已改变，请重新预览计划");
    if (!native && !isAiConfigReady(request, request.model)) throw new Error("模型或渠道未配置，请重新预览计划");
    let graph;
    let input: NodeGenerationContext;
    let actual: WorkflowStep["actual"];
    if (!native && (step.mode === "image" || step.mode === "video")) {
        const submission = prepareCanvasSubmission(step.mode, step.prompt, [], request, frozenInputs, inputIds);
        graph = createCanvasSubmissionGraph(submission, nodes, connections, position);
        input = submission.input;
        actual = submission.actual;
    } else {
        const source = workflowConfigNode(step, position);
        let prompt = step.prompt;
        for (const id of inputIds) if (!prompt.includes(`@[node:${id}]`)) prompt += ` @[node:${id}]`;
        source.metadata = { ...source.metadata, composerContent: prompt, prompt, inputNodeIds: inputIds, draftReferenceIds: inputIds };
        const links = inputIds.map((fromNodeId) => ({ id: nanoid(), fromNodeId, toNodeId: source.id, kind: "input" as const }));
        input = buildNodeGenerationContext(source.id, [...frozenInputs, source], links, prompt);
        validateWorkflowInputs(step.mode, [...input.referenceImages.map(() => "image"), ...input.referenceVideos.map(() => "video"), ...input.referenceAudios.map(() => "audio")], step.title);
        actual = native ? { source: "codex", model: request.model } : workflowParameters(request, step.mode as "text" | "audio", step.calls).actual;
        source.metadata.inputSnapshot = freezeCanvasInput(input);
        graph = { nodes: [...nodes, source], connections: [...connections, ...links], config: source };
    }
    if (JSON.stringify(actual) !== JSON.stringify(step.actual)) throw new Error("实际参数已改变，请重新预览计划");
    graph.config.metadata = { ...graph.config.metadata, workflowStep: structuredClone(step), agentSource: step.agentSource };
    return { ...graph, input };
}

export function instantiateWorkflow(plan: WorkflowPlan, position = { x: 80, y: 80 }) {
    const ids = new Map<string, string>();
    const nodes = plan.resources.map((source, index) => {
        const node = { ...structuredClone(source), id: nanoid(), position: { x: position.x, y: position.y + index * 360 } };
        ids.set(source.id, node.id);
        return node;
    });
    const configs = plan.steps.map((step, index) => {
        const node = workflowConfigNode(step, { x: position.x + 456 + index * 456, y: position.y + 160 });
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
        results.some((node) => node.type !== step.mode || node.metadata?.status !== "success" || !node.metadata.content || (step.action ? !node.metadata.storageKey || node.metadata.pluginActionRequestId !== state.requestId : step.source === "codex" ? !node.metadata.storageKey || Boolean(state.requestId && node.metadata.agentMediaRequestId !== state.requestId) : ((step.mode === "image" ? node.metadata.images : step.mode === "text" ? node.metadata.texts : undefined)?.filter((item) => item.status === "success" && item.content).length ?? (step.mode === "image" || step.mode === "text" ? 0 : 1)) < step.calls))
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
