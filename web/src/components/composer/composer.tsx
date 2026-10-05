import { lazy, Suspense, useEffect, useRef, useState, type ReactNode } from "react";
import { App, Input, Popover, Switch } from "antd";
import { useNavigate } from "react-router-dom";
import { ArrowUp, ArrowLeft, ArrowRight, AtSign, BookOpen, ClipboardPaste, Plus, Upload, X } from "lucide-react";
import { nanoid } from "nanoid";
import { InkChip } from "@/components/ui/chip";
import { InkButton } from "@/components/ui/ink-button";
import { InkStepper } from "@/components/ui/stepper";
import { InkSegmented } from "@/components/ui/segmented";
import { RatioPicker } from "@/components/ui/ratio-picker";

import type { InsertAssetPayload } from "@/components/canvas/asset-picker-modal";

import { describeImagePlan } from "@/components/image-settings-panel";
import { describeVideoPlan } from "@/components/video-settings-panel";
import { CapabilityNote } from "@/components/ui/capability-note";
import { imageQualitySupportsHd, imageTierSize, normalizeImageQuality, videoSecondsOptions } from "@/lib/model-capabilities";
import { composerPlans, createComposerSubmission, isGenerateShortcut, normalizeComposerConfig, type ComposerMode, type ComposerSubmission } from "@/lib/composer";
import { modelOptionLabel, modelOptionName, selectableModelsByCapability, useConfigStore } from "@/stores/use-config-store";
import { useComposerStore } from "@/stores/use-composer-store";
import { previewUrlFor, resolveImageUrl, uploadImage } from "@/services/image-storage";
import { showErrorToast } from "@/features/errors/error-toast";

const SettingsSheet = lazy(() => import("@/components/workbench/workbench-layout").then((module) => ({ default: module.SettingsSheet })));
const AssetPickerModal = lazy(() => import("@/components/canvas/asset-picker-modal").then((module) => ({ default: module.AssetPickerModal })));
const PromptSelectDialog = lazy(() => import("@/components/prompts/prompt-select-dialog").then((module) => ({ default: module.PromptSelectDialog })));
const titles = { add: "添加内容", model: "选择模型", ratio: "画面比例", quality: "画质与输出", count: "生成张数", seconds: "视频时长", resolution: "视频清晰度", more: "更多设置" };
type Panel = keyof typeof titles;

