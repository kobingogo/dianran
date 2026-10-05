// [dianran] Starter template canvases. Templates are plain JSON files in web/public/templates (prompts + layout only,
// no images), fetched on demand so they add nothing to the first-load bundle.
import { NODE_SPECS } from "@/constant/canvas";
import type { CanvasProject } from "@/stores/canvas/use-canvas-store";
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData, type ViewportTransform } from "@/types/canvas";

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

export function buildTemplateProject(template: CanvasTemplate, screen: { width: number; height: number }, title = template.title): Partial<CanvasProject> {
    const stamp = Date.now().toString(36);
    const ids = new Map(template.nodes.map((node, index) => [node.key, `${node.type}-${stamp}-${index}-${Math.random().toString(36).slice(2, 6)}`]));
    const mention = (text: string) => text.replace(/\{\{(\w[\w-]*)\}\}/g, (match, key: string) => (ids.has(key) ? `@[node:${ids.get(key)}]` : match));
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
                    : { ...spec.metadata, generationMode: "image", composerContent: mention(node.prompt || ""), ...(node.size ? { size: node.size } : {}), ...(node.count ? { count: node.count } : {}) },
        };
    });
    const connections: CanvasConnection[] = template.connections
        .filter(([from, to]) => ids.has(from) && ids.has(to))
        .map(([from, to], index) => ({ id: `connection-${stamp}-${index}`, fromNodeId: ids.get(from)!, toNodeId: ids.get(to)! }));
    return { title, nodes, connections, viewport: fitViewport(nodes, screen) };
}
