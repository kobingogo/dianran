import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { App, Image } from "antd";
import { saveAs } from "file-saver";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { useAgentStore } from "@/stores/use-agent-store";
import { useAgentMediaStore, selectImageSource, recordAgentMediaTask, reloadAgentMediaReceipts, type AgentMediaReceipt } from "@/stores/use-agent-media-store";
import { fetchAgentMediaTasks, fetchAgentMediaTask, fetchAgentMediaArtifact, type MediaTask, type MediaArtifact } from "@/services/api/local-agent-media";
import { businessOperation } from "@/lib/write-ownership";
import { importAgentMedia } from "@/lib/agent/import-agent-media";
import { probeImageAsset, resolveImageUrl } from "@/services/image-storage";
import { InkButton } from "@/components/ui/ink-button";
import { GenerationStatus } from "@/features/tasks/generation-status";
import { useTaskStore } from "@/features/tasks/task-store";
import { useReuseCreation } from "@/hooks/use-reuse-creation";
import { useAssetMutation } from "@/hooks/use-asset-mutation";
import { useComposerStore } from "@/stores/use-composer-store";
import { useAssetStore } from "@/stores/use-asset-store";

const statusText: Record<string, string> = { pending: "待处理", running: "生成中", completed: "已生成", failed: "生成失败", unknown: "最新状态待确认" };
export function AgentMediaPanel({ embedded = false, history = false, focusTaskId, threadId }: { embedded?: boolean; history?: boolean; focusTaskId?: string; threadId?: string }) {
    const navigate = useNavigate();
    const { url, token, connected, conversation } = useAgentStore();
    const { receipts, intents, error: receiptError } = useAgentMediaStore();
    const projects = useCanvasStore((state) => state.projects);
    const ledger = useTaskStore((state) => state.tasks);
    const [error, setError] = useState("");
    useEffect(() => { void reloadAgentMediaReceipts().catch((cause) => setError(String(cause))); }, []);
    // 重连/原生轮次结束只查询已有请求，不重新提交，不新增轮询边界。
    useEffect(() => {
        if (!embedded || !connected) return;
        let live = true;
        void (async () => {
            const current = useAgentMediaStore.getState();
            const ids = new Set([...Object.values(current.intents).map((intent) => intent.projectId), ...Object.values(current.receipts).map(({ task }) => task.request.projectId)]);
            for (const projectId of ids) {
                for (const task of (await fetchAgentMediaTasks(url, token, projectId)).data) {
                    if (!live) return;
                    await recordAgentMediaTask(task);
                    const receipt = useAgentMediaStore.getState().receipts[task.id];
                    if (task.status === "completed" && task.artifacts.some((artifact) => !receipt?.imported[artifact.id]) && !receipt?.error) await importAgentMedia(task, url, token);
                }
            }
        })().catch((cause) => live && setError(String(cause)));
        return () => { live = false; };
    }, [embedded, connected, url, token, conversation.status]);
    if (!embedded) return <div className="p-3 text-sm"><InkButton onClick={() => { selectImageSource("agent", useAgentMediaStore.getState().codexModel); navigate("/image"); }}>查看图片工作台与生成结果</InkButton><p className="mt-2 text-xs text-[color:var(--ink-500)]">生成进度、作品和历史统一显示在图片工作台与任务中心。</p></div>;
    const all = Object.values(receipts).filter(({ task }) => threadId === undefined || task.native?.threadId === threadId).sort((a, b) => b.task.createdAt - a.task.createdAt);
    const tasks = history ? all : focusTaskId ? all.filter(({ task }) => `agent:${task.request.requestId}` === focusTaskId) : all.slice(0, 1);
    const missing = (threadId === undefined ? Object.values(intents) : []).filter((intent) => !all.some(({ task }) => task.request.requestId === intent.requestId)).sort((a, b) => (ledger.find((task) => task.id === `agent:${b.requestId}`)?.startedAt || 0) - (ledger.find((task) => task.id === `agent:${a.requestId}`)?.startedAt || 0));
    const uncertain = history ? missing : focusTaskId ? missing.filter((intent) => `agent:${intent.requestId}` === focusTaskId) : missing.slice(0, 1);
    return <div className="space-y-4" aria-live="polite">
        {(error || receiptError) && <p role="alert" className="text-sm text-[color:var(--zhu-600)]">{error || receiptError}。请查询原任务，不要直接重复生成。</p>}
        {uncertain.map((request) => {
            const task = ledger.find((item) => item.id === `agent:${request.requestId}`);
            return <article key={request.requestId} className="mx-auto max-w-lg rounded-xl border border-[var(--line)] bg-[var(--paper-0)] p-5">
                {!task || task.phase === "failed" || task.phase === "unknown" ? <p className="text-sm">{task?.phase === "failed" ? "请求未提交或未完成" : "最新状态待确认"}</p> : <GenerationStatus kind="image" taskId={`agent:${request.requestId}`} variant="card" />}
                <p className="mt-3 line-clamp-2 text-sm">{request.prompt}</p>
                {task?.error && <p className="text-xs text-[color:var(--ink-500)]">{task.error}</p>}
                <InkButton disabled={!connected} onClick={() => void fetchAgentMediaTasks(url, token, request.projectId).then(async ({ data }) => { for (const item of data) await recordAgentMediaTask(item); }).catch((cause) => setError(String(cause)))}>查询原请求，不重新生成</InkButton>
            </article>;
        })}
        {!tasks.length && !uncertain.length && <p className="py-12 text-center text-sm text-[color:var(--ink-500)]">还没有本机图片任务；连接 Agent 并选择 Codex 模型后，在下方描述画面。</p>}
        {tasks.map((receipt) => <NativeImageTask key={receipt.task.id} receipt={receipt} title={projects.find((project) => project.id === receipt.task.request.projectId)?.title} />)}
    </div>;
}

