import { CreationConversationView } from "@/components/composer/creation-conversation";
import { useAgentStore } from "@/stores/use-agent-store";
import { persistVideoTask } from "@/lib/video-task-receipt";
import { useConfirmNewGeneration } from "@/hooks/use-confirm-new-generation";
import { generationError, requestOutcome } from "@/lib/generation-outcome";
import { recordCapabilityEvidence } from "@/stores/use-capability-evidence-store";
import { estimateCondition } from "@/lib/creation-estimates";
import { useCreationEstimatesStore } from "@/stores/use-creation-estimates-store";
import { CreationDetails } from "@/components/composer/creation-details";
import { Composer } from "@/components/composer/composer";
import { CanvasDeliveryButton, deliverToCanvas, prepareCanvasSubmission } from "@/components/composer/canvas-delivery";
import { createComposerSubmission, creationSnapshot, type ComposerSubmission, type CreationSnapshot } from "@/lib/composer";
import { beginCreationTask, updateCreationTask, useTaskStore, flushTaskSave } from "@/features/tasks/task-store";
import { useReuseCreation } from "@/hooks/use-reuse-creation";
import { consumeComposerDraft, useComposerStore } from "@/stores/use-composer-store";
import { CheckSquare, Download, FolderPlus, Plus, Trash2 } from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { App, Button, Checkbox, Modal, Tag, Typography } from "antd";
import localforage from "localforage";
import { nanoid } from "nanoid";
import { saveAs } from "file-saver";
import { useTranslation } from "react-i18next";
import { useSearchParams, useNavigate } from "react-router-dom";
import { failureKind, FailureTile, relativeTime, ResultSessionHeader, revealResults, WorkbenchEmpty, WorkbenchResults, WorkbenchShell, type WorkbenchTab } from "@/components/workbench/workbench-layout";
import { InkButton } from "@/components/ui/ink-button";
import { GenerationStatus } from "@/features/tasks/generation-status";
import { FriendlyErrorView } from "@/features/errors/friendly-error-view";

import { normalizeVideoResolutionValue, normalizeVideoSizeValue } from "@/components/video-settings-panel";
import { clampVideoSeconds } from "@/lib/media-size";
import { formatBytes, formatDuration } from "@/lib/image-utils";
import { resolveMediaUrl } from "@/services/file-storage";
import { resolveImageUrl, ensureImagePreview, getImagePreviewRevision, previewUrlFor, subscribeImagePreviews, uploadImage } from "@/services/image-storage";
import { createVideoGenerationTask, pollVideoGenerationTask, storeGeneratedVideo, type VideoGenerationTask, type VideoGenerationResult } from "@/services/api/video";
import { useAssetStore } from "@/stores/use-asset-store";
import { useAssetMutation } from "@/hooks/use-asset-mutation";
import { useWorkbenchAgentStore } from "@/stores/use-workbench-agent-store";
import { boolConfig, modelOptionName, resolveVideoSize, useConfigStore, useEffectiveConfig, type AiConfig } from "@/stores/use-config-store";
import type { ReferenceImage } from "@/types/image";
import i18n from "@/i18n";
import { STORAGE_NS } from "@/constant/brand";
import { showErrorToast } from "@/features/errors/error-toast";

type GeneratedVideo = {
    creation?: CreationSnapshot;
    id: string;
    url: string;
    storageKey: string;
    durationMs: number;
    width: number;
    height: number;
    bytes: number;
    mimeType: string;
};

type GenerationResult = {
    id: string;
    status: "pending" | "success" | "failed" | "unknown";
    video?: GeneratedVideo;
    generatedResult?: VideoGenerationResult;
    error?: string;
};

type GenerationLog = {
    id: string;
    createdAt: number;
    title: string;
    prompt: string;
    time: string;
    model: string;
    config: GenerationLogConfig;
    references: ReferenceImage[];
    durationMs: number;
    size: string;
    resolution: string;
    seconds: string;
    status: "pending" | "success" | "failed" | "unknown";
    creation?: CreationSnapshot;
    canvasProjectId?: string;
    task?: VideoGenerationTask;
    video?: GeneratedVideo;
    generatedResult?: VideoGenerationResult;
    error?: string;
};

type GenerationLogConfig = Pick<AiConfig, "model" | "videoModel" | "size" | "vquality" | "videoSeconds" | "videoGenerateAudio" | "videoWatermark" | "videoMode">;

const logStore = localforage.createInstance({ name: STORAGE_NS, storeName: "video_generation_logs" });

