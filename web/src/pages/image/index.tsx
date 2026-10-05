import { CreationDetails } from "@/components/composer/creation-details";
import { Composer } from "@/components/composer/composer";
import { CanvasDeliveryButton, deliverToCanvas, prepareCanvasSubmission } from "@/components/composer/canvas-delivery";
import { createComposerSubmission, creationSnapshot, type ComposerSubmission, type CreationSnapshot } from "@/lib/composer";
import { useComposerStore } from "@/stores/use-composer-store";
import { CheckSquare, Download, PenLine, Plus, Trash2 } from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { App, Button, Checkbox, Image, Modal, Tag } from "antd";
import localforage from "localforage";
import { saveAs } from "file-saver";
import { useNavigate } from "react-router-dom";
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
import { useWorkbenchAgentStore } from "@/stores/use-workbench-agent-store";
import type { ReferenceImage } from "@/types/image";
import i18n from "@/i18n";
import { STORAGE_NS } from "@/constant/brand";
import { showErrorToast } from "@/features/errors/error-toast";

type GeneratedImage = {
    creation?: CreationSnapshot;
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
    status: "pending" | "success" | "failed";
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
    status: "success" | "failed";
    images: GeneratedImage[];
};

type GenerationLogConfig = Pick<AiConfig, "model" | "imageModel" | "quality" | "size" | "count">;

const logStore = localforage.createInstance({ name: STORAGE_NS, storeName: "image_generation_logs" });

