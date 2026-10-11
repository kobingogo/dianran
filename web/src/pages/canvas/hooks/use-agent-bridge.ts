import { assertBusinessWriter } from "@/lib/write-ownership";
import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from "react";

import { useTaskStore } from "@/features/tasks/task-store";
import { reloadAgentMediaReceipts, useAgentMediaStore, recordAgentMediaTask } from "@/stores/use-agent-media-store";
import { fetchAgentMediaTasks } from "@/services/api/local-agent-media";
import { importAgentMedia } from "@/lib/agent/import-agent-media";
import i18n from "@/i18n";
import { useAgentStore } from "@/stores/use-agent-store";
import { createAgentRevision } from "@/lib/canvas/agent-revision";
import { flushCanvasSave, useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { applyCanvasAgentOps, type CanvasAgentOp, type CanvasAgentSnapshot } from "@/lib/canvas/canvas-agent-ops";
import { validateAgentMediaWrites } from "@/lib/canvas/agent-media-validation";
import type { CanvasNodeGenerationMode } from "@/components/canvas/canvas-node-prompt-panel";
import type { CanvasConnection, CanvasNodeData, ContextMenuState, ViewportTransform } from "@/types/canvas";

type GenerateNodeRef = MutableRefObject<((nodeId: string, mode: CanvasNodeGenerationMode, prompt: string) => Promise<void>) | null>;

type AgentBridgeParams = {
    projectId: string;
    title: string | undefined;
    nodes: CanvasNodeData[];
    connections: CanvasConnection[];
    selectedNodeIds: Set<string>;
    viewport: ViewportTransform;
    nodesRef: MutableRefObject<CanvasNodeData[]>;
    connectionsRef: MutableRefObject<CanvasConnection[]>;
    selectedNodeIdsRef: MutableRefObject<Set<string>>;
    viewportRef: MutableRefObject<ViewportTransform>;
    generateNodeRef: GenerateNodeRef;
    setNodes: Dispatch<SetStateAction<CanvasNodeData[]>>;
    setConnections: Dispatch<SetStateAction<CanvasConnection[]>>;
    setSelectedNodeIds: Dispatch<SetStateAction<Set<string>>>;
    setSelectedConnectionId: Dispatch<SetStateAction<string | null>>;
    setViewport: Dispatch<SetStateAction<ViewportTransform>>;
    setContextMenu: Dispatch<SetStateAction<ContextMenuState | null>>;
};

/**
 * Bridge between the canvas and local Agent: publish the current snapshot and apply/undo capabilities
 * to the Agent store for the local Codex panel. All members except applyAgentOps are internal.
 */
export function useAgentBridge(params: AgentBridgeParams) {
    const { projectId, title, nodes, connections, selectedNodeIds, viewport, nodesRef, connectionsRef, selectedNodeIdsRef, viewportRef, generateNodeRef, setNodes, setConnections, setSelectedNodeIds, setSelectedConnectionId, setViewport, setContextMenu } =
        params;
    const setAgentCanvasContext = useAgentStore((state) => state.setCanvasContext);
    const [agentUndoSnapshot, setAgentUndoSnapshot] = useState<{ before: CanvasAgentSnapshot; after: string } | null>(null);
    const revision = useRef(createAgentRevision());
    const tasks = useTaskStore((state) => state.tasks);
    const connected = useAgentStore((state) => state.connected);
    const endpoint = useAgentStore((state) => state.url);
    const token = useAgentStore((state) => state.token);
    const conversationStatus = useAgentStore((state) => state.conversation.status);
    useEffect(() => {
        const next = nodesRef.current.map((node) => {
            if (!node.metadata?.agentMediaRequestId || node.metadata.content) return node;
            const task = tasks.find((item) => item.id === node.metadata?.generationTaskId);
            if (!task) return node;
            const status = ["requesting", "queued", "generating", "receiving"].includes(task.phase) ? "loading" : "error";
            const errorDetails = task.phase === "done" ? task.saveError || "图片已生成，正在保存；可查询原任务重试保存" : task.error || "最新状态待确认，请查询原任务，不要重复生成";
            if (node.metadata.status === status && node.metadata.errorDetails === (status === "loading" ? undefined : errorDetails)) return node;
            return { ...node, metadata: { ...node.metadata, status, errorDetails: status === "loading" ? undefined : errorDetails } } as CanvasNodeData;
        });
        if (next.some((node, index) => node !== nodesRef.current[index])) { nodesRef.current = next; setNodes(next); }
    }, [tasks, nodes]);
    useEffect(() => {
        let live = true;
        void (async () => {
            await reloadAgentMediaReceipts();
            if (!live || !connected) return;
            for (const task of (await fetchAgentMediaTasks(endpoint, token, projectId)).data) {
                if (!live) return;
                await recordAgentMediaTask(task);
                const receipt = useAgentMediaStore.getState().receipts[task.id];
                if (task.status === "completed" && !receipt?.error && task.artifacts.some((artifact) => !receipt?.imported[artifact.id])) await importAgentMedia(task, endpoint, token);
            }
        })().catch((error) => { if (live) useAgentMediaStore.setState({ error: error instanceof Error ? error.message : String(error) }); });
        return () => { live = false; };
    }, [projectId, connected, endpoint, token, conversationStatus]);
    const projectTitle = title || i18n.t("canvas.project.untitled");

    const getSnapshot = useCallback(() => revision.current({ projectId, title: projectTitle, nodes: nodesRef.current, connections: connectionsRef.current, selectedNodeIds: [...selectedNodeIdsRef.current], viewport: viewportRef.current }), [projectId, projectTitle]);
    const agentSnapshot = useMemo<CanvasAgentSnapshot>(() => getSnapshot(), [getSnapshot, connections, nodes, selectedNodeIds, viewport]);
    const applyAgentOps = useCallback(
        async (ops?: CanvasAgentOp[]) => {
            assertBusinessWriter();
            const safeOps = ops || [];
            const before = getSnapshot();
            const generationOps = safeOps.filter((op): op is Extract<CanvasAgentOp, { type: "run_generation" }> => op.type === "run_generation" && Boolean(op.nodeId));
            // Validate the whole batch, including generation references, before committing any edit.
            const next = applyCanvasAgentOps(before, safeOps);
            await validateAgentMediaWrites(before, next, safeOps);
            assertBusinessWriter();
            if (getSnapshot().revision !== before.revision) throw new Error("画布在校验媒体原文件时已改变，请重新读取并审阅操作");
            if (generationOps.length && !generateNodeRef.current) throw new Error("生成入口尚未准备好，请重新读取画布");
            nodesRef.current = next.nodes;
            connectionsRef.current = next.connections;
            selectedNodeIdsRef.current = new Set(next.selectedNodeIds);
            viewportRef.current = next.viewport;
            setNodes(next.nodes);
            setConnections(next.connections);
            setSelectedNodeIds(new Set(next.selectedNodeIds));
            setSelectedConnectionId(null);
            setViewport(next.viewport);
            setContextMenu(null);
            const saved = getSnapshot();
            setAgentUndoSnapshot({ before, after: saved.revision });
            useCanvasStore.getState().updateProject(projectId, { nodes: next.nodes, connections: next.connections, viewport: next.viewport });
            await flushCanvasSave();
            if (generationOps.length) {
                if (getSnapshot().revision !== saved.revision) throw new Error("节点已保存，但保存期间画布已改变；生成尚未提交，请重新审阅");
                queueMicrotask(() =>
                    generationOps.forEach((op) => {
                        const target = saved.nodes.find((node) => node.id === op.nodeId);
                        const prompt = op.prompt?.trim() ? op.prompt : (target?.metadata?.composerContent ?? target?.metadata?.prompt ?? "");
                        if (useAgentStore.getState().canvasContext?.getSnapshot().projectId !== projectId) return;
                        void generateNodeRef.current?.(op.nodeId, op.mode || target?.metadata?.generationMode || "image", prompt).catch((error) => useAgentStore.getState().addMessage({ id: crypto.randomUUID(), role: "error", text: error instanceof Error ? error.message : "生成未完成，请查看任务状态" }));
                    }),
                );
            }
            return { ...saved, receipt: { applied: true, saved: true, generation: generationOps.length ? "scheduled" : "not-requested", generationNodeIds: generationOps.map((op) => op.nodeId), appliedOps: safeOps } };
        },
        [getSnapshot, projectId],
    );
    const undoAgentOps = useCallback(async () => {
        assertBusinessWriter();
        if (!agentUndoSnapshot) return null;
        if (getSnapshot().revision !== agentUndoSnapshot.after) throw new Error("Agent 操作后已有新编辑或生成结果，不能恢复旧快照；请按节点调整");
        const before = agentUndoSnapshot.before;
        nodesRef.current = before.nodes;
        connectionsRef.current = before.connections;
        selectedNodeIdsRef.current = new Set(before.selectedNodeIds);
        viewportRef.current = before.viewport;
        setNodes(before.nodes);
        setConnections(before.connections);
        setSelectedNodeIds(new Set(before.selectedNodeIds));
        setSelectedConnectionId(null);
        setViewport(before.viewport);
        setContextMenu(null);
        setAgentUndoSnapshot(null);
        useCanvasStore.getState().updateProject(projectId, { nodes: before.nodes, connections: before.connections, viewport: before.viewport });
        await flushCanvasSave();
        return getSnapshot();
    }, [agentUndoSnapshot, getSnapshot, projectId]);

    const importMediaNodes = useCallback(async (imports: CanvasNodeData[]) => {
        assertBusinessWriter();
        if (useAgentStore.getState().canvasContext?.getSnapshot().projectId !== projectId) throw new Error("画布已切换，请重新导入原任务");
        const existing = new Set(nodesRef.current.map((node) => node.id));
        const byId = new Map(imports.map((node) => [node.id, node]));
        const next = [...nodesRef.current.map((node) => {
            const replacement = byId.get(node.id);
            const sameRequest = node.metadata?.agentMediaRequestId ? node.metadata.agentMediaRequestId === replacement?.metadata?.agentMediaRequestId : node.metadata?.pluginActionRequestId && node.metadata.pluginActionRequestId === replacement?.metadata?.pluginActionRequestId;
            return replacement && !node.metadata?.content && sameRequest ? replacement : node;
        }), ...imports.filter((node) => !existing.has(node.id))];
        nodesRef.current = next;
        setNodes(next);
        useCanvasStore.getState().updateProject(projectId, { nodes: next });
        await flushCanvasSave();
    }, [projectId]);

    useEffect(() => {
        setAgentCanvasContext({ snapshot: agentSnapshot, getSnapshot, applyOps: applyAgentOps, undoOps: undoAgentOps, importMediaNodes, canUndo: Boolean(agentUndoSnapshot && agentUndoSnapshot.after === agentSnapshot.revision) });
        return () => setAgentCanvasContext(null);
    }, [agentSnapshot, applyAgentOps, agentUndoSnapshot, getSnapshot, importMediaNodes, setAgentCanvasContext, undoAgentOps]);

    return { applyAgentOps };
}
