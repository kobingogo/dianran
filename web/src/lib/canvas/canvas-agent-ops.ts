import { nanoid } from "nanoid";

import i18n from "@/i18n";
import { getNodeSpec, isRegisteredNodeType } from "@/lib/canvas/node-registry";
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData, type CanvasNodeMetadata, type CanvasNodeTypeId, type ViewportTransform } from "@/types/canvas";

export type CanvasAgentOp =
    | { type: "add_node"; id?: string; nodeType?: CanvasNodeTypeId; title?: string; position?: { x: number; y: number }; x?: number; y?: number; width?: number; height?: number; metadata?: CanvasNodeMetadata }
    | { type: "update_node"; id: string; patch?: Partial<CanvasNodeData>; metadata?: CanvasNodeMetadata }
    | { type: "delete_node"; id?: string; ids?: string[]; nodeType?: CanvasNodeTypeId }
    | { type: "delete_connections"; id?: string; ids?: string[]; all?: boolean }
    | { type: "connect_nodes"; id?: string; fromNodeId: string; toNodeId: string }
    | { type: "set_viewport"; viewport: ViewportTransform }
    | { type: "select_nodes"; ids: string[] }
    | { type: "run_generation"; nodeId: string; mode?: "text" | "image" | "video" | "audio"; prompt?: string };

export type CanvasAgentSnapshot = {
    projectId: string;
    revision: string;
    title: string;
    nodes: CanvasNodeData[];
    connections: CanvasConnection[];
    selectedNodeIds: string[];
    viewport: ViewportTransform;
};

export type CanvasAgentTarget = { clientId: string; projectId: string; revision: string };

export function assertCanvasAgentTarget(snapshot: CanvasAgentSnapshot | null, target?: CanvasAgentTarget) {
    if (!snapshot || !target || snapshot.projectId !== target.projectId || snapshot.revision !== target.revision) throw new Error("画布或修订已改变，请重新读取并审阅操作");
}

export function summarizeCanvasAgentOps(ops?: CanvasAgentOp[]) {
    const counts = (Array.isArray(ops) ? ops : []).reduce<Record<string, number>>((acc, op) => {
        if (!op?.type) return acc;
        acc[op.type] = (acc[op.type] || 0) + 1;
        return acc;
    }, {});
    return Object.entries(counts)
        .map(([type, count]) => `${opLabel(type)} ${count}`)
        .join("，");
}