export default function VideoPage() {
    const { message, modal } = App.useApp();
    const conversation = useComposerStore((state) => state.conversations[state.activeConversations["video"]]);
    const confirmNewGeneration = useConfirmNewGeneration();
    const reuse = useReuseCreation();
    const [searchParams, setSearchParams] = useSearchParams();
    const focusTaskId = searchParams.get("task");
    const ledger = useTaskStore((state) => state.tasks);
    const taskLogs = useRef(new Map<string, GenerationLog>());
    const pollControllers = useRef(new Map<string, AbortController>());
    const mounted = useRef(true);
    useEffect(() => { mounted.current = true; return () => { mounted.current = false; pollControllers.current.forEach((controller) => controller.abort()); }; }, []);
    const stopWaiting = (id: string) => modal.confirm({ title: "停止本地等待？", content: "只停止本页查询，远端视频可能继续生成。原任务 ID 会保留，可稍后查询；这不代表取消或退还额度。", okText: "停止等待", cancelText: "继续等待", onOk: () => pollControllers.current.get(id)?.abort() });
    const visibleHistory = useRef<string | null>(null);
    const upsertResult = (result: GenerationResult) => setResults((items) => visibleHistory.current && visibleHistory.current !== result.id ? items : items.some((item) => item.id === result.id) ? items.map((item) => item.id === result.id ? result : item) : [...items, result]);
    const submissionRef = useRef<ComposerSubmission | undefined>(undefined);
    const submitting = useRef(false);
    const lastSubmissionRef = useRef<ComposerSubmission | undefined>(undefined);
    const lastTaskLogRef = useRef<GenerationLog | undefined>(undefined);
    const [session, setSession] = useState<CreationSnapshot | undefined>(undefined);
    const { t } = useTranslation();
    const navigate = useNavigate();
    useSyncExternalStore(subscribeImagePreviews, getImagePreviewRevision);
    const activeLogIdsRef = useRef<Set<string>>(new Set());
    const effectiveConfig = useEffectiveConfig();
    const updateConfig = useConfigStore((state) => state.updateConfig);
    const isAiConfigReady = useConfigStore((state) => state.isAiConfigReady);
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);
    const addAsset = useAssetStore((state) => state.addAsset);
    const mutateAsset = useAssetMutation();
    const { prompt, references } = useComposerStore((state) => state.video);
    const setPrompt = (prompt: string) => useComposerStore.getState().patch("video", { prompt });
    const setReferences = (next: ReferenceImage[] | ((refs: ReferenceImage[]) => ReferenceImage[])) => useComposerStore.getState().setReferences("video", next);
    const [results, setResults] = useState<GenerationResult[]>([]);
    const [logs, setLogs] = useState<GenerationLog[]>([]);
    const [running, setRunning] = useState(false);
    const [panelTab, setPanelTab] = useState<WorkbenchTab>("results");
    const [startedAt, setStartedAt] = useState(0);
    const [elapsedMs, setElapsedMs] = useState(0);
    const [selectedLogIds, setSelectedLogIds] = useState<string[]>([]);
    const [previewLog, setPreviewLog] = useState<GenerationLog | null>(null);
    const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
    const [autoRunToken, setAutoRunToken] = useState(0);
    const videoCommand = useWorkbenchAgentStore((state) => state.videoCommand);
    const clearVideoCommand = useWorkbenchAgentStore((state) => state.clearVideoCommand);
    const updateAgentTask = useWorkbenchAgentStore((state) => state.updateTask);
    const processedCommandRef = useRef(0);
    const agentTaskIdRef = useRef<string | undefined>(undefined);

    const model = effectiveConfig.videoModel.trim();

    useEffect(() => {
        if (!running || !startedAt) return;
        const timer = window.setInterval(() => setElapsedMs(performance.now() - startedAt), 1000);
        return () => window.clearInterval(timer);
    }, [running, startedAt]);

    useEffect(() => {
        void refreshLogs();
    }, []);

    const generate = async (source?: ComposerSubmission) => {
        if (running || submitting.current) return;
        const draft = useComposerStore.getState().video;
        visibleHistory.current = null;
        const incoming = source || submissionRef.current;
        submissionRef.current = undefined;
        const agentTaskId = agentTaskIdRef.current;
        agentTaskIdRef.current = undefined;
        let snapshot = buildRequestSnapshot(incoming);
        if (!snapshot) {
            if (agentTaskId) updateAgentTask(agentTaskId, { status: "failed", error: t("videoWorkbench.invalidParams") });
            return;
        }
        submitting.current = true;
        lastSubmissionRef.current = snapshot.submission;
        lastTaskLogRef.current = undefined;
        setElapsedMs(0);
        setRunning(true);
        setPanelTab("results");
        revealResults();
        if (agentTaskId) updateAgentTask(agentTaskId, { status: "running", error: undefined });
        setPreviewLog(null);
        setResults([{ id: nanoid(), status: "pending" }]);
        const batchStartedAt = performance.now();
        setStartedAt(batchStartedAt);
        let intent: GenerationLog | undefined;
        let submitted = false;
        try {
            snapshot = { ...snapshot, submission: await prepareCanvasSubmission(snapshot.submission) };
            lastSubmissionRef.current = snapshot.submission;
            setSession(creationSnapshot(snapshot.submission));
            const model = snapshot.config.model;
            intent = buildLog({ prompt: snapshot.text, model, config: snapshot.config, references: snapshot.references, durationMs: 0, status: "unknown", error: "请求已准备；若响应丢失，无法证明远端未接受，请勿自动重提" });
            intent.creation = creationSnapshot(snapshot.submission);
            intent.canvasProjectId = snapshot.submission.canvasProjectId;
            await saveLog(intent, false);
            beginCreationTask({ id: `video:${intent.id}`, batchId: intent.id, creationId: snapshot.submission.id, kind: "video", model, source: "api", sourcePath: "/video", summary: snapshot.text });
            await flushTaskSave();
            setResults([{ id: intent.id, status: "pending" }]);
            submitted = true;
            const task = await createVideoGenerationTask(snapshot.config, snapshot.text, snapshot.references);
            const log = { ...intent, status: "pending" as const, task, error: undefined };
            lastTaskLogRef.current = log;
            log.creation = creationSnapshot(snapshot.submission);
            log.canvasProjectId = snapshot.submission.canvasProjectId;
            await persistVideoTask(task, () => saveLog(log, false));
            taskLogs.current.set(log.id, log);
            updateCreationTask(`video:${log.id}`, { phase: "generating", remoteId: task.id });
            if (!incoming || draft.prompt === incoming.composerContent) consumeComposerDraft("video", draft);
            submitting.current = false;
            void pollGenerationLog(log, snapshot.config, agentTaskId);
        } catch (error) {
            const rescue = lastTaskLogRef.current;
            const errorMessage = rescue?.task ? `远端任务 ID 已收到但未完成本地保存：${rescue.task.id}。请复制此 ID；修复存储后取原任务状态，不要重新提交。${error instanceof Error ? error.message : ""}` : error instanceof Error ? error.message : t("workbench.generationFailed");
            const status = rescue?.task || submitted && requestOutcome(error) === "unknown" ? "unknown" as const : "failed" as const;
            setResults([{ id: rescue?.id || intent?.id || nanoid(), status, error: errorMessage }]);
            if (intent) updateCreationTask(`video:${intent.id}`, { phase: status, error: errorMessage, remoteId: rescue?.task?.id });
            if (agentTaskId) updateAgentTask(agentTaskId, { status: "failed", successCount: 0, failCount: 1, error: errorMessage });
            if (intent) {
                const saved = { ...(rescue || intent), status, durationMs: performance.now() - batchStartedAt, error: errorMessage };
                lastTaskLogRef.current = saved;
                try { await saveLog(saved, false); } catch { message.error("任务历史尚未保存；保留当前页面并复制原任务 ID 抢救"); }
            }
            showErrorToast(message, error, errorMessage);
            setRunning(false); submitting.current = false;
        }
    };

    // Handle video-generation commands from the Agent panel by setting the prompt and optionally starting generation.
    useEffect(() => {
        if (!videoCommand || videoCommand.nonce === processedCommandRef.current) return;
        processedCommandRef.current = videoCommand.nonce;
        useAgentStore.getState().setAgentState({ composerAgentMode: false });
        clearVideoCommand();
        if (!videoCommand.submission && typeof videoCommand.prompt === "string") setPrompt(videoCommand.prompt);
        if (videoCommand.submission) {
            submissionRef.current = videoCommand.submission;
            setReferences(videoCommand.submission.references);
            useComposerStore.getState().patch("video", { canvas: videoCommand.submission.canvas });
        }
        if (videoCommand.run && running) {
            if (videoCommand.taskId) updateAgentTask(videoCommand.taskId, { status: "failed", error: t("videoWorkbench.busy") });
            return;
        }
        if (videoCommand.run) {
            agentTaskIdRef.current = videoCommand.taskId;
            setAutoRunToken((value) => value + 1);
        }
    }, [videoCommand, clearVideoCommand, running, updateAgentTask]);

    useEffect(() => {
        if (!autoRunToken) return;
        void generate();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [autoRunToken]);

    const buildRequestSnapshot = (source?: ComposerSubmission) => {
        try {
            const submission = source || createComposerSubmission("video", prompt, references, effectiveConfig, useComposerStore.getState().video.canvas);
            const requestConfig = { ...effectiveConfig, ...submission.parameters, model: submission.parameters.videoModel };
            if (!isAiConfigReady(requestConfig, requestConfig.model)) {
                message.warning(t("workbench.configFirst"));
                openConfigDialog(true);
                return null;
            }
            return { text: submission.prompt, config: requestConfig, references: submission.references, submission };
        } catch (error) {
            showErrorToast(message, error);
            return null;
        }
    };

    const retryResult = async (id: string) => {
        const log = taskLogs.current.get(id) || logs.find((item) => item.id === id);
        if (log?.task || log?.generatedResult) {
            try { await saveLog(log, false); await pollGenerationLog(log); } catch (error) { showErrorToast(message, error, "原任务尚未保存，请先抢救任务 ID"); }
            return;
        }
        if (!await confirmNewGeneration()) return;
        const submission = log?.creation ? { ...log.creation, references: log.references, canvas: Boolean(log.canvasProjectId), canvasProjectId: log.canvasProjectId } : lastSubmissionRef.current;
        if (!submission) { message.error("原始提交快照不存在，请重新生成"); return; }
        void generate(submission);
    };

    const downloadVideo = (video: GeneratedVideo) => {
        saveAs(video.url, "video.mp4");
    };

    const saveResultToAssets = (video: GeneratedVideo) => {
        return mutateAsset(() => addAsset({
            kind: "video",
            title: t("videoWorkbench.resultTitle"),
            coverUrl: "",
            tags: [],
            source: t("videoWorkbench.source"),
            data: { url: video.url, storageKey: video.storageKey, width: video.width, height: video.height, bytes: video.bytes, mimeType: video.mimeType },
            metadata: { source: "video-page", prompt: video.creation?.prompt, creation: video.creation },
        }), t("common.addedToAssets"));
    };

    useEffect(() => {
        const focus = (event: Event) => {
            if ((event as CustomEvent).detail !== "video") return;
            setPanelTab("results"); setPreviewLog(null); setSearchParams({}, { replace: true });
        };
        window.addEventListener("creation-focus", focus);
        return () => window.removeEventListener("creation-focus", focus);
    }, [setSearchParams]);
    const createSession = () => {
        useComposerStore.getState().ensureConversation("video", "video", true);
        visibleHistory.current = null;
        setSession(undefined);
        setPrompt("");
        setReferences([]);
        setResults([]);
        setElapsedMs(0);
        setStartedAt(0);
        setSelectedLogIds([]);
        setPreviewLog(null);
    };

    const deleteSelectedLogs = () => {
        void Promise.all(selectedLogIds.map((id) => logStore.removeItem(id))).then(() => {
            useAssetStore.getState().cleanupImages();
            void refreshLogs();
        });
        if (previewLog && selectedLogIds.includes(previewLog.id)) {
            setPreviewLog(null);
            setResults([]);
        }
        setSelectedLogIds([]);
        setDeleteConfirmOpen(false);
    };

    const saveLog = async (log: GenerationLog, resumePending = true) => {
        await logStore.setItem(log.id, serializeLog(log));
        window.dispatchEvent(new Event("creation-history-updated"));
        await refreshLogs(resumePending);
    };

    const refreshLogs = async (resumePending = true) => {
        const nextLogs = await readStoredLogs();
        setLogs(nextLogs);
        if (resumePending) resumePendingLogs(nextLogs);
        return nextLogs;
    };

    const resumePendingLogs = (items: GenerationLog[]) => {
        for (const log of items) {
            taskLogs.current.set(log.id, log);
            if (log.status === "pending" && log.task) void pollGenerationLog(log);
        }
    };

    const pollGenerationLog = async (log: GenerationLog, configOverride?: AiConfig, agentTaskId?: string) => {
        if ((!log.task && !log.generatedResult) || activeLogIdsRef.current.has(log.id)) return;
        if (!mounted.current) { updateCreationTask(`video:${log.id}`, { phase: "unknown", error: "页面等待已中断，可查询原任务" }); return; }
        const controller = new AbortController();
        pollControllers.current.set(log.id, controller);
        taskLogs.current.set(log.id, log);
        activeLogIdsRef.current.add(log.id);
        setRunning(true);
        setStartedAt((value) => value || performance.now());
        upsertResult({ id: log.id, status: "pending" });
        const id = `video:${log.id}`;
        if (!useTaskStore.getState().tasks.some((item) => item.id === id)) beginCreationTask({ id, batchId: log.id, kind: "video", model: log.model, summary: log.prompt, sourcePath: "/video", startedAt: log.createdAt });
        updateCreationTask(id, { phase: "generating", remoteId: log.task?.id, error: undefined });
        const taskConfig = buildVideoConfig({ ...effectiveConfig, ...log.config, size: effectiveConfig.size, videoSize: log.config.size || effectiveConfig.videoSize }, log.task?.model || log.model);
        let generated = log.generatedResult || (log.video?.storageKey ? { url: log.video.url } : undefined), confirmedFailure = false;
        try {
            if (!generated) for (let attempt = 0; attempt < 120; attempt += 1) {
                const state = await pollVideoGenerationTask(configOverride || taskConfig, log.task!, { signal: controller.signal });
                if (state.status === "completed") { generated = state.result; break; }
                if (state.status === "failed") { confirmedFailure = true; throw new Error(state.error); }
                if (attempt === 119) throw new Error(t("videoWorkbench.timeout"));
                await delay(2500);
            }
            if (!generated) return;
            updateCreationTask(id, { phase: "done", saveState: "saving" });
            // Keep the successful output separate from file/history saving, including a rescue preview.
            const rawVideo: GeneratedVideo = log.video || { id: log.id, creation: log.creation, url: generated.blob ? URL.createObjectURL(generated.blob) : generated.url || "", storageKey: "", durationMs: Date.now() - log.createdAt, width: 0, height: 0, bytes: generated.blob?.size || 0, mimeType: generated.mimeType || "video/mp4" };
            upsertResult({ id: log.id, status: "success", video: rawVideo });
            const receipt = { ...log, status: "success" as const, generatedResult: generated, video: rawVideo };
            taskLogs.current.set(log.id, receipt);
            await saveLog(receipt, false);
            const stored = rawVideo.storageKey ? undefined : await storeGeneratedVideo(generated);
            if (stored && !stored.storageKey) throw new Error("视频原文件尚未存入浏览器");
            const video = stored ? { ...rawVideo, ...stored, url: stored.url } : rawVideo;
            upsertResult({ id: log.id, status: "success", video });
            const completed = { ...receipt, video, generatedResult: undefined, error: undefined, durationMs: video.durationMs };
            taskLogs.current.set(log.id, completed);
            await saveLog(completed, false);
            updateCreationTask(id, { saveState: "saved", saveError: undefined });
            if (rawVideo.url.startsWith("blob:") && rawVideo.url !== video.url) URL.revokeObjectURL(rawVideo.url);
            if (agentTaskId) updateAgentTask(agentTaskId, { status: "succeeded", successCount: 1, failCount: 0, error: undefined });
            void recordCapabilityEvidence(configOverride || taskConfig, "video", log.task?.model || log.model).catch(() => {});
            if (log.creation) { const condition = estimateCondition(configOverride || taskConfig, { ...log.creation, references: log.references, canvas: false }); if (log.task?.endpoint) condition.endpoint = log.task.endpoint; void useCreationEstimatesStore.getState().record(log.id, condition, video.durationMs).catch((error) => showErrorToast(message, error, "结果已生成，耗时记录保存失败")); }
            message.success(t("videoWorkbench.generated"));
            if (log.canvasProjectId) await deliverToCanvas("video", video, log.canvasProjectId).catch((error) => showErrorToast(message, error, "作品已保存，送入画布失败；可从结果重试送入"));
        } catch (error) {
            const text = error instanceof Error ? error.message : String(error);
            if (generated) {
                updateCreationTask(id, { phase: "done", saveState: "error", saveError: text });
                showErrorToast(message, error, "视频已生成，保存未完成；保留作品，可下载或重试保存，不需要重新生成");
            } else {
                const status = confirmedFailure ? "failed" as const : "unknown" as const;
                const saved = { ...log, status, task: confirmedFailure ? undefined : log.task, error: confirmedFailure ? text : `查询中断，远端状态未知；请查询原任务。${text}` };
                taskLogs.current.set(log.id, saved);
                upsertResult({ id: log.id, status, error: saved.error });
                updateCreationTask(id, { phase: status, error: saved.error });
                if (agentTaskId) updateAgentTask(agentTaskId, { status: status === "unknown" ? "unknown" : "failed", error: saved.error });
                await saveLog(saved, false).catch((cause) => showErrorToast(message, cause, "任务历史尚未保存，请保留原任务 ID"));
            }
        } finally {
            activeLogIdsRef.current.delete(log.id);
            pollControllers.current.delete(log.id);
            if (!activeLogIdsRef.current.size) { setRunning(false); submitting.current = false; setStartedAt(0); }
        }
    };

    const previewGenerationLog = (log: GenerationLog) => {
        lastTaskLogRef.current = log;
        lastSubmissionRef.current = log.creation ? { ...log.creation, references: log.references || [], canvas: Boolean(log.canvasProjectId), canvasProjectId: log.canvasProjectId } : undefined;
        visibleHistory.current = log.id;
        setPreviewLog(log);
        setSession(undefined);
        setPanelTab("results");
        setResults(log.status === "pending" ? [{ id: log.id, status: "pending" }] : log.video ? [{ id: log.id, status: "success", video: log.video }] : [{ id: log.id, status: log.status === "unknown" ? "unknown" : "failed", error: log.error || t("workbench.generationFailed") }]);
    };

    useEffect(() => { if (!focusTaskId?.startsWith("video:")) return; const log = logs.find((item) => `video:${item.id}` === focusTaskId); if (log && previewLog?.id !== log.id) previewGenerationLog(log); }, [focusTaskId, logs]);

    const sessionPrompt = (previewLog?.prompt || session?.prompt || "").trim();

    return (
        <div className="flex h-full flex-col overflow-hidden bg-[var(--paper-1)] text-[color:var(--ink-900)]">
            <WorkbenchShell
                results={
                    <WorkbenchResults
                        tab={panelTab}
                        onTabChange={setPanelTab}
                        logCount={logs.length}
                        status={running ? <span className="text-xs tabular-nums text-[color:var(--ink-500)]">{t("workbench.waiting", { time: formatDuration(elapsedMs) })}</span> : null}
                    >
                        {panelTab === "logs" ? (
                            <LogPanel
                                logs={logs}
                                selectedLogIds={selectedLogIds}
                                activeLogId={previewLog?.id}
                                onSelectedLogIdsChange={setSelectedLogIds}
                                onCreateSession={createSession}
                                onDeleteSelected={() => setDeleteConfirmOpen(true)}
                                onPreviewLog={previewGenerationLog}
                            />
                        ) : conversation && !focusTaskId && !previewLog ? <CreationConversationView scope="video" mode="video" /> : results.length ? (
                            <>
                                {previewLog && <InkButton onClick={() => void reuse("video", { prompt: previewLog.prompt, references: previewLog.references }, () => { Object.entries(previewLog.config).filter(([key]) => key !== "model").forEach(([key, value]) => updateConfig((key === "size" ? "videoSize" : key) as keyof AiConfig, value)); })}>复用条件</InkButton>}
                                <ResultSessionHeader
                                    time={previewLog ? relativeTime(previewLog.createdAt) : "刚刚"}
                                    prompt={sessionPrompt.slice(0, 24) + (sessionPrompt.length > 24 ? "…" : "")}
                                    meta={
                                        session
                                            ? `${modelOptionName(session.parameters.videoModel)} · ${Object.entries(session.actual)
                                                  .map(([key, value]) => `${key}=${value}`)
                                                  .join(" · ")}`
                                            : previewLog
                                              ? `${modelOptionName(previewLog.model)} · ${previewLog.size} · ${previewLog.seconds} 秒`
                                              : ""
                                    }
                                />
                                <div className="grid gap-4 2xl:grid-cols-2">
                                    {results.map((result) =>
                                        result.status === "success" && result.video ? (
                                            <ResultVideoCard key={result.id} saveError={ledger.find((task) => task.id === `video:${result.id}`)?.saveError} onRetrySave={() => void retryResult(result.id)} video={result.video} onDownload={downloadVideo} onSaveAsset={saveResultToAssets} />
                                        ) : result.status === "failed" || result.status === "unknown" ? (
                                            <FailureTile
                                                key={result.id}
                                                aspect="aspect-video"
                                                title={result.status === "unknown" ? "结果未知" : "请求未完成"}
                                                retryLabel={taskLogs.current.get(result.id)?.task ? "取原任务状态" : "新建生成请求"}
                                                error={result.error || t("workbench.generationFailed")}
                                                onRetry={() => void retryResult(result.id)}
                                                fixes={
                                                    failureKind(result.error || "") === "key" ? (
                                                        <InkButton size={32} variant="ink" onClick={() => openConfigDialog(false)}>
                                                            检查设置
                                                        </InkButton>
                                                    ) : null
                                                }
                                            >
                                                {result.status === "unknown" ? <div className="space-y-2 text-xs"><p>结果未知；原请求可能仍在执行。</p>{taskLogs.current.get(result.id)?.task ? <><p className="select-text break-all">原任务 ID：{taskLogs.current.get(result.id)?.task?.id}</p><InkButton onClick={() => void retryResult(result.id)}>取任务状态（沿用原 ID）</InkButton></> : <p>没有任务 ID；重新生成会创建新请求，可能再次计费。</p>}</div> : <FriendlyErrorView error={result.error || t("workbench.generationFailed")} />}
                                            </FailureTile>
                                        ) : (
                                            <PendingVideoCard key={result.id} taskId={`video:${result.id}`} onStop={() => stopWaiting(result.id)} />
                                        ),
                                    )}
                                </div>
                            </>
                        ) : (
                            <WorkbenchEmpty title="写一句镜头描述就能开始" hint="视频通常需要几分钟；离开会停止本页等待，返回后沿用原任务 ID 查询，不会重复生成。" examples={t("workbenchUi.videoExamples").split("|").filter(Boolean)} onPick={setPrompt} />
                        )}
                    </WorkbenchResults>
                }
                composer={<Composer mode="video" busy={running} onSubmit={(submission) => generate(submission)} />}
            />
            <Modal title={t("workbench.deleteLogs")} open={deleteConfirmOpen} onCancel={() => setDeleteConfirmOpen(false)} onOk={deleteSelectedLogs} okText={t("common.delete")} okButtonProps={{ danger: true }} cancelText={t("common.cancel")}>
                {t("workbench.deleteLogsConfirm", { count: selectedLogIds.length })}
            </Modal>
        </div>
    );
}