function NativeImageTask({ receipt, title }: { receipt: AgentMediaReceipt; title?: string }) {
    const { message } = App.useApp();
    const navigate = useNavigate();
    const { url, token, connected } = useAgentStore();
    const { task, imported, error } = receipt;
    const reuse = useReuseCreation();
    const [busy, setBusy] = useState(false);
    const act = async (save: boolean) => {
        setBusy(true);
        try { await businessOperation(async () => { const current = (await fetchAgentMediaTask(url, token, task.request.projectId, task.id)).data; await recordAgentMediaTask(current); if (save) await importAgentMedia(current, url, token); })(); }
        catch (cause) { message.error(String(cause)); } finally { setBusy(false); }
    };
    const saved = task.artifacts.length > 0 && task.artifacts.every((artifact) => imported[artifact.id]);
    return <article data-native-task={task.id} className="mx-auto max-w-lg overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--paper-0)]">
        {task.artifacts.length ? task.artifacts.map((artifact) => <NativeImage key={artifact.id} task={task} artifact={artifact} storageKey={imported[artifact.id]?.storageKey} />) : <div className="grid aspect-square place-items-center bg-[var(--paper-2)] p-5">
            {task.status === "failed" || task.status === "unknown" ? <p className="text-sm">{statusText[task.status]} · {task.error || "请查询原任务"}</p> : <GenerationStatus kind="image" taskId={`agent:${task.request.requestId}`} variant="card" />}
        </div>}
        <div className="space-y-2 p-4">
            <p className="text-xs text-[color:var(--ink-500)]">本机 Codex · {task.request.codexModel} · {statusText[task.status]}</p>
            <p className="line-clamp-2 text-sm">{task.request.prompt}</p>
            {task.status === "completed" && <p className="text-xs text-[color:var(--ink-500)]">{saved ? "已保存到本机浏览器" : error ? `作品已生成，保存未完成：${error}` : "作品已生成，正在保存"}</p>}
            <div className="flex flex-wrap gap-1">
                {task.status === "completed" && !saved && <InkButton disabled={busy || !connected} onClick={() => void act(true)}>重试保存</InkButton>}
                <InkButton onClick={() => void reuse("image", { prompt: task.request.prompt, references: (task.request.references || []).map((ref) => ({ ...ref, type: "image/png" })) }, () => selectImageSource("agent", task.request.codexModel))}>复用条件</InkButton>
                {saved && <InkButton onClick={() => navigate(`/canvas/${task.request.projectId}?node=${encodeURIComponent(Object.values(imported)[0]?.nodeId || "")}`)}>进入画布</InkButton>}
            </div>
            <details className="text-xs text-[color:var(--ink-500)]"><summary>创作详情</summary><p className="whitespace-pre-wrap py-2">{task.request.prompt}</p><p>原画布：{title || task.request.projectId}</p><p className="break-all">任务：{task.id}</p>{task.error && <p>{task.error}</p>}<InkButton disabled={busy || !connected} onClick={() => void act(false)}>查询原任务</InkButton></details>
        </div>
    </article>;
}

