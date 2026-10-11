import { getImageBlob, resolveImageUrl } from "@/services/image-storage";
import { getMediaBlob, resolveMediaUrl } from "@/services/file-storage";
import type { CanvasAgentOp, CanvasAgentSnapshot } from "./canvas-agent-ops";

/** 普通 Agent 操作只能引用可恢复的本地原文件；媒体导入须先经过授权上传入口。 */
export async function validateAgentMediaWrites(before: CanvasAgentSnapshot, next: CanvasAgentSnapshot, ops: CanvasAgentOp[]) {
    const changedIds = new Set(ops.flatMap((op) => op.type === "update_node" ? [op.id] : op.type === "add_node" && op.id ? [op.id] : []));
    const original = new Map(before.nodes.map((node) => [node.id, node]));
    const mediaFields = (metadata: typeof next.nodes[number]["metadata"]) => JSON.stringify({ content: metadata?.content, storageKey: metadata?.storageKey, images: metadata?.images });
    for (const node of next.nodes) {
        if (!["image", "video", "audio"].includes(node.type)) continue;
        const previous = original.get(node.id);
        if (previous && (!changedIds.has(node.id) || mediaFields(previous.metadata) === mediaFields(node.metadata))) continue;
        const metadata = node.metadata || {};
        const entries = [{ content: metadata.content, storageKey: metadata.storageKey }, ...(metadata.images || [])];
        for (const item of entries) {
            if (!item.content && !item.storageKey) continue;
            if (!item.storageKey) throw new Error("媒体尚未保存原文件，请使用已授权的媒体导入入口");
            const blob = node.type === "image" ? await getImageBlob(item.storageKey) : await getMediaBlob(item.storageKey);
            if (!(blob instanceof Blob) || !blob.size) throw new Error(`媒体原文件缺失，不能报告已保存：${item.storageKey}`);
            if (node.type !== "image" && !blob.type.startsWith(`${node.type}/`)) throw new Error("本地原文件类型与媒体节点不一致");
            const url = node.type === "image" ? await resolveImageUrl(item.storageKey) : await resolveMediaUrl(item.storageKey);
            if (item.content && item.content !== url) throw new Error("媒体地址不属于指定原文件，请使用已授权的媒体导入入口");
        }
    }
}