function ResultVideoCard({ video, saveError, onRetrySave, onDownload, onSaveAsset }: { saveError?: string; onRetrySave: () => void; video: GeneratedVideo; onDownload: (video: GeneratedVideo) => void; onSaveAsset: (video: GeneratedVideo) => void }) {
    const { t } = useTranslation();
    const { message } = App.useApp();
    const player = useRef<HTMLVideoElement>(null);
    const useFrame = async () => {
        const element = player.current;
        if (!element || element.readyState < 2) {
            message.info("请等待视频加载后选择画面");
            return;
        }
        try {
            const frame = document.createElement("canvas");
            frame.width = element.videoWidth;
            frame.height = element.videoHeight;
            frame.getContext("2d")!.drawImage(element, 0, 0);
            const stored = await uploadImage(frame.toDataURL("image/png"));
            useComposerStore.getState().setReferences("video", (refs) => [...refs, { id: nanoid(), name: "视频当前帧", type: stored.mimeType, dataUrl: stored.url, storageKey: stored.storageKey }]);
            message.success("当前帧已作参考，请核对附件用途后提交");
        } catch (error) {
            showErrorToast(message, error, "此视频无法提取参考帧，请上传图片");
        }
    };
    return (
        <div className="overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--paper-0)]">
            <video ref={player} src={video.url} controls className="w-full bg-black object-contain" />
            {saveError && <div role="alert" className="p-3 text-xs text-[color:var(--zhu-600)]">视频已生成，保存未完成：{saveError}<InkButton onClick={onRetrySave}>重试保存，不重新生成</InkButton></div>}
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-t border-[var(--line)] px-3 py-2.5">
                <div className="flex min-w-0 flex-wrap gap-x-2 gap-y-1 text-xs text-[color:var(--ink-500)]">
                    <span>
                        {video.width}x{video.height}
                    </span>
                    <span>{formatBytes(video.bytes)}</span>
                    <span>{formatDuration(video.durationMs)}</span>
                </div>
                <div className="flex flex-wrap gap-1">
                    <InkButton size={32} variant="paper" onClick={() => void useFrame()} title="将视频当前帧作为图片参考">
                        作参考
                    </InkButton>
                    <CanvasDeliveryButton kind="video" result={video} />
                    <CreationDetails creation={video.creation} />
                    <Button size="small" icon={<FolderPlus className="size-3.5" />} onClick={() => onSaveAsset(video)}>
                        {t("common.addToAssets")}
                    </Button>
                    <Button size="small" icon={<Download className="size-3.5" />} onClick={() => onDownload(video)}>
                        {t("common.download")}
                    </Button>
                </div>
            </div>
        </div>
    );
}