export default function ImagePage() {
    const { message } = App.useApp();
    const submissionRef = useRef<ComposerSubmission | undefined>(undefined);
    const [session, setSession] = useState<CreationSnapshot | undefined>(undefined);
    const { t } = useTranslation();
    const navigate = useNavigate();
    useSyncExternalStore(subscribeImagePreviews, getImagePreviewRevision);
    const effectiveConfig = useEffectiveConfig();
    const updateConfig = useConfigStore((state) => state.updateConfig);
    const isAiConfigReady = useConfigStore((state) => state.isAiConfigReady);
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);
    const addAsset = useAssetStore((state) => state.addAsset);
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
        if (running) return;
        const incoming = source || submissionRef.current;
        submissionRef.current = undefined;
        const agentTaskId = agentTaskIdRef.current;
        agentTaskIdRef.current = undefined;
        let snapshot = buildRequestSnapshot(incoming);
        if (!snapshot) {
            if (agentTaskId) updateAgentTask(agentTaskId, { status: "failed", error: t("imageWorkbench.invalidParams") });
            return;
        }
        const text = snapshot.text;
        const generationCount = Math.max(1, Math.min(10, Number(snapshot.config.count) || 1));
        const model = snapshot.config.model;
        setElapsedMs(0);
        setRunning(true);
        setPanelTab("results");
        revealResults();
        if (agentTaskId) updateAgentTask(agentTaskId, { status: "running", error: undefined });
        setPreviewLog(null);
        setResults(Array.from({ length: generationCount }, () => ({ id: nanoid(), status: "pending" })));
        const batchStartedAt = performance.now();
        setStartedAt(batchStartedAt);

        try {
            snapshot = { ...snapshot, submission: await prepareCanvasSubmission(snapshot.submission) };
        } catch (error) {
            showErrorToast(message, error);
            setRunning(false);
            return;
        }
        setSession(creationSnapshot(snapshot.submission));
        const tasks = Array.from({ length: generationCount }, (_, index) => runGenerationSlot(index, snapshot));

        const result = await Promise.allSettled(tasks);
        const successImages = result.filter((item): item is PromiseFulfilledResult<GeneratedImage> => item.status === "fulfilled").map((item) => item.value);
        const successCount = successImages.length;
        const failCount = generationCount - successCount;
        const failed = result.find((item): item is PromiseRejectedResult => item.status === "rejected");
        const error = failed?.reason instanceof Error ? failed.reason.message : failCount ? t("workbench.generationFailed") : undefined;
        if (agentTaskId) updateAgentTask(agentTaskId, { status: successCount ? "succeeded" : "failed", successCount, failCount, error: successCount ? undefined : error });

        try {
            saveLog(
                buildLog({
                    prompt: text,
                    model,
                    config: { ...snapshot.config, count: String(generationCount) },
                    references: snapshot.references,
                    durationMs: performance.now() - batchStartedAt,
                    successCount,
                    failCount,
                    status: successCount ? "success" : "failed",
                    images: successImages,
                }),
            );
            successCount ? message.success(t("imageWorkbench.generated")) : showErrorToast(message, failed?.reason, t("workbench.generationFailed"));
        } finally {
            setRunning(false);
            if (successCount && snapshot.submission.canvasProjectId) navigate(`/canvas/${snapshot.submission.canvasProjectId}`);
        }
    };

    // Handle image-generation commands from the Agent panel by setting the prompt and optionally starting generation.
    useEffect(() => {
        if (!imageCommand || imageCommand.nonce === processedCommandRef.current) return;
        processedCommandRef.current = imageCommand.nonce;
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
        const stored = await uploadImage(image.dataUrl);
        addAsset({
            kind: "image",
            title: t("imageWorkbench.resultTitle", { count: index + 1 }),
            coverUrl: stored.url,
            tags: [],
            source: t("imageWorkbench.source"),
            data: { dataUrl: stored.url, storageKey: stored.storageKey, width: stored.width, height: stored.height, bytes: stored.bytes, mimeType: stored.mimeType },
            metadata: { source: "image-page", prompt: image.creation?.prompt, creation: image.creation },
        });
        message.success(t("common.addedToAssets"));
    };

    const createSession = () => {
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

    const saveLog = (log: GenerationLog) => {
        void logStore.setItem(log.id, serializeLog(log)).then(refreshLogs);
    };

    const refreshLogs = async () => setLogs(await readStoredLogs());

    const previewGenerationLog = async (log: GenerationLog) => {
        setPreviewLog(log);
        setSession(undefined);
        setPanelTab("results");
        setPrompt(log.prompt);
        setReferences(log.references || []);
        if (log.config.imageModel || log.model) updateConfig("imageModel", log.config.imageModel || log.model);
        if (log.config.quality) updateConfig("quality", log.config.quality);
        if (log.config.size) updateConfig("size", log.config.size);
        if (log.config.count) updateConfig("count", log.config.count);
        setResults(log.images.map((image) => ({ id: image.id, status: "success", image })));
    };

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

    const runGenerationSlot = async (index: number, snapshot: { text: string; config: AiConfig; references: ReferenceImage[]; submission: ComposerSubmission }) => {
        const itemStartedAt = performance.now();
        try {
            const result = snapshot.references.length ? await requestEdit({ ...snapshot.config, count: "1" }, snapshot.text, snapshot.references) : await requestGeneration({ ...snapshot.config, count: "1" }, snapshot.text);
            const image = result[0];
            if (!image) throw new Error(t("imageWorkbench.missingResult"));
            const stored = await uploadImage(image.dataUrl);
            const nextImage: GeneratedImage = {
                creation: creationSnapshot(snapshot.submission),
                id: image.id,
                dataUrl: stored.url,
                ...(stored.storageKey ? { storageKey: stored.storageKey } : {}),
                durationMs: performance.now() - itemStartedAt,
                width: stored.width,
                height: stored.height,
                bytes: stored.bytes,
                mimeType: stored.mimeType,
            };
            setResults((value) => updateResultAt(value, index, { status: "success", image: nextImage }));
            if (snapshot.submission.canvasProjectId) {
                try {
                    await deliverToCanvas("image", { ...nextImage, url: nextImage.dataUrl }, snapshot.submission.canvasProjectId);
                } catch (error) {
                    showErrorToast(message, error, "结果已生成，送入画布失败；可在结果上重试送入");
                }
            }
            return nextImage;
        } catch (error) {
            setResults((value) => updateResultAt(value, index, { status: "failed", error: error instanceof Error ? error.message : t("workbench.generationFailed") }));
            throw error;
        }
    };

    const retryResult = async (index: number) => {
        const snapshot = buildRequestSnapshot();
        if (!snapshot) return;
        setPreviewLog(null);
        setResults((value) => updateResultAt(value, index, { status: "pending", error: undefined, image: undefined }));
        const retryStartedAt = performance.now();
        try {
            const image = await runGenerationSlot(index, snapshot);
            saveLog(
                buildLog({
                    prompt: snapshot.text,
                    model,
                    config: { ...snapshot.config, count: "1" },
                    references: snapshot.references,
                    durationMs: performance.now() - retryStartedAt,
                    successCount: 1,
                    failCount: 0,
                    status: "success",
                    images: [image],
                }),
            );
            message.success(t("workbench.retrySuccess"));
        } catch {
            // runGenerationSlot has already marked the result as failed.
        }
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
                        logCount={logs.length}
                        status={running ? <span className="text-xs tabular-nums text-[color:var(--ink-500)]">{t("workbench.waiting", { time: formatDuration(elapsedMs) })}</span> : null}
                        actions={
                            panelTab === "results" && results.some((item) => item.image) ? (
                                <InkChip onClick={() => results.forEach((item, index) => item.image && downloadImage(item.image, index))}>
                                    <Download className="size-3.5" strokeWidth={1.7} />
                                    全部下载
                                </InkChip>
                            ) : null
                        }
                    >
                        {panelTab === "logs" ? (
                            <LogPanel
                                logs={logs}
                                selectedLogIds={selectedLogIds}
                                activeLogId={previewLog?.id}
                                onSelectedLogIdsChange={setSelectedLogIds}
                                onCreateSession={createSession}
                                onDeleteSelected={() => setDeleteConfirmOpen(true)}
                                onPreviewLog={(log) => void previewGenerationLog(log)}
                            />
                        ) : results.length ? (
                            <>
                                <ResultSessionHeader time={sessionTime} prompt={sessionPrompt.slice(0, 24) + (sessionPrompt.length > 24 ? "…" : "")} meta={sessionMeta} />
                                <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 xl:grid-cols-4">
                                    {results.map((result, index) =>
                                        result.status === "success" && result.image ? (
                                            <ResultImageCard
                                                key={result.id}
                                                image={result.image}
                                                index={index}
                                                onEdit={addResultToReferences}
                                                onDownload={downloadImage}
                                                onSaveAsset={saveResultToAssets}
                                                onVideo={(image) => {
                                                    const store = useComposerStore.getState();
                                                    store.patch("video", {
                                                        prompt: image.creation?.prompt || "",
                                                        references: [{ id: image.id, name: "生图结果", type: image.mimeType || "image/png", dataUrl: image.dataUrl, storageKey: image.storageKey }],
                                                    });
                                                    store.setMode("video");
                                                    navigate("/video");
                                                }}
                                            />
                                        ) : result.status === "failed" ? (
                                            <FailureTile
                                                key={result.id}
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
                                                <FriendlyErrorView error={result.error || t("workbench.generationFailed")} />
                                            </FailureTile>
                                        ) : (
                                            <PendingImageCard key={result.id} />
                                        ),
                                    )}
                                </div>
                            </>
                        ) : (
                            <WorkbenchEmpty title="写一句话就能开始" hint="描述想要的画面，或点一个示例；结果可下载、存入素材，或作为参考图继续创作。" examples={t("workbenchUi.imageExamples").split("|").filter(Boolean)} onPick={setPrompt} />
                        )}
                    </WorkbenchResults>
                }
                composer={<Composer mode="image" busy={running} onSubmit={(submission) => void generate(submission)} />}
            />
            <Modal title={t("workbench.deleteLogs")} open={deleteConfirmOpen} onCancel={() => setDeleteConfirmOpen(false)} onOk={deleteSelectedLogs} okText={t("common.delete")} okButtonProps={{ danger: true }} cancelText={t("common.cancel")}>
                {t("workbench.deleteLogsConfirm", { count: selectedLogIds.length })}
            </Modal>
        </div>
    );
}

function ResultImageCard({
    image,
    index,
    onEdit,
    onDownload,
    onSaveAsset,
    onVideo,
}: {
    image: GeneratedImage;
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
            <Image src={previewUrlFor(image.storageKey) || image.dataUrl} preview={{ src: image.dataUrl }} alt={t("imageWorkbench.resultAlt", { count: index + 1 })} className="aspect-[3/4] w-full object-cover" rootClassName="block w-full" />
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

function PendingImageCard() {
    return (
        <div className="relative grid aspect-[3/4] place-items-center overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--paper-2)] text-[color:var(--ink-500)]">
            {/* [dianran] 晕染占位：真实阶段 + 已等待时长，超过 30 秒提示可离开页面 */}
            <GenerationStatus kind="image" variant="card" />
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
                        <div className="truncate text-sm font-semibold leading-5">{log.title}</div>
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
