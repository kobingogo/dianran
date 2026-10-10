import { fetchAgentMediaArtifact, fetchAgentMediaTasks, type MediaTask } from "@/services/api/local-agent-media";
import { uploadImage } from "@/services/image-storage";
import { imageMetadata } from "@/lib/canvas/canvas-node-factory";
import { fitNodeSize } from "@/lib/canvas/canvas-node-size";
import { assertBusinessWriter, businessOperation } from "@/lib/write-ownership";
import { useCanvasStore, flushCanvasSave } from "@/stores/canvas/use-canvas-store";
import { useAgentStore } from "@/stores/use-agent-store";
import { recordAgentMediaImport, recordAgentMediaTask, recordAgentMediaSaveError, useAgentMediaStore } from "@/stores/use-agent-media-store";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

/** 原任务 + opaque 产物身份决定节点身份；保存失败仅重新导入，不重新生成。 */
const importFlights = new Map<string, Promise<void>>();
const importTask = businessOperation(async (task: MediaTask, endpoint: string, token: string) => {
    assertBusinessWriter();
    if (task.status !== "completed" || !task.native || !task.artifacts.length) throw new Error("原任务尚未完成或缺少产物来源，请查询原任务");
    const projectId = task.request.projectId;
    if (!useCanvasStore.getState().openProject(projectId)) throw new Error("原任务画布已删除，未写入其他画布；请先恢复原画布");
    await recordAgentMediaTask(task);
    const target = useAgentMediaStore.getState().intents[task.request.requestId]?.canvasTarget;
    for (const [index, artifact] of task.artifacts.entries()) {
        assertBusinessWriter();
        const nodeId = index === 0 && target?.projectId === projectId ? target.nodeId : `agent-media:${task.id}:${artifact.id}`;
        const active = useAgentStore.getState().canvasContext;
        const project = useCanvasStore.getState().openProject(projectId);
        const existing = (active?.getSnapshot().projectId === projectId ? active.getSnapshot().nodes : project?.nodes)?.find((node) => node.id === nodeId);
        const placeholder = existing?.type === CanvasNodeType.Image && !existing.metadata?.content && existing.metadata?.agentMediaRequestId === task.request.requestId;
        if (existing && !placeholder) {
            if (existing.type !== CanvasNodeType.Image || !existing.metadata?.storageKey || existing.metadata.agentSource?.threadId !== task.native.threadId || existing.metadata.agentSource?.turnId !== task.native.turnId || existing.metadata.agentSource?.itemId !== artifact.itemId) throw new Error("产物节点身份冲突，原画布未覆盖，请保留原任务");
            await flushCanvasSave();
            await recordAgentMediaImport(task, artifact.id, { storageKey: existing.metadata.storageKey, nodeId });
            continue;
        }
        if (artifact.kind !== "image" || artifact.contentType !== "image/png") throw new Error("当前导入入口只支持已验证 PNG 图片，不会重新生成");
        const blob = await fetchAgentMediaArtifact(endpoint, token, projectId, task.id, artifact.id);
        const bytes = new Uint8Array(await blob.arrayBuffer());
        const sha256 = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map((value) => value.toString(16).padStart(2, "0")).join("");
        if (blob.size !== artifact.bytes || sha256 !== artifact.sha256 || bytes.length < 8 || ![137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value)) throw new Error("产物完整性校验失败，未导入，请保留并查询原任务");
        const image = await uploadImage(new Blob([bytes], { type: "image/png" }));
        if (!image.storageKey) throw new Error("原图未保存，请重试导入原任务");
        assertBusinessWriter();
        // 下载期间用户可以编辑或切换项目，因此此处重新读取当前状态。
        const currentContext = useAgentStore.getState().canvasContext;
        const currentProject = useCanvasStore.getState().openProject(projectId);
        if (!currentProject) throw new Error("原任务画布已删除；原图已保留，未写入其他画布");
        const currentNodes = currentContext?.getSnapshot().projectId === projectId ? currentContext.getSnapshot().nodes : currentProject.nodes;
        const node: CanvasNodeData = { id: nodeId, type: CanvasNodeType.Image, title: "Codex 生成图片", position: currentNodes.find((item) => item.id === nodeId)?.position || { x: Math.max(0, ...currentNodes.map((item) => item.position.x + item.width)) + 40, y: 0 }, ...fitNodeSize(image.width, image.height), metadata: { ...currentNodes.find((item) => item.id === nodeId)?.metadata, ...imageMetadata(image), errorDetails: undefined, generationTaskId: `agent:${task.request.requestId}`, agentMediaRequestId: task.request.requestId, model: task.request.codexModel, prompt: task.request.prompt, agentSource: { ...task.native, itemId: artifact.itemId } } };
        if (currentContext?.getSnapshot().projectId === projectId) {
            await currentContext.importMediaNodes([node]);
        } else {
            useCanvasStore.getState().updateProject(projectId, { nodes: [...currentProject.nodes.filter((item) => item.id !== nodeId), node] });
            await flushCanvasSave();
        }
        await recordAgentMediaImport(task, artifact.id, { storageKey: image.storageKey, nodeId });
    }
});

export async function importAgentMedia(task: MediaTask, endpoint: string, token: string) {
    assertBusinessWriter();
    const existing = importFlights.get(task.id);
    if (existing) return existing;
    const operation = importTask(task, endpoint, token).catch(async (error) => { await recordAgentMediaSaveError(task, error instanceof Error ? error.message : String(error)); throw error; }).finally(() => importFlights.delete(task.id));
    importFlights.set(task.id, operation);
    return operation;
}

/** 查询和保存原请求，不提交新的生成。 */
export async function recoverAgentMedia(requestId: string, endpoint: string, token: string) {
    const intent = useAgentMediaStore.getState().intents[requestId];
    if (!intent) throw new Error("原任务记录不可读取，请保留当前画布");
    const task = (await fetchAgentMediaTasks(endpoint, token, intent.projectId)).data.find((item) => item.request.requestId === requestId);
    if (!task) throw new Error("本机未找到原请求，请先确认任务是否提交；未重新生成");
    await recordAgentMediaTask(task);
    if (task.status === "completed") await importAgentMedia(task, endpoint, token);
    return task;
}