function NativeImage({ task, artifact, storageKey }: { task: MediaTask; artifact: MediaArtifact; storageKey?: string }) {
    const { url, token, connected } = useAgentStore();
    const { message } = App.useApp();
    const mutateAsset = useAssetMutation();
    const reuse = useReuseCreation();
    const [src, setSrc] = useState("");
    const [error, setError] = useState("");
    useEffect(() => {
        let live = true, temporary = "";
        void (async () => {
            const value = storageKey ? await resolveImageUrl(storageKey) : connected ? (temporary = URL.createObjectURL(await fetchAgentMediaArtifact(url, token, task.request.projectId, task.id, artifact.id))) : "";
            if (live) { setSrc(value); setError(value ? "" : "尚未保存的原图需要连接本机 Agent"); } else if (temporary) URL.revokeObjectURL(temporary);
        })().catch((cause) => live && setError(String(cause)));
        return () => { live = false; if (temporary) URL.revokeObjectURL(temporary); };
    }, [storageKey, connected, url, token, task.id, artifact.id]);
    return <div>
        {src ? <Image src={src} alt="本机 Codex 生成图片" rootClassName="block w-full" className="w-full object-contain" /> : <div className="grid aspect-square place-items-center p-5 text-sm">{error || "正在读取原图…"}</div>}
        <div className="flex flex-wrap gap-1 px-3 pt-2">
            <InkButton disabled={!src} onClick={() => { void fetch(src).then((response) => response.blob()).then((blob) => saveAs(blob, `codex-${artifact.id}.png`)).catch((cause) => message.error(String(cause))); }}>下载原图</InkButton>
            <InkButton disabled={!storageKey || !src} onClick={() => void reuse("image", { prompt: "", references: [{ id: artifact.id, name: "Codex 生成图片", type: "image/png", dataUrl: src, storageKey }] }, () => {
                const state = useComposerStore.getState();
                const id = state.ensureConversation("image", "image");
                state.updateConversation(id, { purpose: "discuss" });
                window.dispatchEvent(new CustomEvent("creation-focus", { detail: "image" }));
                document.querySelector<HTMLTextAreaElement>('[data-testid="composer"] textarea')?.focus();
            })}>继续修改</InkButton>
            <InkButton disabled={!storageKey || !src} onClick={() => void mutateAsset(async () => { await useAssetStore.getState().addAsset({ kind: "image", title: task.request.prompt.slice(0, 24), coverUrl: src, tags: [], source: "本机 Codex", data: { dataUrl: src, storageKey, ...(await probeImageAsset(src, "image/png")) }, metadata: { prompt: task.request.prompt } }); }, "已存入素材")}>存入素材</InkButton>
        </div>
    </div>;
}