export function applyCanvasAgentOps(snapshot: CanvasAgentSnapshot, ops?: CanvasAgentOp[]) {
    let nodes = snapshot.nodes;
    let connections = snapshot.connections;
    let selectedNodeIds = snapshot.selectedNodeIds;
    let viewport = snapshot.viewport;

    if (!Array.isArray(ops) || !ops.length) throw new Error("操作列表不能为空");
    const finite = (value: unknown) => typeof value === "number" && Number.isFinite(value);
    const positionValid = (value: unknown) => Boolean(value && typeof value === "object" && finite((value as { x: unknown }).x) && finite((value as { y: unknown }).y));
    const requireNode = (id: string) => { const node = nodes.find((node) => node.id === id); if (!node) throw new Error(`节点不存在：${id}`); return node; };
    const requireIds = (ids: string[]) => { if (!Array.isArray(ids) || !ids.length || ids.some((id) => typeof id !== "string" || !id.trim()) || new Set(ids).size !== ids.length) throw new Error("节点身份为空或重复"); ids.forEach(requireNode); };
    const validId = (id: unknown): id is string => typeof id === "string" && Boolean(id.trim());
    const metadataValid = (value: unknown) => value === undefined || validAgentMetadata(value);
    const imageSize = (node: CanvasNodeData, width: number, height: number) => {
        if (node.type !== CanvasNodeType.Image || node.metadata?.freeResize) return { width, height };
        const naturalWidth = node.metadata?.naturalWidth || node.width, naturalHeight = node.metadata?.naturalHeight || node.height;
        const scale = Math.min(width / naturalWidth, height / naturalHeight);
        return { width: naturalWidth * scale, height: naturalHeight * scale };
    };
    ops.forEach((op, index) => {
        if (!op?.type) throw new Error("操作类型缺失");
        if (op.type === "add_node") {
            const nodeType = op.nodeType || CanvasNodeType.Text;
            if (!isRegisteredNodeType(nodeType)) throw new Error(`不支持的节点类型：${nodeType}`);
            const spec = getNodeSpec(nodeType);
            if ((op.id !== undefined && (!validId(op.id) || nodes.some((node) => node.id === op.id) || connections.some((connection) => connection.id === op.id))) || (op.title !== undefined && typeof op.title !== "string") || (op.position !== undefined && !positionValid(op.position)) || [op.x, op.y].some((value) => value !== undefined && !finite(value)) || [op.width, op.height].some((value) => value !== undefined && (!finite(value) || value <= 0)) || !metadataValid(op.metadata)) throw new Error("节点身份、尺寸、位置或元数据无效");
            const node: CanvasNodeData = {
                id: op.id || nanoid(),
                type: nodeType,
                title: op.title || spec.title,
                position: op.position || { x: op.x ?? index * 36, y: op.y ?? index * 36 },
                width: op.width || spec.width,
                height: op.height || spec.height,
                metadata: { ...spec.metadata, ...op.metadata },
            };
            Object.assign(node, imageSize(node, node.width, node.height));
            nodes = [...nodes, node];
            selectedNodeIds = [node.id];
        }
        if (op.type === "update_node") {
            requireNode(op.id);
            const patch = op.patch === undefined ? {} : op.patch;
            if (!patch || typeof patch !== "object" || Array.isArray(patch)) throw new Error("节点修改字段或内容无效");
            if (Object.keys(patch).some((key) => !["title", "position", "width", "height", "metadata"].includes(key)) || (patch.position !== undefined && !positionValid(patch.position)) || [patch.width, patch.height].some((value) => value !== undefined && (!finite(value) || value <= 0)) || !metadataValid(patch.metadata) || !metadataValid(op.metadata) || (patch.title !== undefined && typeof patch.title !== "string")) throw new Error("节点修改字段或内容无效");
            nodes = nodes.map((node) => {
                if (node.id !== op.id) return node;
                const next = { ...node, ...patch, metadata: { ...node.metadata, ...patch.metadata, ...op.metadata } };
                if (patch.width !== undefined || patch.height !== undefined) {
                    // 单边修改按原图比例推导另一边；双边尺寸作为等比缩放的边界框。
                    const ratio = (next.metadata.naturalWidth || node.width) / (next.metadata.naturalHeight || node.height);
                    const width = patch.width ?? (patch.height !== undefined && node.type === CanvasNodeType.Image && !next.metadata.freeResize ? patch.height * ratio : node.width);
                    const height = patch.height ?? (patch.width !== undefined && node.type === CanvasNodeType.Image && !next.metadata.freeResize ? patch.width / ratio : node.height);
                    Object.assign(next, imageSize(next, width, height));
                }
                return next;
            });
        }
        if (op.type === "delete_node") {
            if (op.id !== undefined && !validId(op.id)) throw new Error("节点身份无效");
            if (op.nodeType !== undefined && !isRegisteredNodeType(op.nodeType)) throw new Error("节点类型无效");
            if ([op.ids !== undefined, op.id !== undefined, op.nodeType !== undefined].filter(Boolean).length !== 1) throw new Error("请选择一种删除目标");
            const targets = op.ids ?? (op.id ? [op.id] : nodes.filter((node) => node.type === op.nodeType).map((node) => node.id));
            requireIds(targets);
            const ids = new Set(targets);
            nodes = nodes.filter((node) => !ids.has(node.id));
            connections = connections.filter((conn) => !ids.has(conn.fromNodeId) && !ids.has(conn.toNodeId));
            selectedNodeIds = selectedNodeIds.filter((id) => !ids.has(id));
        }
        if (op.type === "delete_connections") {
            const targets = op.ids ?? (op.id ? [op.id] : []);
            if (op.all !== undefined && typeof op.all !== "boolean") throw new Error("连线删除范围无效");
            if ([Boolean(op.all), op.ids !== undefined, op.id !== undefined].filter(Boolean).length !== 1 || !Array.isArray(targets) || targets.some((id) => !validId(id)) || new Set(targets).size !== targets.length) throw new Error("连线身份为空、重复或删除范围冲突");
            const ids = new Set(targets);
            if (!op.all && (!ids.size || [...ids].some((id) => !connections.some((connection) => connection.id === id)))) throw new Error("连线不存在");
            connections = op.all ? [] : connections.filter((conn) => !ids.has(conn.id));
        }
        if (op.type === "connect_nodes") {
            requireNode(op.fromNodeId); requireNode(op.toNodeId);
            if (op.fromNodeId === op.toNodeId || (op.id !== undefined && (!validId(op.id) || connections.some((connection) => connection.id === op.id) || nodes.some((node) => node.id === op.id)))) throw new Error("连线身份或端点无效");
            const exists = connections.some((conn) => conn.fromNodeId === op.fromNodeId && conn.toNodeId === op.toNodeId);
            const hasNodes = nodes.some((node) => node.id === op.fromNodeId) && nodes.some((node) => node.id === op.toNodeId);
            if (exists) throw new Error("连线已存在");
            if (hasNodes) connections = [...connections, { id: op.id || nanoid(), fromNodeId: op.fromNodeId, toNodeId: op.toNodeId, kind: "input" }];
        }
        if (op.type === "set_viewport") { if (!positionValid(op.viewport) || !finite(op.viewport.k) || op.viewport.k <= 0) throw new Error("视口无效"); viewport = op.viewport; }
        if (op.type === "select_nodes") { if (!Array.isArray(op.ids)) throw new Error("选择节点列表无效"); if (op.ids.length) requireIds(op.ids); selectedNodeIds = op.ids; }
        if (op.type === "run_generation") { requireNode(op.nodeId); if ((op.prompt !== undefined && typeof op.prompt !== "string") || (op.mode !== undefined && !["text", "image", "video", "audio"].includes(op.mode))) throw new Error("生成模式无效"); }
        if (!["add_node", "update_node", "delete_node", "delete_connections", "connect_nodes", "set_viewport", "select_nodes", "run_generation"].includes(op.type)) throw new Error("未知操作类型");
    });

    const generationIds = ops.filter((op) => op.type === "run_generation").map((op) => op.nodeId);
    if (new Set(generationIds).size !== generationIds.length) throw new Error("同一批次不能重复提交同一节点生成");
    generationIds.forEach(requireNode);
    return { ...snapshot, nodes, connections, selectedNodeIds, viewport };
}