function PendingVideoCard({ taskId, onStop }: { taskId: string; onStop: () => void }) {
    return (
        <div className="relative grid aspect-video place-items-center overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--paper-2)] text-[color:var(--ink-500)]">
            {/* [dianran] 晕染占位：真实阶段 + 已等待时长，可离开页面 */}
            <div className="space-y-3 text-center"><GenerationStatus kind="video" taskId={taskId} variant="card" /><InkButton onClick={onStop}>停止等待</InkButton></div>
        </div>
    );
}

function LogPanel({
    logs,
    selectedLogIds,
    activeLogId,
    onSelectedLogIdsChange,
    onCreateSession,
    onDeleteSelected,
    onPreviewLog,
}: {
    logs: GenerationLog[];
    selectedLogIds: string[];
    activeLogId?: string;
    onSelectedLogIdsChange: (ids: string[]) => void;
    onCreateSession: () => void;
    onDeleteSelected: () => void;
    onPreviewLog: (log: GenerationLog) => void;
}) {
    const { t } = useTranslation();
    const allSelected = Boolean(logs.length) && selectedLogIds.length === logs.length;
    const toggleAll = () => onSelectedLogIdsChange(allSelected ? [] : logs.map((log) => log.id));

    return (
        <>
            <div className="mb-3 flex items-center justify-between gap-3">
                <h2 className="text-base font-semibold">{t("workbench.logs")}</h2>
                <Tag className="m-0">{logs.length}</Tag>
            </div>
            <div className="mb-4 flex flex-wrap gap-2">
                <Button size="small" icon={<Plus className="size-3.5" />} onClick={onCreateSession}>
                    {t("workbench.new")}
                </Button>
                <Button size="small" icon={<CheckSquare className="size-3.5" />} disabled={!logs.length} onClick={toggleAll}>
                    {allSelected ? t("common.cancel") : t("workbench.selectAll")}
                </Button>
                <Button size="small" danger icon={<Trash2 className="size-3.5" />} disabled={!selectedLogIds.length} onClick={onDeleteSelected}>
                    {t("common.delete")}
                </Button>
            </div>
            <div className="space-y-3">
                {logs.map((log) => (
                    <LogCard
                        key={log.id}
                        log={log}
                        selected={selectedLogIds.includes(log.id)}
                        active={activeLogId === log.id}
                        onSelectedChange={(checked) => onSelectedLogIdsChange(checked ? [...selectedLogIds, log.id] : selectedLogIds.filter((id) => id !== log.id))}
                        onClick={() => onPreviewLog(log)}
                    />
                ))}
                {!logs.length ? <div className="flex min-h-48 items-center justify-center rounded-xl border border-dashed border-[var(--line-strong)] text-center text-sm text-[color:var(--ink-500)]">{t("workbench.noLogs")}</div> : null}
            </div>
        </>
    );
}

