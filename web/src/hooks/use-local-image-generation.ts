import { useEffect, useRef, useState } from "react";
import { App } from "antd";
import { useAgentStore } from "@/stores/use-agent-store";
import { consumeComposerDraft, useComposerStore } from "@/stores/use-composer-store";
import { useAgentMediaStore, recordAgentMediaIntent, recordAgentMediaTask } from "@/stores/use-agent-media-store";
import { useCanvasStore, flushCanvasSave } from "@/stores/canvas/use-canvas-store";
import { fetchAgentMediaCapabilities, fetchAgentMediaModels, submitAgentMedia, type MediaCapabilities, type MediaRequest } from "@/services/api/local-agent-media";
import { postState } from "@/services/api/canvas-agent";
import { getImageBlob, resolveImageUrl } from "@/services/image-storage";
import { assertBusinessWriter, businessOperation } from "@/lib/write-ownership";
import { acquireAgentClientId } from "@/lib/agent/agent-client-id";
import { createAgentRevision } from "@/lib/canvas/agent-revision";
import { createCanvasNode } from "@/lib/canvas/canvas-node-factory";
import { vacantCanvasPosition } from "@/lib/canvas/canvas-composer";
import type { CanvasSubmission } from "@/lib/canvas/canvas-composer";
import { creationSnapshot } from "@/lib/composer";
import { CanvasNodeType } from "@/types/canvas";
import type { AiConfig } from "@/stores/use-config-store";
import { useConfigStore } from "@/stores/use-config-store";
import type { ReferenceImage } from "@/types/image";
import type { ComposerSubmission } from "@/lib/composer";
import { uniqueReferences } from "@/lib/composer";
import { beginCreationTask, updateCreationTask } from "@/features/tasks/task-store";

function dataUrl(blob: Blob) { return new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(new Error("参考图读取失败，未提交生成")); reader.readAsDataURL(blob); }); }

