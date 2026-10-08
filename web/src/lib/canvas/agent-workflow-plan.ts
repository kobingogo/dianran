import type { CanvasNodeData, CanvasConnection, CanvasGenerationMode } from "@/types/canvas";
import { CanvasNodeType } from "@/types/canvas";
import { createCanvasNode } from "./canvas-node-factory";
import { planWorkflow, workflowModelKeys } from "./workflow";
import type { AiConfig } from "@/stores/use-config-store";

export function agentWorkflowBlock(text: string) {
    return text.match(/```dianran-plan\s*\n([\s\S]*?)\n```/)?.[1];
}
export function agentWorkflowPlan(text: string, nodes: CanvasNodeData[], config: AiConfig, source: NonNullable<CanvasNodeData["metadata"]>["agentSource"]) {
    const block = agentWorkflowBlock(text);
    if (!block) throw new Error("没有完整的创作计划");
    const data = JSON.parse(block);
    const keys = (value: unknown, allowed: string[]) => {
        if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some((key) => !allowed.includes(key))) throw new Error("创作计划包含未知字段");
    };
    const stringList = (value: unknown): string[] => {
        if (value === undefined) return [];
        if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) throw new Error("依赖和引用必须是节点 ID 数组");
        return value;
    };
    keys(data, ["title", "steps"]);
    if (typeof data.title !== "string" || !Array.isArray(data.steps) || !data.steps.length) throw new Error("创作计划需要标题和步骤");
    const ids = new Map<string, string>();
    const configs: CanvasNodeData[] = data.steps.map((step: { id: string; mode: string; prompt: string; model?: string; parameters?: Record<string, string> }, index: number) => {
        keys(step, ["id", "mode", "prompt", "model", "parameters", "referenceNodeIds", "dependsOn"]);
        if (typeof step.id !== "string" || !step.id || ids.has(step.id) || !["image", "video", "text", "audio"].includes(step.mode) || typeof step.prompt !== "string" || !step.prompt.trim() || (step.model !== undefined && typeof step.model !== "string"))
            throw new Error("步骤 ID、模式或提示词无效");
        const p = step.parameters || {};
        const mode = step.mode as CanvasGenerationMode;
        const allowed = {
            image: ["size", "quality", "background", "count"], video: ["size", "seconds", "vquality", "generateAudio", "watermark", "videoMode"],
            text: ["textCount", "reasoningEffort", "systemPrompt"], audio: ["audioVoice", "audioFormat", "audioSpeed", "audioInstructions"],
        };
        keys(p, allowed[mode]);
        if (Object.values(p).some((value) => typeof value !== "string")) throw new Error("参数值必须是字符串");
        if (p.reasoningEffort && !["auto", "low", "medium", "high", "xhigh"].includes(p.reasoningEffort)) throw new Error("推理强度无效");
        const node = createCanvasNode(
            CanvasNodeType.Config,
            { x: 456 + index * 456, y: 160 },
            {
                ...p,
                count: p.count === undefined ? 1 : Number(p.count),
                textCount: p.textCount === undefined ? 1 : Number(p.textCount),
                reasoningEffort: p.reasoningEffort as AiConfig["reasoningEffort"] | undefined,
                generationMode: mode,
                model: step.model || config[workflowModelKeys[mode]],
                prompt: step.prompt,
                composerContent: step.prompt,
                agentSource: source,
            },
        );
        node.title = `步骤 ${index + 1}`;
        ids.set(step.id, node.id);
        return node;
    });
    const connections: CanvasConnection[] = [];
    data.steps.forEach((step: { referenceNodeIds?: string[]; dependsOn?: string[] }, index: number) => {
        const dependencies = stringList(step.dependsOn).map((id) => {
            const nodeId = ids.get(id);
            if (!nodeId) throw new Error("依赖步骤不存在");
            return nodeId;
        });
        const inputs = [...stringList(step.referenceNodeIds), ...dependencies];
        configs[index].metadata!.draftReferenceIds = inputs;
        inputs.forEach((fromNodeId) => connections.push({ id: `${fromNodeId}:${configs[index].id}`, fromNodeId, toNodeId: configs[index].id, kind: "input" }));
    });
    return planWorkflow(
        [...nodes, ...configs],
        connections,
        configs.map((node) => node.id),
        config,
        data.title,
    );
}
