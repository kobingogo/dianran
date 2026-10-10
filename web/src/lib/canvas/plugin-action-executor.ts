import localforage from "localforage";
import { STORAGE_NS } from "@/constant/brand";
import { businessOperation } from "@/lib/write-ownership";
import { getImageBlob, uploadImage, type UploadedImage } from "@/services/image-storage";
import { useAgentStore } from "@/stores/use-agent-store";
import { useCanvasStore, flushCanvasSave } from "@/stores/canvas/use-canvas-store";
import { beginCreationTask, updateCreationTask, flushTaskSave } from "@/features/tasks/task-store";
import { imageMetadata } from "./canvas-node-factory";
import { fitNodeSize } from "./canvas-node-size";
import { resolvePluginAction, type WorkflowPluginAction } from "./plugin-actions";
import type { CanvasNodeData } from "@/types/canvas";

type ActionReceipt = { id: string; projectId: string; nodeIds: string[]; action: WorkflowPluginAction; inputs: CanvasNodeData[]; files?: { blob: Blob; sha256: string }[]; saved: UploadedImage[]; status: "processing" | "ready" | "done" | "failed" };
const storage = localforage.createInstance({ name: STORAGE_NS, storeName: "plugin_action_tasks" });
const saves = new Map<string, Promise<void>>();
const interrupted = (message: string) => Object.assign(new Error(message), { interrupted: true });

async function saveOutputs(receipt: ActionReceipt) {
    if (!receipt.files && receipt.status !== "done") throw interrupted("处理未完成或页面曾刷新，请审阅后发起新的处理；不会自动重新执行");
    try {
        for (const [index, nodeId] of receipt.nodeIds.entries()) {
            const project = useCanvasStore.getState().openProject(receipt.projectId);
            if (!project) throw new Error("原画布已删除，请恢复原画布后重新保存");
            const context = useAgentStore.getState().canvasContext;
            const nodes = context?.getSnapshot().projectId === receipt.projectId ? context.getSnapshot().nodes : project.nodes;
            const target = nodes.find((node) => node.id === nodeId);
            if (!target || target.type !== "image" || target.metadata?.pluginActionRequestId !== receipt.id) throw new Error("结果节点已删除或身份改变，未覆盖其他作品");
            if (target.metadata.content && target.metadata.storageKey !== receipt.saved[index]?.storageKey) throw new Error("结果节点已有其他作品，未覆盖");
            if (!receipt.saved[index]) {
                const file = receipt.files![index];
                const digest = [...new Uint8Array(await crypto.subtle.digest("SHA-256", await file.blob.arrayBuffer()))].map((byte) => byte.toString(16).padStart(2, "0")).join("");
                if (digest !== file.sha256) throw new Error("处理文件完整性校验失败，请保留原处理记录");
                receipt.saved[index] = await uploadImage(file.blob);
                if (!receipt.saved[index].storageKey) throw new Error("处理结果原文件尚未保存");
                await storage.setItem(receipt.id, receipt);
            }
            // Re-read after file writes so later user edits and project switches are preserved.
            const live = useAgentStore.getState().canvasContext;
            const current = useCanvasStore.getState().openProject(receipt.projectId);
            if (!current) throw new Error("原画布已删除，处理文件已保留");
            const currentNodes = live?.getSnapshot().projectId === receipt.projectId ? live.getSnapshot().nodes : current.nodes;
            const currentTarget = currentNodes.find((node) => node.id === nodeId);
            if (!currentTarget || currentTarget.metadata?.pluginActionRequestId !== receipt.id || (currentTarget.metadata.content && currentTarget.metadata.storageKey !== receipt.saved[index].storageKey)) throw new Error("保存期间结果节点发生变化，处理文件已保留");
            const node = { ...currentTarget, ...fitNodeSize(receipt.saved[index].width, receipt.saved[index].height), metadata: { ...currentTarget.metadata, ...imageMetadata(receipt.saved[index]), errorDetails: undefined } };
            if (live?.getSnapshot().projectId === receipt.projectId) await live.importMediaNodes([node]);
            else { useCanvasStore.getState().updateProject(receipt.projectId, { nodes: currentNodes.map((item) => item.id === nodeId ? node : item) }); await flushCanvasSave(); }
        }
        receipt.status = "done"; delete receipt.files;
        await storage.setItem(receipt.id, receipt);
        updateCreationTask(`plugin:${receipt.id}`, { phase: "done", saveState: "saved", saveError: undefined });
        await flushTaskSave();
    } catch (error) {
        updateCreationTask(`plugin:${receipt.id}`, { phase: "done", saveState: "error", saveError: error instanceof Error ? error.message : String(error) });
        throw interrupted("处理文件已保留，请在结果节点重新保存；不会再次处理原图");
    }
}

