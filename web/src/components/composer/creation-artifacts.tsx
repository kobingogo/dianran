import { useEffect, useState } from "react";
import { App, Image } from "antd";
import localforage from "localforage";
import { saveAs } from "file-saver";
import { useNavigate } from "react-router-dom";
import { STORAGE_NS } from "@/constant/brand";
import { useTaskStore } from "@/features/tasks/task-store";
import { GenerationStatus } from "@/features/tasks/generation-status";
import { AgentMediaPanel } from "@/components/agent/agent-media-panel";
import { InkButton } from "@/components/ui/ink-button";
import { CanvasDeliveryButton } from "./canvas-delivery";
import { resolveImageUrl } from "@/services/image-storage";
import { useComposerStore } from "@/stores/use-composer-store";
import { useReuseCreation } from "@/hooks/use-reuse-creation";
import { useAssetMutation } from "@/hooks/use-asset-mutation";
import { useAssetStore } from "@/stores/use-asset-store";
import type { CreationPlan } from "@/lib/creation-conversation";
import { showErrorToast } from "@/features/errors/error-toast";

type Artifact = { id: string; url: string; storageKey?: string; width: number; height: number; bytes: number; mimeType?: string; dataUrl?: string };
type Log = { id: string; creation?: { id: string }; images?: Artifact[]; video?: Artifact; error?: string };

/** Read the existing generation receipts; never register or resubmit a task for display. */
export function CreationArtifacts({ plan, scope }: { plan: CreationPlan; scope: string }) {
    const tasks = useTaskStore((state) => state.tasks);
    const owned = tasks.filter((task) => task.creationId === plan.submission.id || task.id === plan.taskId);
    const [artifacts, setArtifacts] = useState<Artifact[]>([]);
    const [readError, setReadError] = useState("");
    const [revision, setRevision] = useState(0);
    const navigate = useNavigate();
    const { message } = App.useApp();
    const reuse = useReuseCreation();
    const mutateAsset = useAssetMutation();
    useEffect(() => {
        const changed = () => setRevision((value) => value + 1);
        window.addEventListener("creation-history-updated", changed);
        return () => window.removeEventListener("creation-history-updated", changed);
    }, []);
    useEffect(() => {
        if (plan.source === "agent" || scope !== plan.submission.mode) return;
        let live = true;
        const storage = localforage.createInstance({ name: STORAGE_NS, storeName: plan.submission.mode === "image" ? "image_generation_logs" : "video_generation_logs" });
        void (async () => {
            const logs: Log[] = [];
            await storage.iterate<Log, void>((log) => { if (log.creation?.id === plan.submission.id) logs.push(log); });
            const output = logs.flatMap((log) => log.images || (log.video ? [log.video] : []));
            const next = await Promise.all(output.map(async (item) => ({ ...item, url: await resolveImageUrl(item.storageKey, item.url || item.dataUrl || "") })));
            if (live) { setArtifacts(next); setReadError(""); }
        })().catch((cause) => live && setReadError(String(cause)));
        return () => { live = false; };
    }, [plan.submission.id, plan.source, scope, tasks, revision]);
    if (!owned.length && (plan.state === "unknown" || plan.state === "submitting")) return <div className="space-y-2 text-xs"><p>尚未取得任务回执，请核对原任务与连接，不会自动重新生成。</p><InkButton variant="ghost" size={32} onClick={() => useTaskStore.getState().setCenterOpen(true)}>查看任务中心</InkButton></div>;
    if (scope !== plan.submission.mode) return <p className="text-xs text-[color:var(--ink-500)]">结果展示在原画布节点；可在任务中心定位。{owned.map((task) => <InkButton key={task.id} onClick={() => navigate(`${task.sourcePath}?task=${encodeURIComponent(task.id)}`)}>查看对应任务</InkButton>)}</p>;
    if (plan.source === "agent") return plan.taskId ? <AgentMediaPanel embedded focusTaskId={plan.taskId} /> : <p className="text-xs">正在确认本机任务回执，不会自动重新提交。</p>;
    return <div className="space-y-3">
        {readError ? <p role="alert" className="text-xs text-[color:var(--zhu-600)]">作品读取失败：{readError}。可从任务中心查看原结果。</p> : null}
        <div className={artifacts.length > 1 ? "grid gap-4 sm:grid-cols-2" : "space-y-4"}>{artifacts.map((artifact, index) => <div key={artifact.id} className="overflow-hidden rounded-xl border border-[var(--line)]">
            {plan.submission.mode === "image" ? <Image src={artifact.url} alt={`作品第 ${plan.version} 版 · ${index + 1}`} rootClassName="w-full" className="w-full object-contain" /> : <video src={artifact.url} controls className="w-full object-contain" />}
            <div className="flex flex-wrap gap-1 p-2">
                <InkButton onClick={() => saveAs(artifact.url, `作品-${plan.version}-${index + 1}.${plan.submission.mode === "image" ? "png" : "mp4"}`)}>下载</InkButton>
                <InkButton onClick={() => void (async () => {
                    const accepted = await reuse(plan.submission.mode, { prompt: "", references: plan.submission.mode === "image" ? [{ id: artifact.id, name: `作品第 ${plan.version} 版`, type: artifact.mimeType || "image/png", dataUrl: artifact.url, storageKey: artifact.storageKey }] : plan.submission.references });
                    if (accepted) {
                        const state = useComposerStore.getState();
                        const id = state.activeConversations[scope];
                        state.updateConversation(id, { purpose: "discuss" });
                        document.querySelector<HTMLTextAreaElement>('[data-testid="composer"] textarea')?.focus();
                        if (plan.submission.mode === "video") message.info("当前仅引用原生成素材；视频理解与视频编辑能力尚未接入");
                    }
                })().catch((cause) => showErrorToast(message, cause))}>继续修改</InkButton>
                <CanvasDeliveryButton kind={plan.submission.mode} result={{ ...artifact, creation: plan.submission }} />
                <InkButton onClick={() => void mutateAsset(() => useAssetStore.getState().addAsset({ kind: plan.submission.mode, title: `作品第 ${plan.version} 版`, coverUrl: plan.submission.mode === "image" ? artifact.url : "", tags: [], source: "创作记录", data: { ...artifact, dataUrl: artifact.url }, metadata: { prompt: plan.submission.prompt, creation: plan.submission } }), "已存入素材")}>存素材</InkButton>
            </div>
        </div>)}</div>
        {owned.filter((task) => !artifacts.length || task.phase !== "done" || task.saveState === "error").map((task) => <div key={task.id} className="space-y-2 py-3 text-xs text-[color:var(--ink-500)]">
            {["requesting", "queued", "generating", "receiving"].includes(task.phase) ? <GenerationStatus kind={plan.submission.mode} taskId={task.id} variant="card" /> : <p>{task.phase === "failed" ? "生成失败" : task.phase === "unknown" ? "最新状态待确认" : task.saveState === "error" ? "作品已生成，保存未完成" : "正在读取作品"} · {task.error || task.saveError}</p>}
            <InkButton onClick={() => navigate(`/${plan.submission.mode}?task=${encodeURIComponent(task.id)}`)}>查看原任务 / 恢复结果</InkButton>
        </div>)}
    </div>;
}
