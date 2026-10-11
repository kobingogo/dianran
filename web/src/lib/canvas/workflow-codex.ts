import { useAgentStore } from "@/stores/use-agent-store";
import { recordAgentMediaIntent, recordAgentMediaTask, useAgentMediaStore } from "@/stores/use-agent-media-store";
import { beginCreationTask, flushTaskSave, updateCreationTask } from "@/features/tasks/task-store";
import { flushCanvasSave } from "@/stores/canvas/use-canvas-store";
import { fetchAgentMediaCapabilities, fetchAgentMediaModels, submitAgentMedia, type MediaRequest } from "@/services/api/local-agent-media";
import { postState } from "@/services/api/canvas-agent";
import { acquireAgentClientId } from "@/lib/agent/agent-client-id";
import { importAgentMedia } from "@/lib/agent/import-agent-media";
import { businessOperation } from "@/lib/write-ownership";
import { uniqueReferences } from "@/lib/composer";
import type { NodeGenerationContext } from "@/components/canvas/canvas-node-generation";
import { workflowModel, type WorkflowStep } from "./workflow";

const interrupted = (message: string) => Object.assign(new Error(message), { interrupted: true });

/** Subscribe to existing Agent events; no timeout or automatic resubmission. */
function observeAgent(check: () => Promise<boolean>) {
    return new Promise<void>((resolve, reject) => {
        let checking = false, again = false, done = false;
        const finish = (error?: unknown) => { done = true; offAgent(); offMedia(); error ? reject(error) : resolve(); };
        const inspect = async () => {
            if (done) return;
            if (checking) { again = true; return; }
            checking = true;
            try { await Promise.resolve(); if (await check()) finish(); }
            catch (error) { finish(error); }
            finally { checking = false; if (again && !done) { again = false; void inspect(); } }
        };
        const offAgent = useAgentStore.subscribe(() => void inspect());
        const offMedia = useAgentMediaStore.subscribe(() => void inspect());
        void inspect();
    });
}

export const executeCodexWorkflow = businessOperation(async (step: WorkflowStep, input: NodeGenerationContext, target: { projectId: string; nodeId: string; requestId: string }) => {
    const { url, token } = useAgentStore.getState();
    const context = useAgentStore.getState().canvasContext;
    const connection = () => {
        const agent = useAgentStore.getState();
        if (!agent.connected || agent.url !== url || agent.token !== token || agent.canvasContext?.getSnapshot().projectId !== target.projectId) throw interrupted("本机连接或目标画布已改变，请查询原任务后恢复工作流");
        return agent;
    };
    connection();
    // A native turn can finish importing its image before the conversation becomes idle.
    await observeAgent(async () => { const agent = connection(); return !agent.sending && !agent.waiting && agent.conversation.status !== "running"; });
    const [capabilities, catalog] = await Promise.all([fetchAgentMediaCapabilities(url, token), fetchAgentMediaModels(url, token)]);
    connection();
    const model = workflowModel(step);
    if (!catalog.data.some((item) => item.model === model)) throw new Error("计划中的 Codex 模型已不可用，请重新预览");
    const references = uniqueReferences(input.referenceImages).map((reference) => {
        if (!reference.dataUrl.startsWith("data:image/")) throw new Error("参考图原文件不可用，未提交生成");
        return { id: reference.id, name: reference.name, dataUrl: reference.dataUrl };
    });
    const capability = references.length ? "image-edit" : "text-to-image";
    const availability = capabilities.data.find((item) => item.agentId === "codex")?.capabilities[capability];
    if (!availability || availability === "unavailable") throw new Error("本机 Codex 当前不支持本步骤的生图能力");
    if (availability === "unverified" && !step.allowUnverified) throw new Error("本机生图能力尚未验证，请重新预览并确认本次调用");
    if (useAgentMediaStore.getState().intents[target.requestId]) throw interrupted("本步骤已有原请求，请查询原任务，勿重复提交");
    const request: MediaRequest = { requestId: target.requestId, projectId: target.projectId, revision: context!.getSnapshot().revision, agentId: "codex", capability, codexModel: model, prompt: input.prompt, references, allowUnverified: availability === "unverified" && step.allowUnverified };
    await flushCanvasSave();
    await recordAgentMediaIntent(request, { projectId: target.projectId, nodeId: target.nodeId });
    const taskId = beginCreationTask({ id: `agent:${target.requestId}`, kind: "image", model, source: "agent", summary: input.prompt, sourcePath: `/canvas/${target.projectId}`, nodeId: target.nodeId });
    let submitted = false;
    try {
        await flushTaskSave();
        const clientId = await acquireAgentClientId();
        const snapshot = connection().canvasContext!.getSnapshot();
        if (snapshot.revision !== request.revision) throw new Error("画布已改变，未提交生成，请重新预览");
        if (!await postState(url, token, clientId, snapshot)) throw new Error("画布未送达本机 Agent，未提交生成");
        if (connection().canvasContext!.getSnapshot().revision !== request.revision) throw new Error("同步期间画布已改变，未提交生成");
        submitted = true;
        await recordAgentMediaTask((await submitAgentMedia(url, token, clientId, request)).data);
        await observeAgent(async () => {
            connection();
            const receipt = Object.values(useAgentMediaStore.getState().receipts).find(({ task }) => task.request.requestId === target.requestId);
            if (!receipt) return false;
            if (receipt.task.status === "failed") throw new Error(receipt.task.error || "本机生图失败，请查询原任务");
            if (receipt.task.status === "unknown") throw interrupted("本机任务结果未知，请查询原任务，勿重复生成");
            if (receipt.error) throw interrupted(`图片尚未保存：${receipt.error}，请重新保存原任务`);
            if (receipt.task.status !== "completed") return false;
            await importAgentMedia(receipt.task, url, token);
            await flushCanvasSave();
            connection();
            return true;
        });
    } catch (error) {
        const receipt = Object.values(useAgentMediaStore.getState().receipts).find(({ task }) => task.request.requestId === target.requestId);
        if (receipt?.task.status !== "completed") updateCreationTask(taskId, { phase: receipt?.task.status === "failed" || !submitted ? "failed" : "unknown", error: error instanceof Error ? error.message : String(error) });
        if (submitted && receipt?.task.status !== "failed" && !(error as { interrupted?: boolean })?.interrupted) throw interrupted(error instanceof Error ? error.message : String(error));
        throw error;
    }
});