export const recoverPluginAction = businessOperation(async (requestId: string) => {
    const existing = saves.get(requestId);
    if (existing) return existing;
    const operation = (async () => {
        const receipt = await storage.getItem<ActionReceipt>(requestId);
        if (!receipt) throw new Error("原处理记录不存在，请保留当前作品");
        await saveOutputs(receipt);
    })().finally(() => saves.delete(requestId));
    saves.set(requestId, operation);
    return operation;
});

export const executePluginWorkflow = businessOperation(async (action: WorkflowPluginAction, target: { requestId: string; projectId: string; nodeIds: string[] }, inputs: CanvasNodeData[]) => {
    if (await storage.getItem(target.requestId)) throw interrupted("已有原处理任务，请重新保存原结果，勿自动重复处理");
    const processor = resolvePluginAction(action);
    const receipt: ActionReceipt = { id: target.requestId, projectId: target.projectId, nodeIds: target.nodeIds, action, inputs: structuredClone(inputs), saved: [], status: "processing" };
    await storage.setItem(receipt.id, receipt);
    const taskId = beginCreationTask({ id: `plugin:${receipt.id}`, source: "plugin", host: "本地素材处理", kind: "image", model: processor.title, summary: processor.description, sourcePath: `/canvas/${receipt.projectId}`, nodeId: receipt.nodeIds[0] });
    await flushTaskSave();
    let outputsPersisted = false;
    try {
        const images = await Promise.all(inputs.map(async (node) => { const blob = await getImageBlob(node.metadata?.storageKey || ""); if (!blob) throw new Error("输入原图文件缺失，未执行处理"); return blob; }));
        updateCreationTask(taskId, { phase: "generating" });
        const output = await processor.execute(images, action.parameters, (summary) => updateCreationTask(taskId, { summary }));
        if (output.length !== receipt.nodeIds.length || output.some((blob) => !(blob instanceof Blob) || !blob.size || !blob.type.startsWith("image/"))) throw new Error("插件结果不符合每张输入对应一张图片的契约");
        receipt.files = await Promise.all(output.map(async (blob) => ({ blob, sha256: [...new Uint8Array(await crypto.subtle.digest("SHA-256", await blob.arrayBuffer()))].map((byte) => byte.toString(16).padStart(2, "0")).join("") })));
        receipt.status = "ready";
        await storage.setItem(receipt.id, receipt); // Durable output before canvas/file saving; recovery never re-executes the plugin.
        outputsPersisted = true;
        updateCreationTask(taskId, { phase: "done", saveState: "saving" });
        await recoverPluginAction(receipt.id);
    } catch (error) {
        if (!outputsPersisted) {
            updateCreationTask(taskId, { phase: receipt.files ? "done" : "failed", error: receipt.files ? undefined : error instanceof Error ? error.message : String(error), saveState: receipt.files ? "error" : undefined, saveError: receipt.files ? "处理输出保存失败，请检查本地存储；不会自动重复执行" : undefined });
            receipt.status = "failed";
            try { await storage.setItem(receipt.id, receipt); } catch { /* Keep the original intent; never report failed persistence as saved. */ }
        }
        if (receipt.files && !outputsPersisted) throw interrupted("处理已完成但输出保存失败，请检查本地存储；不会自动重复执行");
        throw error;
    }
});
