import { nanoid } from "nanoid";
import type { CreationSnapshot } from "@/lib/composer";
import { CanvasNodeType, type CanvasNodeData, type CanvasConnection } from "@/types/canvas";
import type { ReferenceImage } from "@/types/image";
import { createCanvasNode } from "./canvas-node-factory";
import { freezeCanvasInput, resultProvenance } from "./canvas-composer";

export type Deliverable = { id: string; url: string; storageKey?: string; width: number; height: number; bytes: number; mimeType?: string; creation?: CreationSnapshot };
export function appendDeliveryGraph(kind: "image" | "video", result: Deliverable, nodes: CanvasNodeData[], connections: CanvasConnection[], process = false, references: ReferenceImage[] = []) {
    const existing = nodes.find((node) => node.metadata?.sourceResultId === result.id);
    if (existing && (!process || existing.metadata?.sourceConfigId)) return { nodes, connections };
    if (process && (!result.creation || references.length !== result.creation.referenceIds.length)) throw new Error("原始创作快照或参考文件不完整，无法送入完整过程");
    const x = nodes.length ? Math.max(...nodes.map((node) => node.position.x + node.width)) + 96 : 80;
    const width = 360;
    let output: CanvasNodeData = existing || {
        id: nanoid(),
        type: kind,
        title: kind === "image" ? "生图结果" : "视频结果",
        position: { x, y: 80 },
        width,
        height: width * ((result.height || 1) / (result.width || 1)),
        metadata: {
            content: result.url,
            status: "success",
            storageKey: result.storageKey,
            naturalWidth: result.width,
            naturalHeight: result.height,
            bytes: result.bytes,
            mimeType: result.mimeType,
            prompt: result.creation?.prompt,
            model: result.creation?.parameters[kind === "image" ? "imageModel" : "videoModel"],
            creation: result.creation,
            sourceResultId: result.id,
        },
    };
    if (!process) return { nodes: [...nodes, output], connections };
    const creation = result.creation!;
    const materials: CanvasNodeData[] = [];
    const inputs = references.map((ref, index) => {
        const reused = nodes.find((node) => node.type === CanvasNodeType.Image && (ref.storageKey ? node.metadata?.storageKey === ref.storageKey : node.metadata?.content === ref.dataUrl));
        const node = reused || createCanvasNode(CanvasNodeType.Image, { x, y: 80 + index * 360 }, { content: ref.dataUrl, storageKey: ref.storageKey, mimeType: ref.type, status: "success" });
        if (!reused) {
            node.title = ref.name;
            materials.push(node);
        }
        return node;
    });
    const p = creation.parameters;
    let composerContent = creation.composerContent || creation.prompt;
    references.forEach((ref, index) => {
        composerContent = composerContent.replaceAll(`@[ref:${ref.id}]`, `@[node:${inputs[index].id}]`);
    });
    inputs.forEach((node) => {
        if (!composerContent.includes(`@[node:${node.id}]`)) composerContent += ` @[node:${node.id}]`;
    });
    const inputSnapshot = freezeCanvasInput({ prompt: creation.prompt, referenceImages: references, referenceVideos: [], referenceAudios: [], textCount: 0, imageCount: references.length, videoCount: 0, audioCount: 0 });
    const config = createCanvasNode(
        CanvasNodeType.Config,
        { x: x + (inputs.length ? 456 : 0), y: 80 },
        {
            creation,
            inputSnapshot,
            composerContent,
            prompt: creation.prompt,
            generationMode: kind,
            model: p[kind === "image" ? "imageModel" : "videoModel"],
            size: kind === "image" ? p.size : p.videoSize,
            quality: p.quality,
            background: p.background,
            count: Number(p.count),
            seconds: p.videoSeconds,
            vquality: p.vquality,
            generateAudio: p.videoGenerateAudio,
            watermark: p.videoWatermark,
            videoMode: p.videoMode,
            inputNodeIds: inputs.map((node) => node.id),
            draftReferenceIds: inputs.map((node) => node.id),
            status: "success",
        },
    );
    config.title = creation.prompt.slice(0, 32);
    output = { ...output, position: { x: config.position.x + config.width + 96, y: 80 }, metadata: { ...output.metadata, ...resultProvenance(config) } };
    return {
        nodes: [...nodes.filter((node) => node.id !== output.id), ...materials, config, output],
        connections: [...connections, ...inputs.map((node) => ({ id: nanoid(), fromNodeId: node.id, toNodeId: config.id, kind: "input" as const })), { id: nanoid(), fromNodeId: config.id, toNodeId: output.id, kind: "generation" as const }],
    };
}