export function Composer({ mode, onModeChange, onSubmit, busy = false }: { mode: ComposerMode; onModeChange?: (mode: ComposerMode) => void; onSubmit: (submission: ComposerSubmission) => void; busy?: boolean }) {
    const { message } = App.useApp();
    const navigate = useNavigate();
    const config = useConfigStore((state) => state.config);
    const updateConfig = useConfigStore((state) => state.updateConfig);
    const draft = useComposerStore((state) => state[mode]);
    const hydrated = useComposerStore((state) => state.hydrated);
    const patch = useComposerStore((state) => state.patch);
    const setReferences = useComposerStore((state) => state.setReferences);
    const [panel, setPanel] = useState<Panel | null>(null);
    const [mobile, setMobile] = useState(() => window.matchMedia("(max-width: 767px)").matches);
    const [search, setSearch] = useState("");
    const [adjustNote, setAdjustNote] = useState("");
    const [assetOpen, setAssetOpen] = useState(false);
    const [promptOpen, setPromptOpen] = useState(false);
    const [uploading, setUploading] = useState(false);
    const fileInput = useRef<HTMLInputElement>(null);
    const textarea = useRef<HTMLTextAreaElement>(null);
    const normalizedModel = useRef("");
    const model = mode === "image" ? config.imageModel || config.model : config.videoModel;
    const plans = composerPlans(config);
    const image = plans.image;
    const video = plans.video;
    const caps = mode === "image" ? plans.imageCaps : video.caps;
    const count = Math.max(1, Math.min(10, Number(config.count) || 1));
    const ratio = mode === "image" ? image.ratio : video.ratio;
    const qualityLabel = image.tier ? `输出 ${image.quality?.value || image.tier.toUpperCase()}` : plans.imageCaps.quality && imageQualitySupportsHd(plans.imageCaps) ? (normalizeImageQuality(config.quality) === "hd" ? "高清" : "标准") : "由模型决定";

    useEffect(() => {
        if (hydrated && useComposerStore.getState().mode !== mode) useComposerStore.getState().setMode(mode);
    }, [mode, hydrated]);
    useEffect(() => {
        const media = window.matchMedia("(max-width: 767px)");
        const change = () => setMobile(media.matches);
        media.addEventListener("change", change);
        return () => media.removeEventListener("change", change);
    }, []);
    useEffect(() => {
        if (normalizedModel.current === `${mode}:${model}`) return;
        normalizedModel.current = `${mode}:${model}`;
        const next = normalizeComposerConfig(useConfigStore.getState().config, mode);
        useConfigStore.setState({ config: next.config });
        setAdjustNote(next.notes.join("；"));
    }, [mode, model]);

    const selectModel = (value: string) => {
        const current = useConfigStore.getState().config;
        const selected = { ...current, [mode === "image" ? "imageModel" : "videoModel"]: value };
        const before = composerPlans(current);
        const after = composerPlans(selected);
        const resetTier = mode === "image" && before.image.tier && !after.imageCaps.tiers;
        if (resetTier) selected.size = before.image.ratio;
        const next = normalizeComposerConfig(selected, mode);
        if (resetTier) next.notes.unshift(`输出 ${before.image.tier!.toUpperCase()} → 比例预设`);
        normalizedModel.current = `${mode}:${value}`;
        useConfigStore.setState({ config: next.config });
        setAdjustNote(next.notes.join("；"));
        if (next.notes.length) message.info(`已调整：${next.notes.join("；")}`);
        setPanel(null);
    };
    const submit = () => {
        if (busy || uploading || !hydrated) return;
        try {
            onSubmit(createComposerSubmission(mode, draft.prompt, draft.references, useConfigStore.getState().config, draft.canvas));
        } catch (error) {
            showErrorToast(message, error);
        }
    };
    const addFiles = async (files: File[] | FileList) => {
        const images = Array.from(files).filter((file) => file.type.startsWith("image/"));
        if (!images.length) return;
        if (mode === "video" && draft.references.length + images.length > 7) {
            message.warning("视频沿用最多 7 张收集上限，请减少附件后添加");
            return;
        }
        setUploading(true);
        try {
            const refs = await Promise.all(
                images.map(async (file) => {
                    const stored = await uploadImage(file);
                    return { id: nanoid(), name: file.name, type: stored.mimeType, dataUrl: stored.url, storageKey: stored.storageKey };
                }),
            );
            setReferences(mode, (current) => [...current, ...refs]);
        } catch (error) {
            showErrorToast(message, error);
        } finally {
            setUploading(false);
        }
    };
    const paste = async () => {
        try {
            const items = await navigator.clipboard.read();
            const blobs = await Promise.all(items.flatMap((item) => item.types.filter((type) => type.startsWith("image/")).map((type) => item.getType(type))));
            if (!blobs.length) {
                message.info("剪贴板中没有图片");
                return;
            }
            await addFiles(blobs.map((blob, index) => new File([blob], `粘贴图片${index + 1}.png`, { type: blob.type })));
        } catch (error) {
            showErrorToast(message, error, "无法读取剪贴板，请使用上传");
        }
    };
    const insertAsset = async (payload: InsertAssetPayload) => {
        if (payload.kind === "text") patch(mode, { prompt: draft.prompt ? `${draft.prompt}\n${payload.content}` : payload.content });
        else if (payload.kind === "image") {
            if (mode === "video" && draft.references.length >= 7) {
                message.warning("视频最多收集 7 张参考图");
                return;
            }
            try {
                const stored = payload.storageKey ? { storageKey: payload.storageKey, url: await resolveImageUrl(payload.storageKey, payload.dataUrl), mimeType: "image/png" } : await uploadImage(payload.dataUrl);
                const existing = draft.references.find((ref) => ref.storageKey === stored.storageKey || ref.dataUrl === payload.dataUrl);
                const id = existing?.id || nanoid();
                if (!existing) setReferences(mode, (refs) => [...refs, { id, name: payload.title, type: stored.mimeType, dataUrl: stored.url, storageKey: stored.storageKey }]);
                patch(mode, { prompt: `${draft.prompt.replace(/@$/, "")} @[ref:${id}] ` });
            } catch (error) {
                showErrorToast(message, error);
            }
        } else {
            message.info("当前生图/视频输入支持图片和文字素材");
            return;
        }
        setAssetOpen(false);
        textarea.current?.focus();
    };
    const chooseRatio = (value: string) => updateConfig(mode === "image" ? "size" : "videoSize", mode === "image" && image.tier && value !== "auto" ? imageTierSize(value, image.tier) : value);
    const optionButtons = (values: Array<{ value: string; label: string }>, current: string, choose: (value: string) => void) => (
        <div className="flex flex-wrap gap-2">
            {values.map(({ value, label }) => (
                <InkChip key={value} selected={current === value} onClick={() => choose(value)}>
                    {label}
                </InkChip>
            ))}
        </div>
    );
    const resolutionLabel = video.caps.paramStyle === "openai-sora" && video.resolution === "1080p" ? "1080p 档" : video.resolution;
    const panelBody = (key: Panel): ReactNode => {
        if (key === "add")
            return (
                <div className="grid gap-2">
                    <InkButton
                        onClick={() => {
                            fileInput.current?.click();
                            setPanel(null);
                        }}
                    >
                        <Upload className="size-4" />
                        上传参考图
                    </InkButton>
                    <InkButton onClick={() => void paste()}>
                        <ClipboardPaste className="size-4" />
                        粘贴图片
                    </InkButton>
                    <InkButton
                        onClick={() => {
                            setPanel(null);
                            setAssetOpen(true);
                        }}
                    >
                        <AtSign className="size-4" />
                        我的素材
                    </InkButton>
                    <InkButton
                        onClick={() => {
                            setPanel(null);
                            setPromptOpen(true);
                        }}
                    >
                        <BookOpen className="size-4" />
                        提示词库
                    </InkButton>
                </div>
            );
        if (key === "model") {
            const models = selectableModelsByCapability(config, mode).filter((value) => modelOptionLabel(config, value).toLowerCase().includes(search.toLowerCase()));
            return (
                <div className="space-y-3">
                    <Input aria-label="搜索模型" placeholder="搜索模型或渠道" value={search} onChange={(event) => setSearch(event.target.value)} />
                    <div role="listbox" aria-label="模型" className="max-h-72 space-y-1 overflow-auto">
                        {models.map((value) => (
                            <button
                                key={value}
                                role="option"
                                aria-selected={value === model}
                                className="block w-full rounded-lg border-0 bg-transparent px-3 py-2 text-left text-sm text-[color:var(--ink-700)] hover:bg-[var(--paper-2)]"
                                onClick={() => selectModel(value)}
                            >
                                {value === model ? "✓ " : ""}
                                {modelOptionLabel(config, value)}
                            </button>
                        ))}
                    </div>
                    {!models.length ? <InkButton onClick={() => useConfigStore.getState().openConfigDialog(false)}>添加模型 / 配置渠道</InkButton> : null}
                </div>
            );
        }
        if (key === "ratio")
            return (
                <div className="space-y-3">
                    <RatioPicker value={ratio} primary={caps.ratios} allowAuto={mode === "image" || video.caps.paramStyle === "relay-extended"} onChange={chooseRatio} />
                    <CapabilityNote>{mode === "image" ? describeImagePlan(image) : describeVideoPlan(video)}</CapabilityNote>
                </div>
            );
        if (key === "count")
            return (
                <div className="space-y-3">
                    <InkStepper ariaLabel="张数" value={count} max={10} onChange={(value) => updateConfig("count", String(value))} />
                    <CapabilityNote>
                        {count} 张 = {count} 次生成请求
                    </CapabilityNote>
                </div>
            );
        if (key === "seconds")
            return optionButtons(
                videoSecondsOptions(video.caps).map((value) => ({ value: String(value), label: `${value} 秒` })),
                String(video.seconds),
                (value) => updateConfig("videoSeconds", value),
            );
        if (key === "resolution")
            return (
                <div className="space-y-3">
                    {optionButtons(
                        video.caps.resolutions.map((value) => ({ value, label: video.caps.paramStyle === "openai-sora" && value === "1080p" ? "1080p 档" : value })),
                        video.resolution,
                        (value) => updateConfig("vquality", value.replace(/p$/, "")),
                    )}
                    <CapabilityNote>
                        {describeVideoPlan(video)}
                        {video.caps.paramStyle === "openai-sora" ? "；1080p 档实际为 1792×1024 / 1024×1792" : ""}
                    </CapabilityNote>
                </div>
            );
        if (key === "quality")
            return (
                <div className="space-y-4">
                    {plans.imageCaps.quality && imageQualitySupportsHd(plans.imageCaps) ? (
                        <InkSegmented
                            ariaLabel="画质"
                            value={normalizeImageQuality(config.quality)}
                            options={[
                                { value: "standard", label: "标准", hint: plans.imageCaps.tiers ? "1K" : undefined },
                                { value: "hd", label: "高清", hint: plans.imageCaps.tiers ? "2K" : undefined },
                            ]}
                            onChange={(value) => {
                                updateConfig("quality", value);
                                if (image.tier) updateConfig("size", ratio);
                            }}
                        />
                    ) : (
                        <CapabilityNote>由模型决定画质</CapabilityNote>
                    )}
                    {plans.imageCaps.tiers ? (
                        <div className="space-y-2">
                            <div className="text-xs text-[color:var(--ink-500)]">显式输出档位 · 4K 仅主动选择生效</div>
                            {optionButtons([{ value: "auto", label: "跟随画质" }, ...plans.imageCaps.tiers.map((value) => ({ value, label: value.toUpperCase() }))], image.tier || "auto", (value) =>
                                updateConfig("size", value === "auto" ? ratio : imageTierSize(ratio, value as "1k" | "2k" | "4k")),
                            )}
                        </div>
                    ) : null}
                    <CapabilityNote>{describeImagePlan(image)}</CapabilityNote>
                </div>
            );
        return (
            <div className="space-y-4">
                {mode === "image" ? (
                    <>
                        {plans.imageCaps.transparent ? (
                            <label className="flex justify-between text-sm">
                                透明背景
                                <Switch size="small" checked={config.background === "transparent"} onChange={(checked) => updateConfig("background", checked ? "transparent" : "")} />
                            </label>
                        ) : null}
                        {plans.imageCaps.sizes === "any" && plans.channel !== "gemini" ? (
                            <label className="block space-y-2 text-sm">
                                <span>自定义像素（W×H）</span>
                                <Input aria-label="自定义像素" value={config.size} onChange={(event) => updateConfig("size", event.target.value)} />
                            </label>
                        ) : null}
                        {Array.isArray(plans.imageCaps.sizes) ? <CapabilityNote>合法尺寸：{plans.imageCaps.sizes.join(" / ") || "由模型决定"}</CapabilityNote> : null}
                    </>
                ) : (
                    <>
                        {draft.references.length && video.caps.modes.length > 1 ? (
                            <InkSegmented ariaLabel="参考方式" value={config.videoMode} options={video.caps.modes.map((value) => ({ value, label: value === "frames" ? "首尾帧" : "多图参考" }))} onChange={(value) => updateConfig("videoMode", value)} />
                        ) : null}
                        {video.caps.audio ? (
                            <label className="flex justify-between text-sm">
                                生成声音
                                <Switch size="small" checked={config.videoGenerateAudio === "true"} onChange={(value) => updateConfig("videoGenerateAudio", String(value))} />
                            </label>
                        ) : null}
                        {video.caps.paramStyle !== "openai-sora" ? (
                            <label className="flex justify-between text-sm">
                                水印
                                <Switch size="small" checked={config.videoWatermark === "true"} onChange={(value) => updateConfig("videoWatermark", String(value))} />
                            </label>
                        ) : null}
                        {video.caps.customSize ? (
                            <label className="block space-y-2 text-sm">
                                <span>自定义像素（W×H）</span>
                                <Input aria-label="视频自定义像素" value={config.videoSize} onChange={(event) => updateConfig("videoSize", event.target.value)} />
                            </label>
                        ) : null}
                    </>
                )}
                <CapabilityNote>{mode === "image" ? describeImagePlan(image) : describeVideoPlan(video)}</CapabilityNote>
            </div>
        );
    };
    const chip = (key: Panel, label: ReactNode) => {
        const button = (
            <InkChip key={key} aria-label={titles[key]} onClick={mobile ? () => setPanel((current) => (current === key ? null : key)) : undefined}>
                {label}
            </InkChip>
        );
        if (mobile) return button;
        return (
            <Popover
                key={key}
                trigger="click"
                placement="topLeft"
                open={panel === key}
                onOpenChange={(open) => setPanel((current) => (open ? key : current === key ? null : current))}
                title={titles[key]}
                content={<div className="w-[310px] max-w-[calc(100vw-48px)]">{panelBody(key)}</div>}
            >
                {button}
            </Popover>
        );
    };

    return (
        <div
            data-testid="composer"
            className="rounded-[var(--r-lg)] border border-[var(--line)] bg-[var(--paper-0)] p-3 shadow-[var(--sh-1)] sm:p-4"
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
                event.preventDefault();
                void addFiles(event.dataTransfer.files);
            }}
        >
            <div className="mb-2 flex flex-wrap items-center gap-2">
                <div role="tablist" aria-label="创作模式" className="flex gap-1">
                    {(["image", "video"] as const).map((value) => (
                        <InkChip
                            key={value}
                            role="tab"
                            aria-selected={mode === value}
                            selected={mode === value}
                            onClick={() => {
                                useComposerStore.getState().setMode(value);
                                if (onModeChange) onModeChange(value);
                                else if (value !== mode) navigate(`/${value}`);
                            }}
                        >
                            {value === "image" ? "生图" : "视频"}
                        </InkChip>
                    ))}
                    <InkChip onClick={() => void import("@/stores/use-agent-store").then(({ useAgentStore }) => useAgentStore.getState().togglePanel())} title="打开 Agent 助手">
                        Agent ↗
                    </InkChip>
                </div>
                <label className="ml-auto flex items-center gap-2 text-xs text-[color:var(--ink-500)]">
                    在画布中创作
                    <Switch size="small" checked={draft.canvas} onChange={(canvas) => patch(mode, { canvas })} />
                </label>
            </div>
            <textarea
                ref={textarea}
                rows={mobile ? 2 : 3}
                value={draft.prompt}
                aria-label="提示词"
                placeholder={mode === "image" ? "描述你想创作或修改的画面… 输入 @ 引用素材" : "描述镜头、运动与场景… 输入 @ 引用素材"}
                className="block w-full resize-none border-0 bg-transparent py-2 text-[15px] leading-7 text-[color:var(--ink-900)] outline-none placeholder:text-[color:var(--ink-400)]"
                onChange={(event) => {
                    patch(mode, { prompt: event.target.value });
                    if (event.target.value.endsWith("@") && !(event.nativeEvent as InputEvent).isComposing) setAssetOpen(true);
                }}
                onKeyDown={(event) => {
                    if (isGenerateShortcut(event)) {
                        event.preventDefault();
                        submit();
                    }
                }}
                onPaste={(event) => {
                    if (event.clipboardData.files.length) {
                        event.preventDefault();
                        void addFiles(event.clipboardData.files);
                    }
                }}
            />
            {draft.references.length ? (
                <div className="mb-3 flex gap-2 overflow-x-auto">
                    {draft.references.map((ref, index) => (
                        <div key={ref.id} className="relative w-20 shrink-0 rounded-lg border border-[var(--line)] p-1">
                            <img src={previewUrlFor(ref.storageKey) || ref.dataUrl} className="h-12 w-full rounded object-cover" alt={ref.name} />
                            <div className="mt-1 truncate text-[10px] text-[color:var(--ink-500)]" title={ref.name}>
                                {mode === "image"
                                    ? `参考图${index + 1}`
                                    : video.caps.paramStyle === "openai-sora"
                                      ? index === 0
                                          ? "参考图"
                                          : "未接入的参考"
                                      : config.videoMode === "reference"
                                        ? `参考图${index + 1}`
                                        : index === 0
                                          ? "首帧"
                                          : index === 1
                                            ? "尾帧"
                                            : "未使用"}{" "}
                                · {ref.name}
                            </div>
                            {draft.references.length > 1 ? (
                                <div className="flex justify-between">
                                    <button
                                        type="button"
                                        aria-label={`前移 ${ref.name}`}
                                        disabled={index === 0}
                                        className="text-[color:var(--ink-500)] disabled:opacity-30"
                                        onClick={() =>
                                            setReferences(mode, (refs) => {
                                                const next = [...refs];
                                                [next[index - 1], next[index]] = [next[index], next[index - 1]];
                                                return next;
                                            })
                                        }
                                    >
                                        <ArrowLeft className="size-3.5" />
                                    </button>
                                    <button
                                        type="button"
                                        aria-label={`后移 ${ref.name}`}
                                        disabled={index === draft.references.length - 1}
                                        className="text-[color:var(--ink-500)] disabled:opacity-30"
                                        onClick={() =>
                                            setReferences(mode, (refs) => {
                                                const next = [...refs];
                                                [next[index + 1], next[index]] = [next[index], next[index + 1]];
                                                return next;
                                            })
                                        }
                                    >
                                        <ArrowRight className="size-3.5" />
                                    </button>
                                </div>
                            ) : null}
                            <button
                                type="button"
                                aria-label={`移除 ${ref.name}`}
                                className="absolute right-0 top-0 rounded bg-[var(--paper-0)] p-0.5 text-[color:var(--ink-700)]"
                                onClick={() => {
                                    setReferences(mode, (refs) => refs.filter((item) => item.id !== ref.id));
                                    patch(mode, { prompt: draft.prompt.replaceAll(`@[ref:${ref.id}]`, "") });
                                }}
                            >
                                <X className="size-3.5" />
                            </button>
                        </div>
                    ))}
                </div>
            ) : null}
            <div className="flex gap-1.5 overflow-x-auto pb-1 sm:flex-wrap">
                {chip("add", <Plus className="size-4" />)}
                <InkChip aria-label="引用素材" onClick={() => setAssetOpen(true)}>
                    <AtSign className="size-4" />
                </InkChip>
                {chip("model", <span className="max-w-40 truncate">{modelOptionName(model) || "选择模型"} ▾</span>)}
                {caps.ratios.length ? chip("ratio", `${ratio === "auto" ? "自动" : ratio} ▾`) : null}
                {mode === "image" ? (
                    <>
                        {chip("quality", `${qualityLabel} ▾`)}
                        {chip("count", `${count} 张 ▾`)}
                    </>
                ) : (
                    <>
                        {chip("resolution", `${resolutionLabel} ▾`)}
                        {chip("seconds", `${video.seconds} 秒 ▾`)}
                    </>
                )}
                {chip("more", "更多⋯")}
            </div>
            {adjustNote ? (
                <div role="status" className="mt-1 text-xs text-[color:var(--zhu-600)]">
                    已调整：{adjustNote}
                </div>
            ) : null}
            {!caps.known && model ? <div className="mt-1 text-xs text-[color:var(--ink-400)]">能力未核实，渠道可能忽略或拒绝参数</div> : null}
            {draft.references.length && mode === "video" ? (
                <div className="mt-1 text-xs text-[color:var(--ink-500)]">{video.caps.paramStyle === "openai-sora" ? "Sora 当前只接入单张参考；尾帧未核实" : `${config.videoMode === "reference" ? "多图参考" : "首尾帧"} · 用途如需修改，请打开更多`}</div>
            ) : null}
            {draft.references.length && mode === "image" && plans.channel === "siliconflow" ? <div className="mt-1 text-xs text-[color:var(--ink-500)]">此渠道编辑只发送第一张图片</div> : null}
            <div className="mt-2 flex items-center gap-3">
                <span className="min-w-0 flex-1 text-[11px] leading-5 text-[color:var(--ink-400)]">
                    {mode === "image" ? `${count} 次生成请求` : "1 次创建任务（不含轮询）"}
                    <br className="sm:hidden" /> · 费用由所选渠道计费{draft.canvas ? " · 仅最终结果入画布" : ""}
                    {mode === "image" && image.background ? " · 透明背景" : ""}
                    {mode === "video" && video.caps.audio && config.videoGenerateAudio === "true" ? " · 有声" : ""}
                    {mode === "video" && video.caps.paramStyle !== "openai-sora" && config.videoWatermark === "true" ? " · 水印" : ""}
                </span>
                <InkButton variant="zhu" size={40} className="shrink-0" disabled={!draft.prompt.trim() || busy || uploading || !hydrated} onClick={submit}>
                    <ArrowUp className="size-4" />
                    {uploading ? "添加中…" : busy ? "晕染中…" : mode === "image" ? "落笔生成" : "生成视频"}
                </InkButton>
            </div>
            <input
                ref={fileInput}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={(event) => {
                    if (event.target.files) void addFiles(event.target.files);
                    event.target.value = "";
                }}
            />
            {mobile && panel ? (
                <Suspense fallback={null}>
                    <SettingsSheet title={titles[panel]} open onClose={() => setPanel(null)}>
                        {panelBody(panel)}
                    </SettingsSheet>
                </Suspense>
            ) : null}
            <Suspense fallback={null}>
                {assetOpen ? <AssetPickerModal open={assetOpen} defaultTab="my-assets" onInsert={(payload) => void insertAsset(payload)} onClose={() => setAssetOpen(false)} /> : null}
                {promptOpen ? <PromptSelectDialog open={promptOpen} onOpenChange={setPromptOpen} onSelect={(prompt) => patch(mode, { prompt })} /> : null}
            </Suspense>
        </div>
    );
}
