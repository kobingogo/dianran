import { CreationConversationView } from "@/components/composer/creation-conversation";
import { useAgentStore } from "@/stores/use-agent-store";
import { createSaveQueue } from "@/lib/canvas/save-queue";
import { useConfirmNewGeneration } from "@/hooks/use-confirm-new-generation";
import { requestOutcome } from "@/lib/generation-outcome";
import { AgentMediaPanel } from "@/components/agent/agent-media-panel";
import { selectImageSource, useAgentMediaStore } from "@/stores/use-agent-media-store";
import { estimateCondition } from "@/lib/creation-estimates";
import { useCreationEstimatesStore } from "@/stores/use-creation-estimates-store";
import { CreationComparison, type ComparisonItem } from "@/components/composer/creation-comparison";
import { CreationDetails } from "@/components/composer/creation-details";
import { Composer } from "@/components/composer/composer";
import { CanvasDeliveryButton, deliverToCanvas, prepareCanvasSubmission } from "@/components/composer/canvas-delivery";
import { createComposerSubmission, creationSnapshot, type ComposerSubmission, type CreationSnapshot } from "@/lib/composer";
import { beginCreationTask, updateCreationTask, useTaskStore, flushTaskSave } from "@/features/tasks/task-store";
import { useReuseCreation } from "@/hooks/use-reuse-creation";
import { consumeComposerDraft, useComposerStore } from "@/stores/use-composer-store";
import { CheckSquare, Download, PenLine, Plus, Trash2 } from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { App, Button, Checkbox, Image, Modal, Tag } from "antd";
import localforage from "localforage";
import { saveAs } from "file-saver";
import { useSearchParams, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { failureKind, FailureTile, relativeTime, ResultSessionHeader, revealResults, WorkbenchEmpty, WorkbenchResults, WorkbenchShell, type WorkbenchTab } from "@/components/workbench/workbench-layout";
import { InkButton } from "@/components/ui/ink-button";
import { InkChip } from "@/components/ui/chip";
import { GenerationStatus } from "@/features/tasks/generation-status";
import { FriendlyErrorView } from "@/features/errors/friendly-error-view";

import { useImageCapabilities } from "@/components/image-settings-panel";
import { modelOptionName, useConfigStore, useEffectiveConfig, type AiConfig } from "@/stores/use-config-store";
import { nanoid } from "nanoid";
import { formatBytes, formatDuration } from "@/lib/image-utils";
import { requestEdit, requestGeneration } from "@/services/api/image";
import { ensureImagePreview, getImagePreviewRevision, previewUrlFor, resolveImageUrl, subscribeImagePreviews, uploadImage } from "@/services/image-storage";
import { useAssetStore } from "@/stores/use-asset-store";
import { useAssetMutation } from "@/hooks/use-asset-mutation";
import { useWorkbenchAgentStore } from "@/stores/use-workbench-agent-store";
import type { ReferenceImage } from "@/types/image";
import i18n from "@/i18n";
import { STORAGE_NS } from "@/constant/brand";
import { showErrorToast } from "@/features/errors/error-toast";

type GeneratedImage = {
    creation?: CreationSnapshot;
    taskId?: string;
    id: string;
    dataUrl: string;
    storageKey?: string;
    durationMs: number;
    width: number;
    height: number;
    bytes: number;
    mimeType?: string;
};

type GenerationResult = {
    id: string;
    status: "pending" | "success" | "failed" | "unknown";
    image?: GeneratedImage;
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
    successCount: number;
    failCount: number;
    imageCount: number;
    size: string;
    quality: string;
    status: "success" | "failed" | "unknown";
    images: GeneratedImage[];
    error?: string;
    creation?: CreationSnapshot;
};

type GenerationLogConfig = Pick<AiConfig, "model" | "imageModel" | "quality" | "size" | "count">;

const logStore = localforage.createInstance({ name: STORAGE_NS, storeName: "image_generation_logs" });

export default function ImagePage() {
    const { message } = App.useApp();
    const conversation = useComposerStore((state) => state.conversations[state.activeConversations["image"]]);
    const generationSource = useAgentMediaStore((state) => state.source);
    const confirmNewGeneration = useConfirmNewGeneration();
    const reuse = useReuseCreation();
    const ledger = useTaskStore((state) => state.tasks);
    const batchLogs = useRef(new Map<string, GenerationLog>());
    const [searchParams, setSearchParams] = useSearchParams();
    const [resultSource, setResultSource] = useState<"api" | "agent">(generationSource);
    const openedAt = useRef(Date.now());
    const focusTaskId = searchParams.get("task") || undefined;
    const receipts = useAgentMediaStore((state) => state.receipts);
    const intents = useAgentMediaStore((state) => state.intents);
    const nativeCount = Object.keys(receipts).length + Object.values(intents).filter((intent) => !Object.values(receipts).some(({ task }) => task.request.requestId === intent.requestId)).length;
    const [historySource, setHistorySource] = useState<"all" | "api" | "agent">("all");
    const newestNativeIntent = useTaskStore((state) => state.tasks.find((task) => task.id.startsWith("agent:") && task.startedAt >= openedAt.current));
    useEffect(() => { if (newestNativeIntent) { setResultSource("agent"); setSearchParams({}, { replace: true }); } }, [newestNativeIntent?.id]);
    const newestNative = Object.values(receipts).sort((a, b) => b.task.createdAt - a.task.createdAt)[0]?.task;
    useEffect(() => { if (newestNative && newestNative.createdAt >= openedAt.current) { setResultSource("agent"); setSearchParams({}, { replace: true }); } }, [newestNative?.id]);
    const submissionRef = useRef<ComposerSubmission | undefined>(undefined);
    const submitting = useRef(false);
    const slotSubmissionsRef = useRef<ComposerSubmission[]>([]);
    const [session, setSession] = useState<CreationSnapshot | undefined>(undefined);
    const { t } = useTranslation();
    const navigate = useNavigate();
    useSyncExternalStore(subscribeImagePreviews, getImagePreviewRevision);
    const effectiveConfig = useEffectiveConfig();
    const updateConfig = useConfigStore((state) => state.updateConfig);
    const isAiConfigReady = useConfigStore((state) => state.isAiConfigReady);
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);
    const addAsset = useAssetStore((state) => state.addAsset);
    const mutateAsset = useAssetMutation();
    const { prompt, references } = useComposerStore((state) => state.image);
    const setPrompt = (prompt: string) => useComposerStore.getState().patch("image", { prompt });
    const setReferences = (next: ReferenceImage[] | ((refs: ReferenceImage[]) => ReferenceImage[])) => useComposerStore.getState().setReferences("image", next);
    const [results, setResults] = useState<GenerationResult[]>([]);
    const [logs, setLogs] = useState<GenerationLog[]>([]);
    const [running, setRunning] = useState(false);
    const [panelTab, setPanelTab] = useState<WorkbenchTab>("results");
    const [startedAt, setStartedAt] = useState(0);
    const [elapsedMs, setElapsedMs] = useState(0);
    const [selectedLogIds, setSelectedLogIds] = useState<string[]>([]);
    const [previewLog, setPreviewLog] = useState<GenerationLog | null>(null);
    const [comparison, setComparison] = useState<ComparisonItem[] | undefined>();
    const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
    const [autoRunToken, setAutoRunToken] = useState(0);
    const imageCommand = useWorkbenchAgentStore((state) => state.imageCommand);
    const clearImageCommand = useWorkbenchAgentStore((state) => state.clearImageCommand);
    const updateAgentTask = useWorkbenchAgentStore((state) => state.updateTask);
    const processedCommandRef = useRef(0);
    const agentTaskIdRef = useRef<string | undefined>(undefined);

    const model = effectiveConfig.imageModel || effectiveConfig.model;
    const { caps: imageCaps } = useImageCapabilities(effectiveConfig, model);

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
        const draft = useComposerStore.getState().image;
        const incoming = source || submissionRef.current;
        submissionRef.current = undefined;
        const agentTaskId = agentTaskIdRef.current;
        agentTaskIdRef.current = undefined;
        let snapshot = buildRequestSnapshot(incoming);
        if (!snapshot) {
            if (agentTaskId) updateAgentTask(agentTaskId, { status: "failed", error: t("imageWorkbench.invalidParams") });
            return;
        }
        submitting.current = true;
        const text = snapshot.text;
        const generationCount = Math.max(1, Math.min(10, Number(snapshot.config.count) || 1));
        const model = snapshot.config.model;
        setElapsedMs(0);
        setRunning(true);
        setPanelTab("results");
        setResultSource("api");
        setSearchParams({}, { replace: true });
        revealResults();
        if (agentTaskId) updateAgentTask(agentTaskId, { status: "running", error: undefined });
        setPreviewLog(null);
        setResults(Array.from({ length: generationCount }, () => ({ id: nanoid(), status: "pending" })));
        const batchStartedAt = performance.now();
        setStartedAt(batchStartedAt);

        const originalSubmission = snapshot.submission;
        slotSubmissionsRef.current = Array.from({ length: generationCount }, () => originalSubmission);
        try {
            snapshot = { ...snapshot, submission: await prepareCanvasSubmission(snapshot.submission) };
        } catch (error) {
            showErrorToast(message, error);
            setResults((value) => value.map((item) => ({ ...item, status: "failed", error: error instanceof Error ? error.message : t("workbench.generationFailed") })));
            if (agentTaskId) updateAgentTask(agentTaskId, { status: "failed", error: "not-submitted：创作保存失败，尚未发送请求" });
            setRunning(false); submitting.current = false;
            return;
        }
        setSession(creationSnapshot(snapshot.submission));
        slotSubmissionsRef.current = Array.from({ length: generationCount }, () => snapshot.submission);
        const intent = buildLog({ prompt: text, model, config: { ...snapshot.config, count: String(generationCount) }, references: snapshot.references, durationMs: 0, successCount: 0, failCount: 0, status: "unknown", images: [] });
        intent.creation = creationSnapshot(snapshot.submission);
        batchLogs.current.set(intent.id, intent);
        intent.error = "请求已准备；响应未确认时不能证明渠道未接受，刷新不会自动重提";
        try { await saveLog(intent); }
        catch (error) { showErrorToast(message, error, "生成意图保存失败，尚未发送生成请求"); if (agentTaskId) updateAgentTask(agentTaskId, { status: "failed", error: "not-submitted：生成意图保存失败，尚未发送请求" }); setRunning(false); submitting.current = false; return; }
        const taskIds = Array.from({ length: generationCount }, (_, index) => beginCreationTask({ id: `image:${intent.id}:${index}`, batchId: intent.id, creationId: snapshot.submission.id, kind: "image", model, source: "api", summary: text, sourcePath: "/image" }));
        setResults(taskIds.map((id) => ({ id, status: "pending" })));
        try { await flushTaskSave(); } catch (error) { taskIds.forEach((id) => updateCreationTask(id, { phase: "failed", error: "任务记录未保存，未发送请求" })); setRunning(false); submitting.current = false; showErrorToast(message, error); return; }
        if (!incoming || draft.prompt === incoming.composerContent) consumeComposerDraft("image", draft);
        const historyQueue = createSaveQueue<GenerationLog>(saveLog, () => {});
        const confirmedImages: GeneratedImage[] = [];
        const tasks = Array.from({ length: generationCount }, async (_, index) => {
            const image = await runGenerationSlot(index, snapshot, taskIds[index]);
            confirmedImages.push(image);
            const partial = { ...intent, images: [...confirmedImages], successCount: confirmedImages.length };
            batchLogs.current.set(intent.id, partial);
            historyQueue.enqueue(partial);
            await historyQueue.flush().catch((error) => showErrorToast(message, error, "已确认的作品尚未保存到历史，请保留当前结果并抢救"));
            return image;
        });

        const result = await Promise.allSettled(tasks);
        const successImages = result.filter((item): item is PromiseFulfilledResult<GeneratedImage> => item.status === "fulfilled").map((item) => item.value);
        const successCount = successImages.length;
        const failCount = generationCount - successCount;
        const failed = result.find((item): item is PromiseRejectedResult => item.status === "rejected");
        const error = failed?.reason instanceof Error ? failed.reason.message : failCount ? t("workbench.generationFailed") : undefined;
        if (agentTaskId) updateAgentTask(agentTaskId, { status: result.some((item) => item.status === "rejected" && requestOutcome(item.reason) === "unknown") ? "unknown" : successCount ? "succeeded" : "failed", successCount, failCount, error });

        if (!failCount) void useCreationEstimatesStore.getState().record(snapshot.submission.id, estimateCondition(snapshot.config, snapshot.submission), performance.now() - batchStartedAt).catch((error) => showErrorToast(message, error, "结果已生成，耗时记录保存失败"));
        try {
            const completedLog = {
                ...buildLog({
                    prompt: text,
                    model,
                    config: { ...snapshot.config, count: String(generationCount) },
                    references: snapshot.references,
                    durationMs: performance.now() - batchStartedAt,
                    successCount,
                    failCount,
                    status: successCount ? "success" : failed && requestOutcome(failed.reason) === "unknown" ? "unknown" : "failed",
                    images: successImages,
                }), id: intent.id, createdAt: intent.createdAt, creation: intent.creation, error,
            };
            batchLogs.current.set(intent.id, completedLog);
            historyQueue.enqueue(completedLog);
            await historyQueue.flush();
            if (successCount) if (!incoming || draft.prompt === incoming.composerContent) consumeComposerDraft("image", draft);
            taskIds.forEach((id, index) => { if (result[index].status === "fulfilled" && result[index].value.storageKey) updateCreationTask(id, { saveState: "saved" }); });
            successCount ? message.success(t("imageWorkbench.generated")) : showErrorToast(message, failed?.reason, t("workbench.generationFailed"));
        } catch (error) { taskIds.forEach((id, index) => { if (result[index].status === "fulfilled") updateCreationTask(id, { saveState: "error", saveError: "历史尚未保存，请保留当前结果并导出" }); }); showErrorToast(message, error, "生成结果已返回，但历史尚未保存；请保留当前结果并导出抢救");
        } finally {
            setRunning(false); submitting.current = false;

        }
    };

    // Handle image-generation commands from the Agent panel by setting the prompt and optionally starting generation.
    useEffect(() => {
        if (!imageCommand || imageCommand.nonce === processedCommandRef.current) return;
        processedCommandRef.current = imageCommand.nonce;
        useAgentStore.getState().setAgentState({ composerAgentMode: false });
        clearImageCommand();
        if (!imageCommand.submission && typeof imageCommand.prompt === "string") setPrompt(imageCommand.prompt);
        if (imageCommand.submission) {
            submissionRef.current = imageCommand.submission;
            setReferences(imageCommand.submission.references);
            useComposerStore.getState().patch("image", { canvas: imageCommand.submission.canvas });
        }
        if (imageCommand.run && running) {
            if (imageCommand.taskId) updateAgentTask(imageCommand.taskId, { status: "failed", error: t("imageWorkbench.busy") });
            return;
        }
        if (imageCommand.run) {
            agentTaskIdRef.current = imageCommand.taskId;
            setAutoRunToken((value) => value + 1);
        }
    }, [imageCommand, clearImageCommand, running, updateAgentTask]);

    useEffect(() => {
        if (!autoRunToken) return;
        void generate();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [autoRunToken]);

    const downloadImage = (image: GeneratedImage, index: number) => {
        saveAs(image.dataUrl, `image-${index + 1}.png`);
    };

    const addResultToReferences = (image: GeneratedImage, index: number) => {
        setReferences((value) => [...value, { id: image.id, name: `result-${index + 1}.png`, type: image.mimeType || "image/png", dataUrl: image.dataUrl, storageKey: image.storageKey }]);
        message.success(t("imageWorkbench.addedReference"));
    };

    const saveResultToAssets = async (image: GeneratedImage, index: number) => {
        return mutateAsset(async () => {
            const stored = await uploadImage(image.dataUrl);
            await addAsset({
                kind: "image",
                title: t("imageWorkbench.resultTitle", { count: index + 1 }),
                coverUrl: stored.url,
                tags: [],
                source: t("imageWorkbench.source"),
                data: { dataUrl: stored.url, storageKey: stored.storageKey, width: stored.width, height: stored.height, bytes: stored.bytes, mimeType: stored.mimeType },
                metadata: { source: "image-page", prompt: image.creation?.prompt, creation: image.creation },
            });
        }, t("common.addedToAssets"));
    };

    useEffect(() => {
        const focus = (event: Event) => {
            if ((event as CustomEvent).detail !== "image") return;
            setPanelTab("results"); setPreviewLog(null); setSearchParams({}, { replace: true });
        };
        window.addEventListener("creation-focus", focus);
        return () => window.removeEventListener("creation-focus", focus);
    }, [setSearchParams]);
    const createSession = () => {
        useComposerStore.getState().ensureConversation("image", "image", true);
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

    const saveLog = async (log: GenerationLog) => {
        await logStore.setItem(log.id, serializeLog(log));
        window.dispatchEvent(new Event("creation-history-updated"));
        await refreshLogs();
    };

    const refreshLogs = async () => { const items = await readStoredLogs(); setLogs(items); return items; };

    const previewGenerationLog = async (log: GenerationLog) => {
        setResultSource("api");
        setSearchParams({}, { replace: true });
        setPreviewLog(log);
        setSession(undefined);
        setPanelTab("results");

        setResults(log.images.length ? log.images.map((image, index) => ({ id: image.taskId || `image:${log.id}:${index}`, status: "success", image })) : [{ id: log.id, status: log.status === "unknown" ? "unknown" : "failed", error: log.error || "没有已确认的生成结果" }]);
    };

    useEffect(() => { if (!focusTaskId?.startsWith("image:")) return; const log = logs.find((item) => item.id === focusTaskId.split(":")[1]); if (log && previewLog?.id !== log.id) void previewGenerationLog(log); }, [focusTaskId, logs]);

    const buildRequestSnapshot = (source?: ComposerSubmission) => {
        try {
            const submission = source || createComposerSubmission("image", prompt, references, effectiveConfig, useComposerStore.getState().image.canvas);
            const requestConfig = { ...effectiveConfig, ...submission.parameters, model: submission.parameters.imageModel };
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

    const runGenerationSlot = async (index: number, snapshot: { text: string; config: AiConfig; references: ReferenceImage[]; submission: ComposerSubmission }, taskId: string) => {
        updateCreationTask(taskId, { phase: "generating" });
        const itemStartedAt = performance.now();
        try {
            const result = snapshot.references.length ? await requestEdit({ ...snapshot.config, count: "1" }, snapshot.text, snapshot.references) : await requestGeneration({ ...snapshot.config, count: "1" }, snapshot.text);
            const image = result[0];
            if (!image) throw new Error(t("imageWorkbench.missingResult"));
            updateCreationTask(taskId, { phase: "done", saveState: "saving" });
            const nextImage: GeneratedImage = {
                creation: creationSnapshot(snapshot.submission),
                taskId,
                id: image.id,
                dataUrl: image.dataUrl,
                durationMs: performance.now() - itemStartedAt,
                width: 0,
                height: 0,
                bytes: 0,
                mimeType: "image/png",
            };
            setResults((value) => updateResultAt(value, index, { status: "success", image: nextImage }));
            try { const stored = await uploadImage(image.dataUrl); Object.assign(nextImage, { ...stored, dataUrl: stored.url }); setResults((value) => updateResultAt(value, index, { image: { ...nextImage } })); }
            catch (error) { updateCreationTask(taskId, { saveState: "error", saveError: String(error) }); showErrorToast(message, error, "图片已生成，原图保存失败；可下载当前作品，勿重复生成"); }
            if (snapshot.submission.canvasProjectId) {
                try {
                    await deliverToCanvas("image", { ...nextImage, url: nextImage.dataUrl }, snapshot.submission.canvasProjectId);
                } catch (error) {
                    showErrorToast(message, error, "结果已生成，送入画布失败；可在结果上重试送入");
                }
            }
            return nextImage;
        } catch (error) {
            updateCreationTask(taskId, { phase: requestOutcome(error) === "unknown" ? "unknown" : "failed", error: String(error) });
            setResults((value) => updateResultAt(value, index, { status: requestOutcome(error) === "unknown" ? "unknown" : "failed", error: error instanceof Error ? error.message : t("workbench.generationFailed") }));
            throw error;
        }
    };

    const retrySave = async (index: number) => {
        const result = results[index];
        if (!result?.image) return;
        const id = result.id.split(":")[1];
        const log = batchLogs.current.get(id) || logs.find((item) => item.id === id);
        if (!log) { message.error("原批次记录不存在，请下载当前图片保留作品"); return; }
        updateCreationTask(result.id, { saveState: "saving", saveError: undefined });
        try {
            const image = result.image.storageKey ? result.image : { ...result.image, ...await uploadImage(result.image.dataUrl) };
            if (!result.image.storageKey) image.dataUrl = (image as GeneratedImage & { url: string }).url;
            setResults((items) => updateResultAt(items, index, { image }));
            const saved = { ...log, images: log.images.map((item) => item.id === image.id ? image : item) };
            await saveLog(saved);
            batchLogs.current.set(id, saved);
            updateCreationTask(result.id, { saveState: "saved", saveError: undefined });
        } catch (error) { updateCreationTask(result.id, { saveState: "error", saveError: String(error) }); showErrorToast(message, error, "作品保留，保存仍未完成"); }
    };

    const retryResult = async (index: number) => {
        if (running || !await confirmNewGeneration()) return;
        const original = (previewLog ? undefined : slotSubmissionsRef.current[index]) || previewLog?.creation && { ...previewLog.creation, references: previewLog.references, canvas: false };
        if (!original) { message.error("原始提交快照不存在，请复用条件后重新审阅"); return; }
        let snapshot = buildRequestSnapshot(original);
        if (!snapshot) return;
        setRunning(true);
        let taskId = "";
        try {
            snapshot = { ...snapshot, submission: await prepareCanvasSubmission(snapshot.submission) };
            slotSubmissionsRef.current[index] = snapshot.submission;
            const intent = { ...buildLog({ prompt: snapshot.text, model: snapshot.config.model, config: { ...snapshot.config, count: "1" }, references: snapshot.references, durationMs: 0, successCount: 0, failCount: 0, status: "unknown", images: [] }), creation: creationSnapshot(snapshot.submission) };
            await saveLog(intent);
            taskId = beginCreationTask({ id: `image:${intent.id}:0`, batchId: intent.id, creationId: snapshot.submission.id, kind: "image", model: snapshot.config.model, summary: snapshot.text, sourcePath: "/image" });
            await flushTaskSave();
            batchLogs.current.set(intent.id, intent);
            setResults((value) => updateResultAt(value, index, { id: taskId, status: "pending", image: undefined, error: undefined }));
            const image = await runGenerationSlot(index, snapshot, taskId);
            const completed = { ...intent, status: "success" as const, images: [image], successCount: 1, durationMs: image.durationMs };
            batchLogs.current.set(intent.id, completed);
            try { await saveLog(completed); if (image.storageKey) updateCreationTask(taskId, { saveState: "saved" }); }
            catch (error) { updateCreationTask(taskId, { saveState: "error", saveError: String(error) }); showErrorToast(message, error, "作品已生成，历史未保存；请重试保存"); }
        } catch (error) { showErrorToast(message, error); }
        finally { setRunning(false); submitting.current = false; }
    };

    const sessionMeta = session
        ? `${modelOptionName(session.parameters.imageModel)} · ${Object.entries(session.actual)
              .map(([key, value]) => `${key}=${value}`)
              .join(" · ")}`
        : previewLog
          ? `${modelOptionName(previewLog.model)} · ${previewLog.size} · ${previewLog.quality}`
          : "";
    const sessionPrompt = (previewLog?.prompt || session?.prompt || "").trim();
    const sessionTime = previewLog ? relativeTime(previewLog.createdAt) : "刚刚";

    return (
        <div className="flex h-full flex-col overflow-hidden bg-[var(--paper-1)] text-[color:var(--ink-900)]">
            <WorkbenchShell
                results={
                    <WorkbenchResults
                        tab={panelTab}
                        onTabChange={setPanelTab}
                        logCount={logs.length + nativeCount}
                        status={running ? <span className="text-xs tabular-nums text-[color:var(--ink-500)]">{t("workbench.waiting", { time: formatDuration(elapsedMs) })}</span> : null}
                        actions={
                            panelTab === "results" && (!conversation || focusTaskId || previewLog) && results.some((item) => item.image) ? (
                                <InkChip onClick={() => results.forEach((item, index) => item.image && downloadImage(item.image, index))}>
                                    <Download className="size-3.5" strokeWidth={1.7} />
                                    全部下载
                                </InkChip>
                            ) : null
                        }
                    >
                        {panelTab === "logs" ? (
                            <>
                            <div className="mb-3 flex flex-wrap gap-2">{(["all", "api", "agent"] as const).map((source) => <InkChip key={source} selected={historySource === source} onClick={() => setHistorySource(source)}>{source === "all" ? "全部来源" : source === "api" ? "模型 API" : "本机 Codex"}</InkChip>)}<InkChip disabled={!selectedLogIds.length} onClick={() => setComparison(logs.filter((log) => selectedLogIds.includes(log.id)).flatMap((log) => log.images.map((image, index) => ({ id: image.id, title: `${log.title} · ${index + 1}`, mode: "image" as const, content: image.dataUrl, storageKey: image.storageKey, creation: image.creation, prompt: log.prompt, parameters: log.config, source: log.id }))))}>比较勾选批次</InkChip></div>
                            {historySource !== "api" && <AgentMediaPanel embedded history />}
                            {historySource !== "agent" && <LogPanel
                                logs={logs}
                                selectedLogIds={selectedLogIds}
                                activeLogId={previewLog?.id}
                                onSelectedLogIdsChange={setSelectedLogIds}
                                onCreateSession={createSession}
                                onDeleteSelected={() => setDeleteConfirmOpen(true)}
                                onPreviewLog={(log) => void previewGenerationLog(log)}
                            />}
                            </>
                        ) : conversation && !focusTaskId && !previewLog ? <CreationConversationView scope="image" mode="image" /> : focusTaskId?.startsWith("agent:") || !focusTaskId?.startsWith("image:") && resultSource === "agent" ? <AgentMediaPanel embedded focusTaskId={focusTaskId} /> : results.length ? (
                            <>
                                {previewLog && <InkButton onClick={() => void reuse("image", { prompt: previewLog.prompt, references: previewLog.references }, () => { selectImageSource("api"); Object.entries(previewLog.config).filter(([key]) => key !== "model").forEach(([key, value]) => updateConfig(key as keyof AiConfig, value)); })}>复用条件</InkButton>}
                                <ResultSessionHeader time={sessionTime} prompt={sessionPrompt.slice(0, 24) + (sessionPrompt.length > 24 ? "…" : "")} meta={sessionMeta} />
                                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 md:grid-cols-3 xl:grid-cols-4">
                                    {results.map((result, index) =>
                                        result.status === "success" && result.image ? (
                                            <ResultImageCard
                                                key={result.id}
                                                image={result.image}
                                                saveError={ledger.find((task) => task.id === result.id)?.saveError}
                                                onRetrySave={() => void retrySave(index)}
                                                index={index}
                                                onEdit={addResultToReferences}
                                                onDownload={downloadImage}
                                                onSaveAsset={saveResultToAssets}
                                                onVideo={(image) => { void reuse("video", { prompt: image.creation?.prompt || "", references: [{ id: image.id, name: "生图结果", type: image.mimeType || "image/png", dataUrl: image.dataUrl, storageKey: image.storageKey }] }).then((accepted) => { if (accepted) { useComposerStore.getState().setMode("video"); navigate("/video"); } }); }}
                                            />
                                        ) : result.status === "failed" || result.status === "unknown" ? (
                                            <FailureTile
                                                key={result.id}
                                                title={result.status === "unknown" ? "结果未知" : "请求未完成"}
                                                error={result.error || t("workbench.generationFailed")}
                                                onRetry={() => retryResult(index)}
                                                fixes={
                                                    failureKind(result.error || "") === "size" ? (
                                                        <InkButton
                                                            size={32}
                                                            variant="ink"
                                                            onClick={() => {
                                                                updateConfig("size", imageCaps.ratios.includes("1:1") ? "1:1" : "auto");
                                                                void retryResult(index);
                                                            }}
                                                        >
                                                            改为合法尺寸并重试
                                                        </InkButton>
                                                    ) : failureKind(result.error || "") === "key" ? (
                                                        <InkButton size={32} variant="ink" onClick={() => openConfigDialog(false)}>
                                                            检查设置
                                                        </InkButton>
                                                    ) : null
                                                }
                                            >
                                                {result.status === "unknown" ? <p className="text-xs">结果未知；没有可查询的任务 ID。原请求可能已被接受，新请求可能再次计费。</p> : <FriendlyErrorView error={result.error || t("workbench.generationFailed")} />}
                                            </FailureTile>
                                        ) : (
                                            <PendingImageCard key={result.id} taskId={result.id} />
                                        ),
                                    )}
                                </div>
                            </>
                        ) : (
                            <WorkbenchEmpty title="写一句话就能开始" hint="描述想要的画面，或点一个示例；结果可下载、存入素材，或作为参考图继续创作。" examples={t("workbenchUi.imageExamples").split("|").filter(Boolean)} onPick={setPrompt} />
                        )}
                    </WorkbenchResults>
                }
                composer={<Composer mode="image" localImages busy={running} onSubmit={(submission) => generate(submission)} />}
            />
            <CreationComparison items={comparison || []} open={comparison !== undefined} onClose={() => setComparison(undefined)} />
            <Modal title={t("workbench.deleteLogs")} open={deleteConfirmOpen} onCancel={() => setDeleteConfirmOpen(false)} onOk={deleteSelectedLogs} okText={t("common.delete")} okButtonProps={{ danger: true }} cancelText={t("common.cancel")}>
                {t("workbench.deleteLogsConfirm", { count: selectedLogIds.length })}
            </Modal>
        </div>
    );
}

function ResultImageCard({
    image,
    saveError,
    onRetrySave,
    index,
    onEdit,
    onDownload,
    onSaveAsset,
    onVideo,
}: {
    image: GeneratedImage;
    saveError?: string;
    onRetrySave: () => void;
    onVideo: (image: GeneratedImage) => void;
    index: number;
    onEdit: (image: GeneratedImage, index: number) => void;
    onDownload: (image: GeneratedImage, index: number) => void;
    onSaveAsset: (image: GeneratedImage, index: number) => void;
}) {
    const { t } = useTranslation();
    useSyncExternalStore(subscribeImagePreviews, getImagePreviewRevision);
    const action = "inline-flex h-[30px] cursor-pointer items-center gap-1 rounded-lg border-0 bg-[color-mix(in_srgb,var(--paper-0)_92%,transparent)] px-2.5 text-xs text-[color:var(--ink-900)] shadow-[var(--sh-1)] hover:bg-[var(--paper-0)]";
    return (
        <div className="group relative overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--paper-0)]">
            <Image src={previewUrlFor(image.storageKey) || image.dataUrl} preview={{ src: image.dataUrl }} alt={t("imageWorkbench.resultAlt", { count: index + 1 })} className="w-full object-contain" rootClassName="block w-full" />
            {saveError && <div role="alert" className="p-3 text-xs text-[color:var(--zhu-600)]">图片已生成，保存未完成：{saveError}<InkButton onClick={onRetrySave}>重试保存，不重新生成</InkButton></div>}
            <div className="flex flex-wrap items-center gap-1 border-t border-[var(--line)] p-2">
                <button type="button" className={action} aria-label={t("common.download")} onClick={() => onDownload(image, index)}>
                    <Download className="size-3.5" strokeWidth={1.7} />
                </button>
                <button type="button" className={action} onClick={() => void onSaveAsset(image, index)}>
                    存素材
                </button>
                <button type="button" className={action} onClick={() => void onEdit(image, index)}>
                    <PenLine className="size-3.5" strokeWidth={1.7} />
                    作参考
                </button>
                <button type="button" className={action} onClick={() => onVideo(image)}>
                    转视频
                </button>
                <CanvasDeliveryButton kind="image" result={{ ...image, url: image.dataUrl }} />
                <CreationDetails creation={image.creation} />
            </div>
            <div className="pointer-events-none absolute left-2 top-2 rounded-md bg-black/45 px-1.5 py-0.5 font-[family-name:var(--font-mono)] text-[10.5px] text-white opacity-0 transition-opacity group-hover:opacity-100">
                {image.width}×{image.height} · {formatBytes(image.bytes)} · {formatDuration(image.durationMs)}
            </div>
        </div>
    );
}

function PendingImageCard({ taskId }: { taskId: string }) {
    return (
        <div className="relative grid aspect-[3/4] place-items-center overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--paper-2)] text-[color:var(--ink-500)]">
            {/* [dianran] 晕染占位：真实阶段 + 已等待时长，超过 30 秒提示可离开页面 */}
            <GenerationStatus kind="image" taskId={taskId} variant="card" />
        </div>
    );
}

function updateResultAt(results: GenerationResult[], index: number, next: Partial<GenerationResult>) {
    return results.map((item, itemIndex) => (itemIndex === index ? { ...item, ...next } : item));
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
                <div>
                    <h2 className="text-base font-semibold">{t("workbench.logs")}</h2>
                </div>
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
    useSyncExternalStore(subscribeImagePreviews, getImagePreviewRevision);
    const thumbnails = log.images.filter((image) => image.dataUrl).slice(0, 4);

    return (
        <button type="button" className={`block w-full rounded-lg border p-2 text-left transition ${active ? "border-[var(--ink-900)] bg-[var(--paper-2)]" : "border-[var(--line)] bg-[var(--paper-0)] hover:bg-[var(--paper-2)]"}`} onClick={onClick}>
            <div className="grid grid-cols-[minmax(128px,1fr)_auto] gap-2">
                <div className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-start gap-2">
                    <Checkbox className="mt-0.5" checked={selected} onClick={(event) => event.stopPropagation()} onChange={(event) => onSelectedChange(event.target.checked)} />
                    <div className="min-w-0">
                        <div className="truncate text-sm font-semibold leading-5">{log.title}</div>{log.status === "unknown" ? <p className="mt-1 text-xs text-amber-600">结果未知；新请求可能再次计费</p> : null}
                        {thumbnails.length ? (
                            <div className="mt-2 flex gap-1 overflow-hidden">
                                {thumbnails.map((image) => (
                                    <img key={image.id} src={previewUrlFor(image.storageKey) || image.dataUrl} alt="" className="size-8 shrink-0 rounded-md object-cover" />
                                ))}
                            </div>
                        ) : null}
                    </div>
                </div>
                <div className="grid justify-items-end gap-2">
                    <div className="flex gap-1">
                        <Tag className="m-0 flex h-6 items-center rounded-md px-1.5 text-xs leading-none" color="blue">
                            {t("workbench.successCount", { count: log.successCount ?? log.imageCount })}
                        </Tag>
                        {log.failCount ? (
                            <Tag className="m-0 flex h-6 items-center rounded-md px-1.5 text-xs leading-none" color="red">
                                {t("workbench.failCount", { count: log.failCount })}
                            </Tag>
                        ) : null}
                    </div>
                    <div className="flex flex-wrap justify-end gap-1">
                        <Tag className="m-0 flex h-6 items-center rounded-md px-1.5 text-xs leading-none">{t("workbench.itemCount", { count: log.imageCount })}</Tag>
                        <Tag className="m-0 flex h-6 items-center rounded-md px-1.5 text-xs leading-none" color="green">
                            {formatDuration(log.durationMs)}
                        </Tag>
                    </div>
                    <div className="flex justify-end">
                        <Tag className="m-0 flex h-6 items-center rounded-md px-1.5 text-xs leading-none">{log.time}</Tag>
                    </div>
                </div>
            </div>
        </button>
    );
}

async function readStoredLogs() {
    if (typeof window === "undefined") return [];
    try {
        const values: GenerationLog[] = [];
        await logStore.iterate<GenerationLog, void>((value) => {
            values.push(value);
        });
        const logs = await Promise.all(values.map(normalizeLog));
        return logs.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    } catch {
        return [];
    }
}

async function normalizeLog(log: Partial<GenerationLog>): Promise<GenerationLog> {
    const references = await Promise.all(
        (log.references || []).map(async (item) => {
            void ensureImagePreview(item.storageKey);
            return { ...item, dataUrl: await resolveImageUrl(item.storageKey, item.dataUrl) };
        }),
    );
    const images = await Promise.all(
        (log.images || []).map(async (item) => {
            void ensureImagePreview(item.storageKey);
            return { ...item, dataUrl: await resolveImageUrl(item.storageKey, item.dataUrl) };
        }),
    );
    const config = normalizeLogConfig(log);
    return {
        id: log.id || nanoid(),
        createdAt: log.createdAt || Date.now(),
        title: log.title || log.model || i18n.t("workbench.untitled"),
        prompt: log.prompt || log.title || "",
        time: log.time || new Date().toLocaleString(i18n.resolvedLanguage, { hour12: false }),
        model: log.model || config.imageModel || "",
        config,
        references,
        durationMs: log.durationMs || 0,
        successCount: log.successCount ?? log.imageCount ?? 0,
        failCount: log.failCount || 0,
        imageCount: log.imageCount || log.successCount || 0,
        size: log.size || config.size || "",
        quality: log.quality || config.quality || "",
        status: log.status || "success",
        error: log.error,
        creation: log.creation,
        images,
    };
}

function serializeLog(log: GenerationLog): GenerationLog {
    return {
        ...log,
        references: log.references.map((item) => ({ ...item, dataUrl: item.storageKey ? "" : item.dataUrl })),
        images: log.images.map((image) => ({ ...image, dataUrl: image.storageKey ? "" : image.dataUrl })),
    };
}

function normalizeLogConfig(log: Partial<GenerationLog>): GenerationLogConfig {
    return {
        model: log.config?.model || log.model || "",
        imageModel: log.config?.imageModel || log.model || "",
        quality: log.config?.quality || log.quality || "",
        size: log.config?.size || log.size || "",
        count: log.config?.count || String(log.imageCount || log.successCount || 1),
    };
}

function buildLog({
    prompt,
    model,
    config,
    references,
    durationMs,
    successCount,
    failCount,
    status,
    images,
}: {
    prompt: string;
    model: string;
    config: GenerationLogConfig;
    references: ReferenceImage[];
    durationMs: number;
    successCount: number;
    failCount: number;
    status: GenerationLog["status"];
    images: GeneratedImage[];
}): GenerationLog {
    const logConfig = {
        model: config.model,
        imageModel: config.imageModel,
        quality: config.quality,
        size: config.size,
        count: config.count,
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
        successCount,
        failCount,
        imageCount: Number(logConfig.count) || successCount,
        size: logConfig.size,
        quality: logConfig.quality,
        status,
        images,
    };
}