function LogCard({ log, selected, active, onSelectedChange, onClick }: { log: GenerationLog; selected: boolean; active: boolean; onSelectedChange: (checked: boolean) => void; onClick: () => void }) {
    const { t } = useTranslation();
    return (
        <button type="button" className={`block w-full rounded-lg border p-2 text-left transition ${active ? "border-[var(--ink-900)] bg-[var(--paper-2)]" : "border-[var(--line)] bg-[var(--paper-0)] hover:bg-[var(--paper-2)]"}`} onClick={onClick}>
            <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-2">
                <Checkbox className="mt-0.5" checked={selected} onClick={(event) => event.stopPropagation()} onChange={(event) => onSelectedChange(event.target.checked)} />
                <div className="min-w-0">
                    <div className="truncate text-sm font-semibold leading-5">{log.title}</div>
                    <div className="mt-2 flex flex-wrap gap-1">
                        <Tag className="m-0 flex h-6 items-center rounded-md px-1.5 text-xs leading-none">{log.size}</Tag>
                        <Tag className="m-0 flex h-6 items-center rounded-md px-1.5 text-xs leading-none">{log.resolution}p</Tag>
                        <Tag className="m-0 flex h-6 items-center rounded-md px-1.5 text-xs leading-none">{log.seconds}s</Tag>
                    </div>
                </div>
                <div className="grid justify-items-end gap-2">
                    <Tag className="m-0 flex h-6 items-center rounded-md px-1.5 text-xs leading-none" color={log.status === "success" ? "blue" : log.status === "pending" ? "processing" : "red"}>
                        {log.status === "unknown" ? "结果未知" : t(`workbench.${log.status === "success" ? "success" : log.status === "pending" ? "generating" : "failed"}`)}
                    </Tag>
                    <Tag className="m-0 flex h-6 items-center rounded-md px-1.5 text-xs leading-none" color="green">
                        {formatDuration(log.durationMs)}
                    </Tag>
                </div>
            </div>
        </button>
    );
}

