import localforage from "localforage";
import { create } from "zustand";
import { beginCreationTask, updateCreationTask, useTaskStore } from "@/features/tasks/task-store";
import { STORAGE_NS } from "@/constant/brand";
import { assertBusinessWriter } from "@/lib/write-ownership";
import type { MediaRequest, MediaTask } from "@/services/api/local-agent-media";
export type AgentMediaCanvasTarget = { projectId: string; nodeId: string };
export type AgentMediaIntent = MediaRequest & { canvasTarget?: AgentMediaCanvasTarget };
export type AgentMediaReceipt = { task: MediaTask; imported: Record<string, { storageKey: string; nodeId?: string }>; error?: string };
const storage = localforage.createInstance({ name: STORAGE_NS, storeName: "agent_media_tasks" });
const sourceKey = `${STORAGE_NS}:image-generation-source`;
function savedModel() { try { return localStorage.getItem(`${STORAGE_NS}:codex-image-model`) || ""; } catch { return ""; } }
function savedSource(): "api" | "agent" { try { return localStorage.getItem(sourceKey) === "agent" ? "agent" : "api"; } catch { return "api"; } }
export const useAgentMediaStore = create<{ receipts: Record<string, AgentMediaReceipt>; intents: Record<string, AgentMediaIntent>; error: string; source: "api" | "agent"; codexModel: string }>(() => ({ receipts: {}, intents: {}, error: "", source: savedSource(), codexModel: savedModel() }));
export function selectImageSource(source: "api" | "agent", codexModel = "") { useAgentMediaStore.setState({ source, codexModel }); try { localStorage.setItem(sourceKey, source); if (codexModel) localStorage.setItem(`${STORAGE_NS}:codex-image-model`, codexModel); } catch { /* 当前页面仍可切换。 */ } }
let writes: Promise<unknown> = Promise.resolve();
function persist(update: () => AgentMediaReceipt) { assertBusinessWriter(); const operation = writes.catch(() => {}).then(async () => { assertBusinessWriter(); const receipt = update(); await storage.setItem(receipt.task.id, receipt); useAgentMediaStore.setState((state) => ({ receipts: { ...state.receipts, [receipt.task.id]: receipt }, error: "" })); syncAgentTask(receipt); }); writes = operation; return operation.catch((error) => { useAgentMediaStore.setState({ error: "本机任务回执未存入浏览器，请保留原任务并重新保存，勿再次生成" }); throw error; }); }
export async function reloadAgentMediaReceipts() { await writes.catch(() => {}); const receipts: Record<string, AgentMediaReceipt> = {}, intents: Record<string, AgentMediaIntent> = {}; await storage.iterate<AgentMediaReceipt | MediaRequest, void>((value, key) => { if (key.startsWith("intent:")) intents[key.slice(7)] = value as AgentMediaIntent; else receipts[key] = value as AgentMediaReceipt; }); useAgentMediaStore.setState({ receipts, intents, error: "" }); Object.values(receipts).forEach((receipt) => syncAgentTask(receipt, false)); }
export function recordAgentMediaTask(task: MediaTask) { return persist(() => ({ ...useAgentMediaStore.getState().receipts[task.id], task, imported: useAgentMediaStore.getState().receipts[task.id]?.imported || {} })); }
export function recordAgentMediaImport(task: MediaTask, artifactId: string, saved: { storageKey: string; nodeId?: string }) { return persist(() => ({ task, imported: { ...useAgentMediaStore.getState().receipts[task.id]?.imported, [artifactId]: saved } })); }
export function agentMediaImported(taskId: string, artifactId: string) { return useAgentMediaStore.getState().receipts[taskId]?.imported[artifactId]; }
export async function flushAgentMediaReceipts() { await writes; if (useAgentMediaStore.getState().error) throw new Error(useAgentMediaStore.getState().error); }

/** paid submit 前先保存请求身份；响应丢失后只查询原请求，不自动重新生成。 */
export function recordAgentMediaIntent(request: MediaRequest, canvasTarget?: AgentMediaCanvasTarget) {
    assertBusinessWriter();
    const operation = writes.catch(() => {}).then(async () => { assertBusinessWriter(); const intent = canvasTarget ? { ...request, canvasTarget } : request; await storage.setItem(`intent:${request.requestId}`, intent); useAgentMediaStore.setState((state) => ({ intents: { ...state.intents, [request.requestId]: intent }, error: "" })); });
    writes = operation;
    return operation.catch((error) => { useAgentMediaStore.setState({ error: "生成意图未保存，未提交本机生成" }); throw error; });
}

export function recordAgentMediaSaveError(task: MediaTask, error: string) { return persist(() => ({ ...useAgentMediaStore.getState().receipts[task.id], task, imported: useAgentMediaStore.getState().receipts[task.id]?.imported || {}, error })); }
function syncAgentTask(receipt: AgentMediaReceipt, confirmed = true) {
    const { task, imported, error } = receipt;
    const id = `agent:${task.request.requestId}`;
    if (!useTaskStore.getState().tasks.some((item) => item.id === id)) beginCreationTask({ id, kind: "image", model: task.request.codexModel || "Codex", source: "agent", summary: task.request.prompt, sourcePath: "/image", remoteId: task.id, startedAt: task.createdAt });
    const target = useAgentMediaStore.getState().intents[task.request.requestId]?.canvasTarget;
    if (target) updateCreationTask(id, { sourcePath: `/canvas/${target.projectId}`, nodeId: target.nodeId });
    const saved = task.artifacts.length > 0 && task.artifacts.every((artifact) => imported[artifact.id]);
    updateCreationTask(id, { remoteId: task.id, phase: task.status === "completed" ? "done" : task.status === "failed" ? "failed" : task.status === "unknown" || !confirmed ? "unknown" : task.status === "pending" ? "queued" : "generating", error: task.error, saveState: saved ? "saved" : error ? "error" : task.status === "completed" ? "saving" : undefined, saveError: saved ? undefined : error });
}
