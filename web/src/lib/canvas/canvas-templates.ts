// [dianran] Starter template canvases. Templates are plain JSON files in web/public/templates (prompts + layout only,
// no images), fetched on demand so they add nothing to the first-load bundle.
import { NODE_SPECS } from "@/constant/canvas";
import type { CanvasProject } from "@/stores/canvas/use-canvas-store";
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData, type ViewportTransform } from "@/types/canvas";
import { imageSizePresets } from "@/lib/media-size";
import type { UploadedImage } from "@/services/image-storage";

export type CanvasTemplateNode = {
    key: string;
    type: "text" | "config";
    title: string;
    x: number;
    y: number;
    w?: number;
    h?: number;
    /** Text node body. */
    content?: string;
    /** Config node prompt; `{{key}}` becomes a mention of that node. */
    prompt?: string;
    size?: string;
    count?: number;
};

export type CanvasTemplate = {
    id: string;
    title: string;
    titleEn?: string;
    description: string;
    descriptionEn?: string;
    tags: string[];
    accent: string;
    nodes: CanvasTemplateNode[];
    connections: Array<[string, string]>;
    referenceTargets?: string[];
};



/** Fit the template's bounding box into the visible canvas area. */
function fitViewport(nodes: CanvasNodeData[], screen: { width: number; height: number }): ViewportTransform {
    const left = Math.min(...nodes.map((node) => node.position.x));
    const top = Math.min(...nodes.map((node) => node.position.y));
    // Leave room on the right: generated results are placed next to each config node.
    const right = Math.max(...nodes.map((node) => node.position.x + node.width)) + 400;
    const bottom = Math.max(...nodes.map((node) => node.position.y + node.height));
    const padding = screen.width < 640 ? 24 : 96;
    const k = Math.max(0.25, Math.min(1, (screen.width - padding * 2) / (right - left), (screen.height - padding * 2 - 80) / (bottom - top)));
    return { k, x: (screen.width - (right - left) * k) / 2 - left * k, y: (screen.height - (bottom - top) * k) / 2 - top * k };
}

export function buildTemplateProject(template: CanvasTemplate, screen: { width: number; height: number }, title = template.title, reference?: UploadedImage): Partial<CanvasProject> {
    const keys = new Set(template.nodes.map((node) => node.key));
    if (!keys.size || keys.size !== template.nodes.length || template.connections.some(([from, to]) => !keys.has(from) || !keys.has(to))) throw new Error("模板节点或输入关系无效");
    if (template.referenceTargets?.length && !reference?.storageKey) throw new Error("请先上传自己的产品参考图");
    if (template.referenceTargets?.some((key) => !template.nodes.some((node) => node.key === key && node.type === "config"))) throw new Error("模板参考目标无效");
    const stamp = Date.now().toString(36);
    const ids = new Map(template.nodes.map((node, index) => [node.key, `${node.type}-${stamp}-${index}-${Math.random().toString(36).slice(2, 6)}`]));
    const mention = (text: string) => text.replace(/\{\{(\w[\w-]*)\}\}/g, (_, key: string) => { if (!ids.has(key)) throw new Error("模板引用了不存在的输入"); return `@[node:${ids.get(key)}]`; });
    const nodes: CanvasNodeData[] = template.nodes.map((node) => {
        const spec = node.type === "text" ? NODE_SPECS[CanvasNodeType.Text] : NODE_SPECS[CanvasNodeType.Config];
        return {
            id: ids.get(node.key)!,
            type: node.type === "text" ? CanvasNodeType.Text : CanvasNodeType.Config,
            title: node.title,
            position: { x: node.x, y: node.y },
            width: node.w || spec.width,
            height: node.h || spec.height,
            metadata:
                node.type === "text"
                    ? { ...spec.metadata, content: node.content || "" }
                    : { ...spec.metadata, generationMode: "image", composerContent: mention(node.prompt || ""), ...(node.size ? { size: imageSizePresets["1k"][node.size] || node.size } : {}), ...(node.count ? { count: node.count } : {}) },
        };
    });
    const connections: CanvasConnection[] = template.connections
        .filter(([from, to]) => ids.has(from) && ids.has(to))
        .map(([from, to], index) => ({ id: `connection-${stamp}-${index}`, fromNodeId: ids.get(from)!, toNodeId: ids.get(to)!, kind: "input" }));
    if (reference && template.referenceTargets?.length) {
        const id = crypto.randomUUID();
        nodes.push({ id, type: CanvasNodeType.Image, title: "自己的产品参考图", position: { x: -400, y: 0 }, width: 340, height: 340 * reference.height / reference.width,
            metadata: { content: reference.url, storageKey: reference.storageKey, naturalWidth: reference.width, naturalHeight: reference.height, bytes: reference.bytes, mimeType: reference.mimeType, status: "success" } });
        for (const key of template.referenceTargets) connections.push({ id: crypto.randomUUID(), fromNodeId: id, toNodeId: ids.get(key)!, kind: "input" });
    }
    return { title, nodes, connections, viewport: fitViewport(nodes, screen) };
}