async function readStoredLogs() {
    if (typeof window === "undefined") return [];
    try {
        const logs: GenerationLog[] = [];
        await logStore.iterate<GenerationLog, void>((value) => {
            logs.push(value);
        });
        return (await Promise.all(logs.map(normalizeLog))).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    } catch {
        return [];
    }
}

async function normalizeLog(log: Partial<GenerationLog>): Promise<GenerationLog> {
    const video = log.video?.storageKey ? { ...log.video, url: await resolveMediaUrl(log.video.storageKey, log.video.url) } : log.generatedResult?.blob && log.video ? { ...log.video, url: URL.createObjectURL(log.generatedResult.blob) } : log.video;
    const references = await Promise.all(
        (log.references || []).map(async (item) => {
            void ensureImagePreview(item.storageKey);
            return { ...item, dataUrl: await resolveImageUrl(item.storageKey, item.dataUrl) };
        }),
    );
    const config = normalizeLogConfig(log);
    return {
        id: log.id || nanoid(),
        createdAt: log.createdAt || Date.now(),
        title: log.title || log.model || i18n.t("workbench.untitled"),
        prompt: log.prompt || "",
        time: log.time || new Date().toLocaleString(i18n.resolvedLanguage, { hour12: false }),
        model: log.model || config.videoModel || "",
        config,
        references,
        durationMs: log.durationMs || 0,
        size: log.size || config.size || "",
        resolution: normalizeResolution(log.resolution || config.vquality || ""),
        seconds: log.seconds || config.videoSeconds || "",
        status: log.status === "pending" && !log.task ? "unknown" : log.status || "success",
        creation: log.creation,
        canvasProjectId: log.canvasProjectId,
        task: log.task,
        generatedResult: log.generatedResult,
        video,
        error: log.error,
    };
}

