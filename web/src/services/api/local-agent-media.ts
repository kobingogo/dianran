import { fetchAgentJson } from "./canvas-agent";
import type { MediaCapabilities, MediaRequest, MediaTask } from "../../../../canvas-agent/src/agent/media-types";
export type { MediaArtifact, MediaCapabilities, MediaRequest, MediaTask } from "../../../../canvas-agent/src/agent/media-types";
export function fetchAgentMediaCapabilities(endpoint: string, token: string) { return fetchAgentJson<{ ok: true; data: MediaCapabilities[] }>(endpoint, token, "/agent/media/capabilities"); }
export function submitAgentMedia(endpoint: string, token: string, clientId: string, request: MediaRequest) { return fetchAgentJson<{ ok: true; data: MediaTask }>(endpoint, token, "/agent/media/tasks", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ clientId, ...request }) }); }
export function fetchAgentMediaTasks(endpoint: string, token: string, projectId: string) { return fetchAgentJson<{ ok: true; data: MediaTask[] }>(endpoint, token, `/agent/media/tasks?projectId=${encodeURIComponent(projectId)}`); }
export function fetchAgentMediaTask(endpoint: string, token: string, projectId: string, taskId: string) { return fetchAgentJson<{ ok: true; data: MediaTask }>(endpoint, token, `/agent/media/tasks/${encodeURIComponent(taskId)}?projectId=${encodeURIComponent(projectId)}`); }
export async function fetchAgentMediaArtifact(endpoint: string, token: string, projectId: string, taskId: string, artifactId: string) {
    const response = await fetch(`${endpoint}/agent/media/tasks/${encodeURIComponent(taskId)}/artifacts/${encodeURIComponent(artifactId)}?projectId=${encodeURIComponent(projectId)}&token=${encodeURIComponent(token)}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`本机产物读取失败（${response.status}），请查询或重新导入原任务；不会重新生成`);
    return response.blob();
}
export function registerExternalAgentMedia(endpoint: string, token: string, clientId: string, toolRequestId: string, input: Record<string, unknown>) { return fetchAgentJson<{ ok: true; data: MediaTask }>(endpoint, token, "/agent/media/register-external", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ clientId, toolRequestId, input }) }); }

export function fetchAgentMediaModels(endpoint: string, token: string) { return fetchAgentJson<{ ok: true; data: import("@/stores/use-agent-store").AgentModel[] }>(endpoint, token, "/agent/codex/models"); }