function opLabel(type: string) {
    return i18n.t(`canvas.agentOps.${type}`, { defaultValue: type });
}

/** Agent 只修改已知业务字段，复杂创作快照与产物来源由对应业务入口写入。 */
function validAgentMetadata(value: unknown): boolean {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const finite = (number: unknown) => typeof number === "number" && Number.isFinite(number);
    const strings = new Set("codexModel sourceResultId sourceNodeId sourceConfigId versionOf resultTargetId content composerContent prompt systemPrompt errorDetails model size quality background primaryTextId seconds vquality generateAudio watermark videoMode audioVoice audioFormat audioSpeed audioInstructions primaryImageId storageKey mimeType videoTaskId videoTaskEndpoint groupId".split(" "));
    const positive = new Set(["fontSize", "count", "textCount"]);
    const nonnegative = new Set(["naturalWidth", "naturalHeight", "bytes", "durationMs"]);
    const booleans = new Set(["inputChanged", "freeResize", "interactive"]);
    const arrays = new Set(["inputNodeIds", "draftReferenceIds", "references"]);
    const enums: Record<string, string[]> = { status: ["idle", "success", "loading", "error"], generationMode: ["text", "image", "video", "audio"], generationType: ["generation", "edit"], reasoningEffort: ["auto", "low", "medium", "high", "xhigh"], branchKind: ["regenerate", "edit", "video"], videoTaskProvider: ["openai", "gemini"] };
    return Object.entries(value).every(([key, entry]) => {
        if (key === "generationSource") return entry === "api" || entry === "codex";
        if (key === "pluginActionParameters") return Boolean(entry && typeof entry === "object" && !Array.isArray(entry) && Object.values(entry).every((value) => typeof value === "string" || typeof value === "boolean" || finite(value)));
        if (strings.has(key)) return typeof entry === "string";
        if (positive.has(key)) return finite(entry) && (entry as number) > 0 && (key === "fontSize" || Number.isInteger(entry));
        if (nonnegative.has(key)) return finite(entry) && (entry as number) >= 0;
        if (booleans.has(key)) return typeof entry === "boolean";
        if (arrays.has(key)) return Array.isArray(entry) && entry.every((item) => typeof item === "string") && new Set(entry).size === entry.length;
        if (enums[key]) return typeof entry === "string" && enums[key].includes(entry);
        if (key !== "images" && key !== "texts") return false;
        if (!Array.isArray(entry) || new Set(entry.map((item) => item?.id)).size !== entry.length) return false;
        return entry.every((item) => item && typeof item === "object" && typeof item.id === "string" && item.id.trim() && typeof item.content === "string" && enums.status.includes(item.status) && Object.keys(item).every((field) => ["id", "status", "content", "errorDetails", ...(key === "images" ? ["storageKey", "naturalWidth", "naturalHeight", "bytes", "mimeType"] : [])].includes(field)) && (item.errorDetails === undefined || typeof item.errorDetails === "string") && (key === "texts" || (finite(item.naturalWidth) && item.naturalWidth >= 0 && finite(item.naturalHeight) && item.naturalHeight >= 0 && finite(item.bytes) && item.bytes >= 0 && typeof item.mimeType === "string" && (item.storageKey === undefined || typeof item.storageKey === "string"))));
    });
}