function serializeLog(log: GenerationLog): GenerationLog {
    return {
        ...log,
        references: log.references.map((item) => ({ ...item, dataUrl: item.storageKey ? "" : item.dataUrl })),
        video: log.video?.storageKey ? { ...log.video, url: "" } : log.video,
    };
}

function normalizeLogConfig(log: Partial<GenerationLog>): GenerationLogConfig {
    return {
        model: log.config?.model || log.model || "",
        videoModel: log.config?.videoModel || log.model || "",
        size: log.config?.size || log.size || "",
        vquality: normalizeResolution(log.config?.vquality || log.resolution || ""),
        videoSeconds: log.config?.videoSeconds || log.seconds || "",
        videoGenerateAudio: log.config?.videoGenerateAudio || "true",
        videoWatermark: log.config?.videoWatermark || "false",
        videoMode: log.config?.videoMode === "reference" ? "reference" : "frames",
    };
}

function buildLog({
    prompt,
    model,
    config,
    references,
    durationMs,
    status,
    task,
    video,
    error,
}: {
    prompt: string;
    model: string;
    config: AiConfig;
    references: ReferenceImage[];
    durationMs: number;
    status: GenerationLog["status"];
    task?: VideoGenerationTask;
    video?: GeneratedVideo;
    generatedResult?: VideoGenerationResult;
    error?: string;
}): GenerationLog {
    const logConfig = {
        model: config.model,
        videoModel: config.videoModel,
        size: config.videoSize || resolveVideoSize(config),
        vquality: normalizeResolution(config.vquality),
        videoSeconds: config.videoSeconds,
        videoGenerateAudio: config.videoGenerateAudio,
        videoWatermark: config.videoWatermark,
        videoMode: config.videoMode === "reference" ? "reference" : "frames",
    };
    return {
        id: nanoid(),
        createdAt: Date.now(),
        title: prompt.slice(0, 12) || i18n.t("workbench.untitled"),
        prompt,
        time: new Date().toLocaleString(i18n.resolvedLanguage, { hour12: false }),
        model,
        config: logConfig,
        references,
        durationMs,
        size: logConfig.size,
        resolution: logConfig.vquality,
        seconds: logConfig.videoSeconds,
        status,
        task,
        video,
        error,
    };
}

function buildVideoConfig(config: AiConfig, model: string): AiConfig {
    return {
        ...config,
        model,
        videoModel: model,
        videoSize: normalizeVideoSize(resolveVideoSize(config)),
        videoSeconds: normalizeVideoSeconds(config.videoSeconds),
        vquality: normalizeResolution(config.vquality),
        videoGenerateAudio: String(boolConfig(config.videoGenerateAudio, true)),
        videoWatermark: String(boolConfig(config.videoWatermark, false)),
        videoMode: config.videoMode === "reference" ? "reference" : "frames",
    };
}

function normalizeVideoSeconds(value: string) {
    if (String(value).trim() === "-1") return "-1";
    return clampVideoSeconds(value);
}

function normalizeVideoSize(value: string) {
    return normalizeVideoSizeValue(value);
}

function normalizeResolution(value: string) {
    return normalizeVideoResolutionValue(value);
}

function delay(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
