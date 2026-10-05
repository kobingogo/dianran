import { nanoid } from "nanoid";
import { buildNodeGenerationContext, type NodeGenerationContext } from "@/components/canvas/canvas-node-generation";
import { createComposerSubmission, creationSnapshot, uniqueReferences, type ComposerMode, type ComposerSubmission } from "@/lib/composer";
import { createCanvasNode } from "@/lib/canvas/canvas-node-factory";
import { fitNodeSize } from "@/lib/canvas/canvas-node-size";
import { resolveModelRequestConfig, resolveModelScript, type AiConfig } from "@/stores/use-config-store";
import type { ReferenceImage } from "@/types/image";
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData, type Position } from "@/types/canvas";

import { canvasReferenceIds } from "./canvas-composer-references";
export { canvasReferenceIds } from "./canvas-composer-references";
export type CanvasSubmission = ComposerSubmission & { input: NodeGenerationContext; composerContent: string; inputNodeIds: string[]; materials: CanvasNodeData[] };

export function prepareCanvasSubmission(mode: ComposerMode, prompt: string, attachments: ReferenceImage[], config: AiConfig, nodes: CanvasNodeData[], nodeIds: string[] = []): CanvasSubmission {
    const materials: CanvasNodeData[] = [];
    let composerContent = prompt;
    for (const id of nodeIds) if (!composerContent.includes("@[node:" + id + "]")) composerContent += " @[node:" + id + "]";
    for (const ref of uniqueReferences(attachments)) {
        let node = nodes.find((node) => node.type === CanvasNodeType.Image && (ref.storageKey ? ref.storageKey === node.metadata?.storageKey : ref.dataUrl === node.metadata?.content));
        if (!node) {
            node = createCanvasNode(CanvasNodeType.Image, { x: 0, y: 0 }, { content: ref.dataUrl, storageKey: ref.storageKey, mimeType: ref.type, status: "success" });
            node.title = ref.name;
            materials.push(node);
        }
        const token = "@[node:" + node.id + "]";
        composerContent = composerContent.replaceAll("@[ref:" + ref.id + "]", token);
        if (!composerContent.includes(token)) composerContent += " " + token;
    }
    if (/@\[ref:/.test(composerContent)) throw new Error("附件引用已失效，请移除或重新添加");
    const inputNodeIds = canvasReferenceIds(composerContent);
    const source = createCanvasNode(CanvasNodeType.Config, { x: 0, y: 0 }, { composerContent });
    const connections = inputNodeIds.map((fromNodeId) => ({ id: nanoid(), fromNodeId, toNodeId: source.id, kind: "input" as const }));
    const input = buildNodeGenerationContext(source.id, [...nodes, ...materials, source], connections, composerContent);
    if (mode === "image" && (input.referenceVideos.length || input.referenceAudios.length)) throw new Error("生图当前支持图片和文字参考，请移除视频或音频引用");
    if (mode === "video" && !resolveModelScript(config, config.videoModel) && resolveModelRequestConfig(config, config.videoModel).apiFormat === "gemini" && (input.referenceVideos.length > 1 || input.referenceAudios.length > 1)) throw new Error("当前 Gemini 视频适配器仅发送一个视频和一个音频，请移除多余引用或配置支持它们的调用脚本");
    const submission = createComposerSubmission(mode, input.prompt, input.referenceImages, config, false, 15);
    input.prompt = submission.prompt;
    input.referenceImages = submission.references;
    return { ...submission, input, composerContent, inputNodeIds, materials };
}

/** Frozen inputs retain file identities; hydrate from IndexedDB at execution time. */
export function freezeCanvasInput(input: NodeGenerationContext): NodeGenerationContext {
    return {
        ...input,
        referenceImages: input.referenceImages.map((ref) => ({ ...ref, dataUrl: ref.storageKey ? "" : ref.dataUrl })),
        referenceVideos: input.referenceVideos.map((ref) => ({ ...ref, url: ref.storageKey ? "" : ref.url })),
        referenceAudios: input.referenceAudios.map((ref) => ({ ...ref, url: ref.storageKey ? "" : ref.url })),
    };
}

export function createCanvasSubmissionGraph(submission: CanvasSubmission, nodes: CanvasNodeData[], connections: CanvasConnection[], position: Position, target?: CanvasNodeData, branchKind?: "regenerate" | "edit" | "video") {
    const p = submission.parameters;
    const fill = target && (target.type === CanvasNodeType.Image || target.type === CanvasNodeType.Video) && !target.metadata?.content && !target.metadata?.videoTaskId && target.type === (submission.mode === "image" ? CanvasNodeType.Image : CanvasNodeType.Video);
    const metadata = {
        composerContent: submission.composerContent, prompt: submission.prompt, generationMode: submission.mode,
        model: submission.mode === "image" ? p.imageModel : p.videoModel,
        size: submission.mode === "image" ? p.size : p.videoSize, quality: p.quality, background: p.background, count: Number(p.count),
        seconds: p.videoSeconds, vquality: p.vquality, generateAudio: p.videoGenerateAudio, watermark: p.videoWatermark, videoMode: p.videoMode,
        creation: creationSnapshot(submission), inputSnapshot: freezeCanvasInput(submission.input), inputNodeIds: submission.inputNodeIds, draftReferenceIds: submission.inputNodeIds,
        sourceNodeId: target?.type !== CanvasNodeType.Config ? target?.id : target.metadata?.sourceNodeId,
        branchKind, versionOf: branchKind === "regenerate" ? target?.id : undefined,
        resultTargetId: fill ? target.id : undefined, inputChanged: false,
    };
    const config = target?.type === CanvasNodeType.Config ? { ...target, metadata: { ...target.metadata, ...metadata } } : createCanvasNode(CanvasNodeType.Config, position, metadata);
    config.title = submission.prompt.slice(0, 32);
    const materials = submission.materials.map((node, index) => ({ ...node, position: { x: config.position.x - node.width - 96, y: config.position.y + index * (node.height + 32) } }));
    const nextNodes = [...nodes.filter((node) => node.id !== config.id), ...materials, config];
    const nextConnections = connections.filter((connection) => connection.toNodeId !== config.id || connection.kind === "generation");
    for (const fromNodeId of submission.inputNodeIds) nextConnections.push({ id: nanoid(), fromNodeId, toNodeId: config.id, kind: "input" });
    return { nodes: nextNodes, connections: nextConnections, config };
}

export function resultProvenance(source: CanvasNodeData | undefined) {
    return source?.metadata?.creation ? {
        creation: source.metadata.creation,
        inputSnapshot: source.metadata.inputSnapshot,
        inputNodeIds: source.metadata.inputNodeIds,
        sourceNodeId: source.metadata.sourceNodeId,
        sourceConfigId: source.id,
        versionOf: source.metadata.versionOf,
        branchKind: source.metadata.branchKind,
        agentSource: source.metadata.agentSource,
    } : { agentSource: source?.metadata?.agentSource };
}

export function canvasMaterialSize(node: CanvasNodeData, width: number, height: number) {
    return { ...node, ...fitNodeSize(width, height), metadata: { ...node.metadata, naturalWidth: width, naturalHeight: height } };
}

export function vacantCanvasPosition(nodes: CanvasNodeData[], position: Position, width: number, height: number) {
    let y = position.y;
    while (nodes.some((node) => node.position.x < position.x + width && node.position.x + node.width > position.x && node.position.y < y + height && node.position.y + node.height > y)) y += height + 32;
    return { x: position.x, y };
}
