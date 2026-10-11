import { useCanvasStore, flushCanvasSave } from "@/stores/canvas/use-canvas-store";
import { useComposerStore, flushComposerSave } from "@/stores/use-composer-store";
import { createAgentRevision } from "@/lib/canvas/agent-revision";

/** A conversation owns one result project even when no canvas is open. */
export async function prepareAgentResultTarget(endpoint: string, threadId: string, title: string) {
    const key = JSON.stringify([endpoint, threadId]);
    const drafts = useComposerStore.getState();
    const projectId = drafts.agentResultProjects[key] || useCanvasStore.getState().createProject(`Agent 创作 · ${title.trim().slice(0, 24) || "结果"}`);
    if (!drafts.agentResultProjects[key]) drafts.saveAgentResultProject(key, projectId);
    await flushCanvasSave();
    await flushComposerSave();
    const project = useCanvasStore.getState().openProject(projectId);
    if (!project) throw new Error("会话结果画布已删除，请恢复原画布后再提交");
    const snapshot = createAgentRevision()({ projectId, title: project.title, nodes: project.nodes, connections: project.connections, viewport: project.viewport, selectedNodeIds: [] });
    return { projectId, revision: snapshot.revision };
}