export function useLocalImageGeneration(enabled: boolean, canvas?: { scope: string; projectId: string; targetId?: string; prepareNative: (prompt: string, references: ReferenceImage[], config: AiConfig) => Pick<ComposerSubmission, "prompt" | "references"> }) {
    const { modal } = App.useApp();
    const { url, token, connected, models } = useAgentStore();
    const { source, codexModel, receipts } = useAgentMediaStore();
    const [capabilities, setCapabilities] = useState<MediaCapabilities[]>([]);
    const [busy, setBusy] = useState(false), [loading, setLoading] = useState(false), [error, setError] = useState("");
    const flight = useRef(false), epoch = useRef(0), revision = useRef(createAgentRevision());
    const active = enabled && source === "agent";
    const refresh = async () => {
        const requestEpoch = ++epoch.current;
        setLoading(true); setError("");
        try {
            const [capabilities, catalog] = await Promise.all([fetchAgentMediaCapabilities(url, token), fetchAgentMediaModels(url, token)]);
            const current = useAgentStore.getState();
            if (requestEpoch !== epoch.current || current.url !== url || current.token !== token || !current.connected) return;
            setCapabilities(capabilities.data);
            current.setAgentState({ models: catalog.data });
            if (!catalog.data.some((item) => item.model === useAgentMediaStore.getState().codexModel)) useAgentMediaStore.setState({ codexModel: "" });
        } catch (cause) { if (requestEpoch === epoch.current) { setCapabilities([]); setError(String(cause)); } }
        finally { if (requestEpoch === epoch.current) setLoading(false); }
    };
    useEffect(() => {
        if (!enabled) return;
        setCapabilities([]);
        if (enabled && connected) void refresh();
        return () => { epoch.current++; };
    }, [enabled, connected, url, token]);
    const codex = capabilities.find((item) => item.agentId === "codex");
    const generate = async (input?: ComposerSubmission) => {
        if (flight.current) return;
        flight.current = true; setBusy(true); setError("");
        let registeredTask = "", submitted = false;
        try { await businessOperation(async () => {
            const agent = useAgentStore.getState(), draft = canvas ? useComposerStore.getState().scoped[canvas.scope] : useComposerStore.getState().image;
            if (!draft) throw new Error("画布草稿尚未准备好");
            const model = useAgentMediaStore.getState().codexModel;
            if (!agent.connected || agent.url !== url || agent.token !== token) throw new Error("请先连接本机 Agent");
            if (agent.sending || agent.waiting || agent.conversation.status === "running") throw new Error("本机 Agent 正在执行任务，请完成后再生成");
            if (!(input?.prompt || draft.prompt).trim()) throw new Error("先写一句想要的画面");
            if (!model || !agent.models.some((item) => item.model === model)) throw new Error("请在模型菜单中明确选择本机 Codex 模型");
            const prepared = input || canvas?.prepareNative(draft.prompt, draft.references, { ...useConfigStore.getState().config, ...draft.parameters });
            const inputReferences = uniqueReferences(prepared?.references || draft.references);
            const capability = inputReferences.length ? "image-edit" : "text-to-image";
            const availability = codex?.capabilities[capability];
            if (!availability || availability === "unavailable") throw new Error("当前本机生图能力不可用，请在模型菜单刷新能力");
            const allowUnverified = availability === "unverified";
            if (allowUnverified && !await new Promise<boolean>((resolve) => modal.confirm({ title: "本机 Codex 生图能力尚未验证", content: "本次会提交原生生图任务，可能消耗 Codex 使用额度。失败或结果未知不会自动改用 API，也不会重复生成。", okText: "允许本次任务", cancelText: "取消", onOk: () => resolve(true), onCancel: () => resolve(false) }))) return;
            const prompt = (prepared?.prompt || draft.prompt).replace(/@\[ref:([^\]]+)\]/g, (_, id: string) => {
                const index = inputReferences.findIndex((reference) => reference.id === id);
                if (index < 0) throw new Error("引用已失效，请移除或重新添加素材");
                return `参考图${index + 1}`;
            }).trim();
            const references = await Promise.all(inputReferences.map(async (reference) => {
                const blob = reference.storageKey ? await getImageBlob(reference.storageKey) : undefined;
                const original = blob ? await dataUrl(blob) : reference.dataUrl;
                if (!original?.startsWith("data:image/")) throw new Error("参考图原文件不可用，未提交生成");
                return { id: reference.id, name: reference.name, dataUrl: original };
            }));
            const assertConnection = () => {
                assertBusinessWriter();
                const current = useAgentStore.getState();
                if (!current.connected || current.url !== url || current.token !== token) throw new Error("本机连接已改变，未提交生成");
                if (useAgentMediaStore.getState().source !== "agent" || useAgentMediaStore.getState().codexModel !== model) throw new Error("生成来源或模型已改变，未提交生成");
            };
            assertConnection();
            const context = agent.canvasContext;
            if (canvas && context?.getSnapshot().projectId !== canvas.projectId) throw new Error("目标画布已改变，未提交生成");
            const projectId = context?.getSnapshot().projectId || useCanvasStore.getState().createProject(draft.prompt.trim().slice(0, 24));
            await flushCanvasSave();
            const getSnapshot = () => {
                if (context) {
                    if (useAgentStore.getState().canvasContext?.getSnapshot().projectId !== projectId) throw new Error("目标画布已改变，未提交生成");
                    return context.getSnapshot();
                }
                const project = useCanvasStore.getState().openProject(projectId);
                if (!project) throw new Error("目标画布已删除，未提交生成");
                return revision.current({ projectId, title: project.title, nodes: project.nodes, connections: project.connections, viewport: project.viewport, selectedNodeIds: [] });
            };
            const requestId = crypto.randomUUID();
            const original = canvas?.targetId ? getSnapshot().nodes.find((node) => node.id === canvas.targetId) : undefined;
            if (canvas?.targetId && !original) throw new Error("原创作节点已删除，未提交生成");
            const fill = original?.type === CanvasNodeType.Image && !original.metadata?.content && !original.metadata?.agentMediaRequestId;
            const canvasTarget = canvas ? { projectId, nodeId: fill ? original!.id : `agent-request:${requestId}` } : undefined;
            const request: MediaRequest = { requestId, projectId, revision: getSnapshot().revision, agentId: "codex", capability, codexModel: model, prompt, references, allowUnverified };
            await recordAgentMediaIntent(request, canvasTarget);
            const taskId = registeredTask = beginCreationTask({ id: `agent:${request.requestId}`, creationId: input?.id, kind: "image", model, source: "agent", summary: prompt, sourcePath: canvas ? `/canvas/${projectId}` : "/image", nodeId: canvasTarget?.nodeId });
            if (canvasTarget && context) {
                const current = getSnapshot();
                const position = original ? fill ? original.position : vacantCanvasPosition(current.nodes, { x: original.position.x + original.width + 96, y: original.position.y }, original.width, original.height) : { x: (window.innerWidth / 2 - current.viewport.x) / current.viewport.k, y: (window.innerHeight / 2 - current.viewport.y) / current.viewport.k };
                const node = createCanvasNode(CanvasNodeType.Image, position, { status: "loading", prompt, model, generationMode: "image", generationTaskId: `agent:${requestId}`, agentMediaRequestId: requestId, inputNodeIds: (input as CanvasSubmission | undefined)?.inputNodeIds || draft.nodeIds, creation: input ? creationSnapshot(input) : undefined, sourceNodeId: original?.metadata?.content ? original.id : undefined, versionOf: original?.metadata?.content ? original.id : undefined, branchKind: original?.metadata?.content ? "edit" : undefined });
                node.id = canvasTarget.nodeId;
                node.title = "Codex 生成图片";
                const materials = (input as CanvasSubmission | undefined)?.materials || [];
                if (materials.length) await context.importMediaNodes(await Promise.all(materials.map(async (material, index) => ({ ...material, metadata: { ...material.metadata, content: await resolveImageUrl(material.metadata?.storageKey, material.metadata?.content || "") }, position: { x: position.x - material.width - 96, y: position.y + index * (material.height + 32) } }))));
                if (fill) await context.applyOps([{ type: "update_node", id: node.id, metadata: node.metadata }]);
                else await context.importMediaNodes([node]);
                const referenceIds = node.metadata?.inputNodeIds || [];
                if (referenceIds.length) await context.applyOps(referenceIds.filter((id) => id !== node.id && getSnapshot().nodes.some((node) => node.id === id)).map((fromNodeId) => ({ type: "connect_nodes" as const, fromNodeId, toNodeId: node.id })));
                if (original?.metadata?.content && !referenceIds.includes(original.id)) await context.applyOps([{ type: "connect_nodes", fromNodeId: original.id, toNodeId: node.id }]);
            }
            const snapshot = getSnapshot();
            if (canvasTarget) { request.revision = snapshot.revision; await recordAgentMediaIntent(request, canvasTarget); }
            const clientId = await acquireAgentClientId();
            assertConnection();
            if (getSnapshot().revision !== request.revision) throw new Error("画布已改变，未提交生成；请重新审阅");
            if (!await postState(url, token, clientId, snapshot)) throw new Error("目标画布未送达本机 Agent，未提交生成");
            assertConnection();
            if (getSnapshot().revision !== request.revision) throw new Error("同步期间画布已改变，未提交生成");
            try {
                submitted = true;
                await recordAgentMediaTask((await submitAgentMedia(url, token, clientId, request)).data);
                if (!input) consumeComposerDraft("image", draft, canvas?.scope);
            } catch (cause) {
                updateCreationTask(taskId, { phase: "unknown", error: "提交状态待确认，请查询原任务，不要重复生成" });
                throw cause;
            }
        })(); } catch (cause) { const text = cause instanceof Error ? cause.message : String(cause); if (registeredTask) updateCreationTask(registeredTask, { phase: submitted ? "unknown" : "failed", error: text }); setError(text); }
        finally { flight.current = false; setBusy(false); }
        return registeredTask || undefined;
    };
    return { active, source, codexModel, connected, models: codex ? models : [], loading, busy: busy || Object.values(receipts).some(({ task }) => task.status === "pending" || task.status === "running"), error, codex, refresh, generate };
}
