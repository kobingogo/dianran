import { useCapabilityReadiness } from "@/stores/use-capability-evidence-store";
import { CreationEstimate } from "./creation-estimate";
import { useCreationPreferencesStore } from "@/stores/use-creation-preferences-store";
import { applyCreationPreset } from "@/lib/creation-preferences";
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
import { composerPlans, createComposerSubmission, isGenerateShortcut, normalizeComposerConfig, type ComposerMode, type ComposerSubmission, type ComposerParameters } from "@/lib/composer";
import { modelOptionLabel, modelOptionName, selectableModelsByCapability, resolveModelRequestConfig, useConfigStore, type AiConfig } from "@/stores/use-config-store";
import { canvasReferenceIds } from "@/lib/canvas/canvas-composer-references";
import type { ReferenceImage } from "@/types/image";
import { EMPTY_COMPOSER_DRAFT, flushComposerSave, consumeComposerDraft, useComposerStore } from "@/stores/use-composer-store";
import { previewUrlFor, resolveImageUrl, uploadImage } from "@/services/image-storage";
import { showErrorToast } from "@/features/errors/error-toast";
import { useLocalImageGeneration } from "@/hooks/use-local-image-generation";
import { selectImageSource } from "@/stores/use-agent-media-store";
import { useAgentStore } from "@/stores/use-agent-store";
import { useCreationDiscussion } from "@/hooks/use-creation-discussion";
import { creationExecutors, creationExecutions, CreationNotSubmittedError, type CreationPlan } from "@/lib/creation-conversation";
import { useAgentSkillStore } from "@/stores/use-agent-skill-store";
import { fetchCodexSkill } from "@/services/api/canvas-agent";
import { useTaskStore } from "@/features/tasks/task-store";

const SettingsSheet = lazy(() => import("@/components/workbench/workbench-layout").then((module) => ({ default: module.SettingsSheet })));
const AssetPickerModal = lazy(() => import("@/components/canvas/asset-picker-modal").then((module) => ({ default: module.AssetPickerModal })));
const PromptSelectDialog = lazy(() => import("@/components/prompts/prompt-select-dialog").then((module) => ({ default: module.PromptSelectDialog })));
const titles = { add: "添加内容", model: "选择模型", ratio: "画面比例", quality: "画质与输出", count: "生成张数", seconds: "视频时长", resolution: "视频清晰度", presets: "参数预设", more: "更多设置", skill: "选择 Skill" };
type Panel = keyof typeof titles;

export type CanvasComposerBinding = {
    scope: string;
    projectId: string;
    targetId?: string;
    header: ReactNode;
    referenceBar: ReactNode;
    error?: string;
    onReference: () => void;
    prepareNative: (prompt: string, references: ReferenceImage[], config: AiConfig) => Pick<ComposerSubmission, "prompt" | "references">;
    prepare: (prompt: string, references: ReferenceImage[], config: AiConfig, validate?: boolean) => ComposerSubmission;
};

export function Composer({ mode, onModeChange, onSubmit, busy = false, canvas, localImages = false }: { mode: ComposerMode; onModeChange?: (mode: ComposerMode) => void; onSubmit: (submission: ComposerSubmission) => void | Promise<void>; busy?: boolean; canvas?: CanvasComposerBinding; localImages?: boolean }) {
    const { message } = App.useApp();
    const scope = canvas?.scope || mode;
    const discussion = useCreationDiscussion(scope, mode);
    const agentModels = useAgentStore((state) => state.models);
    const agentConnected = useAgentStore((state) => state.connected);
    const agentPanelOpen = useAgentStore((state) => state.panelOpen);
    const skills = useAgentSkillStore((state) => state.skills);
    const [skillLoading, setSkillLoading] = useState(false);
    const native = useLocalImageGeneration(localImages && mode === "image", canvas);
    busy = busy || (native.active && native.busy);
    const navigate = useNavigate();
    const globalConfig = useConfigStore((state) => state.config);
    const draft = useComposerStore((state) => canvas ? state.scoped[canvas.scope] || EMPTY_COMPOSER_DRAFT : state[mode]);
    const config = canvas ? { ...globalConfig, ...draft.parameters } : globalConfig;
    const currentConfig = () => canvas ? { ...useConfigStore.getState().config, ...useComposerStore.getState().scoped[canvas.scope]?.parameters } : useConfigStore.getState().config;
    const replaceConfig = (next: AiConfig) => {
        if (canvas) {
            const keys: Array<keyof ComposerParameters> = ["imageModel", "videoModel", "size", "videoSize", "quality", "background", "count", "vquality", "videoSeconds", "videoGenerateAudio", "videoWatermark", "videoMode"];
            useComposerStore.getState().patch(mode, { parameters: Object.fromEntries(keys.map((key) => [key, next[key]])) as ComposerParameters }, canvas.scope);
        } else useConfigStore.setState({ config: next });
    };
    const updateConfig = (key: keyof ComposerParameters, value: string) => replaceConfig({ ...currentConfig(), [key]: value });
    const hydrated = useComposerStore((state) => state.hydrated);
    const patch = (value: ComposerMode, change: Partial<typeof draft>) => useComposerStore.getState().patch(value, change, canvas?.scope);
    const setReferences = (value: ComposerMode, next: ReferenceImage[] | ((refs: ReferenceImage[]) => ReferenceImage[])) => useComposerStore.getState().setReferences(value, next, canvas?.scope);
    const presets = useCreationPreferencesStore((state) => state.presets);
    const [presetName, setPresetName] = useState("");
    const [keepModel, setKeepModel] = useState(true);
    const [presetBusy, setPresetBusy] = useState(false);
    const presetAction = async (action: () => Promise<void>) => { setPresetBusy(true); try { await action(); } catch (error) { showErrorToast(message, error); } finally { setPresetBusy(false); } };
    const [panel, setPanel] = useState<Panel | null>(null);
    const [mobile, setMobile] = useState(() => window.matchMedia("(max-width: 767px)").matches);
    const [search, setSearch] = useState("");
    const [adjustNote, setAdjustNote] = useState("");
    const [assetOpen, setAssetOpen] = useState(false);
    const [promptOpen, setPromptOpen] = useState(false);
    const [uploading, setUploading] = useState(false);
    const submitFlight = useRef(false);
    const fileInput = useRef<HTMLInputElement>(null);
    const textarea = useRef<HTMLTextAreaElement>(null);
    const normalizedModel = useRef("");
    const model = mode === "image" ? config.imageModel || config.model : config.videoModel;
    const readiness = useCapabilityReadiness(config, mode, model);
    const plans = composerPlans(config);
    const image = plans.image;
    const video = plans.video;
    const caps = mode === "image" ? plans.imageCaps : video.caps;
    const count = Math.max(1, Math.min(canvas ? 15 : 10, Number(config.count) || 1));
    const ratio = mode === "image" ? image.ratio : video.ratio;
    const qualityLabel = image.tier ? `输出 ${image.quality?.value || image.tier.toUpperCase()}` : plans.imageCaps.quality && imageQualitySupportsHd(plans.imageCaps) ? (normalizeImageQuality(config.quality) === "hd" ? "高清" : "标准") : "由模型决定";

    useEffect(() => {
        if (!canvas && hydrated && useComposerStore.getState().mode !== mode) useComposerStore.getState().setMode(mode);
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
        const next = normalizeComposerConfig(currentConfig(), mode, canvas ? 15 : 10);
        replaceConfig(next.config);
        setAdjustNote(next.notes.join("；"));
    }, [mode, model]);

    const selectModel = (value: string) => {
        if (busy) return;
        if (localImages) selectImageSource("api");
        const current = currentConfig();
        const selected = { ...current, [mode === "image" ? "imageModel" : "videoModel"]: value };
        const before = composerPlans(current);
        const after = composerPlans(selected);
        const resetTier = mode === "image" && before.image.tier && !after.imageCaps.tiers;
        if (resetTier) selected.size = before.image.ratio;
        const next = normalizeComposerConfig(selected, mode, canvas ? 15 : 10);
        if (resetTier) next.notes.unshift(`输出 ${before.image.tier!.toUpperCase()} → 比例预设`);
        normalizedModel.current = `${mode}:${value}`;
        replaceConfig(next.config);
        setAdjustNote(next.notes.join("；"));
        if (next.notes.length) message.info(`已调整：${next.notes.join("；")}`);
        setPanel(null);
    };
    const submit = async () => {
        window.dispatchEvent(new CustomEvent("creation-focus", { detail: scope }));
        if (discussion.conversation?.purpose === "discuss" || discussion.conversation?.skill) {
            if (discussion.conversation?.purpose !== "discuss") discussion.update({ purpose: "discuss" });
            if (canvas) window.dispatchEvent(new CustomEvent("creation-open-discussion", { detail: scope }));
            await discussion.send(); return;
        }
        if (busy || uploading || !hydrated || submitFlight.current) return;
        const executor = creationExecutors.get(scope);
        if (!executor || !discussion.conversation) return;
        submitFlight.current = true;
        const conversationId = discussion.id;
        const state = useComposerStore.getState();
        const current = state.conversations[conversationId];
        const entryId = nanoid();
        let plan: CreationPlan | undefined;
        let started = false;
        const change = (next: CreationPlan) => {
            const latest = useComposerStore.getState().conversations[conversationId];
            state.updateConversation(conversationId, { entries: latest.entries.map((item) => item.id === entryId ? { ...item, plan: next } : item) });
        };
        try {
            plan = { ...executor.prepare(draft.prompt), id: nanoid(), version: Math.max(0, ...current.entries.flatMap((item) => item.plan ? [item.plan.version] : [])) + 1, state: "submitting" };
            creationExecutions.add(plan.id);
            state.updateConversation(conversationId, { entries: [...current.entries, { id: entryId, role: "assistant", text: "", plan }] });
            await flushComposerSave();
            started = true;
            const taskId = await executor.execute(plan);
            change({ ...plan, taskId, state: taskId ? "submitted" : "unknown" });
            if (native.active && taskId && !["failed", "unknown"].includes(useTaskStore.getState().tasks.find((task) => task.id === taskId)?.phase || "unknown")) consumeComposerDraft(mode, draft, canvas?.scope);
            await flushComposerSave();
        } catch (cause) {
            if (plan) change({ ...plan, state: !started || cause instanceof CreationNotSubmittedError ? "draft" : "unknown", error: cause instanceof Error ? cause.message : String(cause) });
            showErrorToast(message, cause);
        } finally { if (plan) creationExecutions.delete(plan.id); submitFlight.current = false; }
    };
    useEffect(() => {
        const executor = {
            prepare: (prompt: string, discussion = false) => {
                const current = useComposerStore.getState();
                const input = canvas ? current.scoped[canvas.scope] : current[mode];
                const configuration = currentConfig();
                if (canvas?.error && !discussion) throw new CreationNotSubmittedError(canvas.error);
                const submission = canvas ? canvas.prepare(prompt, input.references, configuration, !discussion && !native.active) : createComposerSubmission(mode, prompt, input.references, configuration, input.canvas, 10, !discussion && !native.active);
                const model = native.active ? native.codexModel : mode === "image" ? configuration.imageModel : configuration.videoModel;
                return { submission, source: native.active ? "agent" as const : "api" as const, model, endpoint: native.active ? useAgentStore.getState().url : resolveModelRequestConfig(configuration, model).baseUrl };
            },
            execute: async (plan: CreationPlan) => {
                if (busy || uploading) throw new CreationNotSubmittedError("当前生成尚未结束，请完成后再确认下一版");
                let current: Omit<CreationPlan, "id" | "version" | "state">;
                try { current = executor.prepare(plan.submission.composerContent || plan.submission.prompt); }
                catch (cause) { throw new CreationNotSubmittedError(cause instanceof Error ? cause.message : String(cause)); }
                if (current.endpoint !== plan.endpoint || current.source !== plan.source || current.model !== plan.model || JSON.stringify(current.submission.parameters) !== JSON.stringify(plan.submission.parameters) || JSON.stringify(current.submission.references.map((ref) => ref.storageKey || ref.dataUrl)) !== JSON.stringify(plan.submission.references.map((ref) => ref.storageKey || ref.dataUrl))) throw new CreationNotSubmittedError("模型、渠道、参数或引用已改变，请编辑为新版本方案后确认");
                if (plan.source === "agent") {
                    const taskId = await native.generate(plan.submission);
                    if (!taskId) throw new CreationNotSubmittedError("本机请求未提交，请核对连接、模型与能力提示");
                    return taskId;
                }
                await onSubmit(plan.submission);
                const taskId = useTaskStore.getState().tasks.find((task) => task.creationId === plan.submission.id)?.id;
                if (!taskId) throw new CreationNotSubmittedError("尚未发起生成，请核对模型配置与保存提示");
                return taskId;
            },
        };
        creationExecutors.set(scope, executor);
        return () => { if (creationExecutors.get(scope) === executor) creationExecutors.delete(scope); };
    }, [scope, mode, canvas, native.active, native.codexModel, busy, uploading, draft, config, onSubmit]);
    const openSkills = () => {
        setPanel("skill");
    };
    useEffect(() => {
        if (panel !== "skill") return;
        const agent = useAgentStore.getState();
        if (agent.connected) void useAgentSkillStore.getState().loadSkills(agent.url, agent.token);
    }, [panel, agentConnected]);
    const chooseSkill = async (name: string) => {
        const agent = useAgentStore.getState();
        setSkillLoading(true);
        try {
            const { data } = await fetchCodexSkill(agent.url, agent.token, name);
            if (!data) throw new Error("Skill 内容无法读取");
            const { resources: _resources, ...method } = data;
            discussion.update({ skill: method });
            if ((canvas ? useComposerStore.getState().scoped[scope] : useComposerStore.getState()[mode]) === draft && draft.prompt.endsWith("/")) patch(mode, { prompt: draft.prompt.slice(0, -1) });
            setPanel(null);
        } catch (cause) { showErrorToast(message, cause); }
        finally { setSkillLoading(false); }
    };
    const addFiles = async (files: File[] | FileList) => {
        const images = Array.from(files).filter((file) => file.type.startsWith("image/"));
        if (!images.length) return;
        if (mode === "video" && draft.references.length + images.length > 7) {
            message.warning("视频沿用最多 7 张收集上限，请减少附件后添加");
            return;
        }
        const conversationId = useComposerStore.getState().activeConversations[scope];
        setUploading(true);
        try {
            const refs = await Promise.all(
                images.map(async (file) => {
                    const stored = await uploadImage(file);
                    return { id: nanoid(), name: file.name, type: stored.mimeType, dataUrl: stored.url, storageKey: stored.storageKey };
                }),
            );
            if (useComposerStore.getState().activeConversations[scope] !== conversationId) { message.info("附件已保存，创作已切换；未加入新的草稿"); return; }
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
    useEffect(() => { if (panel === "presets") void useCreationPreferencesStore.getState().load().catch((error) => showErrorToast(message, error)); }, [panel, message]);
    const panelBody = (key: Panel): ReactNode => {
        if (key === "skill") return <div className="space-y-2">
            <p className="text-xs text-[color:var(--ink-500)]">Skill 在当前输入中作为创作方法参考；讨论后确认方案再生成。脚本与工具不会自动执行。</p>
            {skills.filter((item) => item.enabled && item.managed).map((item) => <InkButton key={item.path} disabled={skillLoading} onClick={() => void chooseSkill(item.name)}>{item.interface?.displayName || item.name}</InkButton>)}
            {!skills.some((item) => item.enabled && item.managed) ? <p className="text-sm">{agentConnected ? "暂无已启用的点染 Skill，可在管理中安装或创建。" : "连接本机 Agent 后读取 Skill，已选的方法参考可以继续使用。"}</p> : null}
            <InkButton onClick={() => { useAgentStore.getState().setAgentState({ activeTab: agentConnected ? "skills" : "setup" }); useAgentStore.getState().openPanel(); }}>管理 Skill / 连接设置</InkButton>
        </div>;
        if (key === "presets") return <div className="space-y-3">
            <Input aria-label="预设名称" placeholder="预设名称" value={presetName} onChange={(event) => setPresetName(event.target.value)} />
            <InkButton disabled={presetBusy} onClick={() => void presetAction(async () => { await useCreationPreferencesStore.getState().save(presetName, mode, currentConfig()); message.success("参数预设已保存到本机"); })}>保存当前参数</InkButton>
            <label className="flex gap-2 text-sm"><input type="checkbox" checked={keepModel} onChange={(event) => setKeepModel(event.target.checked)} />保留当前模型</label>
            {presets.filter((preset) => preset.mode === mode).map((preset) => <div key={preset.id} className="space-y-1 border-t border-[var(--ink-200)] pt-2">
                <p>{preset.title}</p><pre className="overflow-auto text-xs">{JSON.stringify(preset.parameters, null, 2)}</pre>
                <div className="flex gap-2"><InkButton disabled={presetBusy || busy} onClick={() => { const next = applyCreationPreset(preset, currentConfig(), keepModel, canvas ? 15 : 10); replaceConfig(next.config); setAdjustNote(next.notes.join("；")); message.success("预设已应用，请核对参数后提交"); }}>应用</InkButton>
                <InkButton disabled={presetBusy} onClick={() => void presetAction(() => useCreationPreferencesStore.getState().remove(preset.id))}>删除</InkButton></div>
            </div>)}
            <CapabilityNote>只保存本模式参数；应用不会生成，模型能力调整会显示在输入区。</CapabilityNote>
        </div>;
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
                    {localImages && mode === "image" ? <div className="space-y-1">
                        <button type="button" disabled={busy} className="block w-full rounded-lg px-3 py-2 text-left text-sm text-[color:var(--ink-700)] hover:bg-[var(--paper-2)]" onClick={() => { selectImageSource("agent", native.codexModel); }}>
                            {native.active ? "✓ " : ""}使用本机 Codex 生成
                        </button>
                        <p className="px-3 text-xs text-[color:var(--ink-500)]">无需图片 API Key，使用 Codex 登录账户额度</p>
                        <div role="listbox" aria-label="本机 Codex 模型" className="max-h-40 overflow-y-auto">{native.models.filter((item) => `${item.displayName || ""} ${item.model}`.toLowerCase().includes(search.toLowerCase())).map((item) => <button key={item.model} type="button" role="option" aria-selected={native.active && native.codexModel === item.model} disabled={busy} className="block w-full rounded-lg px-3 py-2 text-left text-sm text-[color:var(--ink-700)] hover:bg-[var(--paper-2)]" onClick={() => { selectImageSource("agent", item.model); setPanel(null); }}>
                            {native.active && native.codexModel === item.model ? "✓ " : ""}{item.displayName || item.model} · 本机 Codex
                        </button>)}</div>
                        <InkButton disabled={native.loading || busy} onClick={() => {
                            if (native.connected) void native.refresh();
                            else { useAgentStore.getState().openPanel(); useAgentStore.getState().setAgentState({ activeTab: "setup" }); }
                        }}>{native.connected ? native.loading ? "读取本机模型中…" : "刷新本机模型与能力" : "打开本机 Agent 连接设置"}</InkButton>
                        <div className="pt-2 text-xs text-[color:var(--ink-500)]">模型 API</div>
                    </div> : null}
                    <div role="listbox" aria-label="模型" className="max-h-72 space-y-1 overflow-auto">
                        {models.map((value) => (
                            <button
                                key={value}
                                role="option"
                                aria-selected={!native.active && value === model}
                                disabled={busy}
                                className="block w-full rounded-lg border-0 bg-transparent px-3 py-2 text-left text-sm text-[color:var(--ink-700)] hover:bg-[var(--paper-2)]"
                                onClick={() => selectModel(value)}
                            >
                                {!native.active && value === model ? "✓ " : ""}
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
                    <CapabilityNote>
                        {canvas
                            ? "画布内本轮生成张数；新建画布节点的默认张数可在设置中的“画布默认生图张数”单独调整。"
                            : "仅调整本次创作张数；画布节点的默认张数在设置中单独调整。"}
                    </CapabilityNote>
                    <InkStepper ariaLabel="张数" value={count} max={canvas ? 15 : 10} onChange={(value) => updateConfig("count", String(value))} />
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
    let estimateSubmission: ComposerSubmission | undefined;
    try { estimateSubmission = canvas ? canvas.prepare(draft.prompt || "估算", draft.references, config) : createComposerSubmission(mode, draft.prompt || "估算", draft.references, config, false); } catch { /* Invalid inputs have no estimate. */ }
    const chip = (key: Panel, label: ReactNode, description?: string) => {
        const button = (
            <InkChip key={key} aria-label={titles[key]} title={description} onClick={mobile ? () => setPanel((current) => (current === key ? null : key)) : undefined}>
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
                event.stopPropagation();
                void addFiles(event.dataTransfer.files);
            }}
        >
            {canvas?.header}
            <div className="mb-2 flex flex-wrap items-center gap-2">
                <div role="tablist" aria-label="创作模式" className="flex gap-1">
                    {(["image", "video"] as const).map((value) => (
                        <InkChip
                            key={value}
                            role="tab"
                            aria-selected={mode === value}
                            selected={mode === value}
                            onClick={() => {
                                if (!canvas) useComposerStore.getState().setMode(value);
                                if (onModeChange) onModeChange(value);
                                else if (value !== mode) navigate(`/${value}`);
                            }}
                        >
                            {value === "image" ? "生图" : "视频"}
                        </InkChip>
                    ))}
                </div>
                {canvas && discussion.conversation?.purpose === "discuss" && !agentPanelOpen ? <InkButton variant="ghost" size={32} onClick={() => window.dispatchEvent(new CustomEvent("creation-open-discussion", { detail: scope }))}>查看讨论</InkButton> : null}
                <InkButton variant="ghost" size={32} className="ml-auto" onClick={() => {
                    discussion.update({ purpose: discussion.conversation?.purpose === "discuss" ? "generate" : "discuss" });
                    window.dispatchEvent(new CustomEvent("creation-focus", { detail: scope }));
                    if (canvas && discussion.conversation?.purpose !== "discuss") window.dispatchEvent(new CustomEvent("creation-open-discussion", { detail: scope }));
                    textarea.current?.focus();
                }}>{discussion.conversation?.purpose === "discuss" ? "直接生成" : "先讨论"}</InkButton>
                {!canvas && !native.active ? <label className="flex items-center gap-2 text-xs text-[color:var(--ink-500)]">
                    在画布中创作
                    <Switch size="small" checked={draft.canvas} onChange={(canvas) => patch(mode, { canvas })} />
                </label> : null}
            </div>
            <textarea
                ref={textarea}
                rows={mobile ? 2 : 3}
                value={draft.prompt}
                aria-label="提示词"
                placeholder={mode === "image" ? "描述你想创作或修改的画面… 输入 @ 引用素材" : "描述镜头、运动与场景… 输入 @ 引用素材"}
                className="block w-full resize-none border-0 bg-transparent py-2 text-[15px] leading-7 text-[color:var(--ink-900)] outline-none placeholder:text-[color:var(--ink-400)]"
                onChange={(event) => {
                    patch(mode, { prompt: event.target.value, ...(canvas ? { nodeIds: [...new Set([...(draft.nodeIds || []), ...canvasReferenceIds(event.target.value)])] } : {}) });
                    if (event.target.value.endsWith("/") && !(event.nativeEvent as InputEvent).isComposing) openSkills();
                    if (event.target.value.endsWith("@") && !(event.nativeEvent as InputEvent).isComposing) canvas ? canvas.onReference() : setAssetOpen(true);
                }}
                onKeyDown={(event) => {
                    if (isGenerateShortcut(event)) {
                        event.preventDefault();
                        void submit();
                    }
                }}
                onPaste={(event) => {
                    if (event.clipboardData.files.length) {
                        event.preventDefault();
                        void addFiles(event.clipboardData.files);
                    }
                }}
            />
            {discussion.conversation?.skill ? <div className="mb-2 flex items-center gap-2 text-xs text-[color:var(--ink-500)]">Skill 方法：{discussion.conversation.skill.interface?.displayName || discussion.conversation.skill.name}<button aria-label="移除 Skill" onClick={() => discussion.update({ skill: undefined })}><X className="size-3" /></button></div> : null}
            {canvas?.referenceBar}
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
            <div data-testid="composer-parameter-controls" className="flex flex-wrap gap-1.5 pb-1">
                {chip("add", <Plus className="size-4" />)}
                <InkChip aria-label="引用素材" onClick={() => canvas ? canvas.onReference() : setAssetOpen(true)}>
                    <AtSign className="size-4" />
                </InkChip>
                {chip("skill", "/ Skill")}
                {chip("model", <span className="max-w-40 truncate">{native.active ? native.codexModel ? `${native.codexModel} · 本机` : "本机 Agent · 选择模型" : readiness.ready ? modelOptionName(model) : "未配置 · 选择模型"} ▾</span>)}
                {!native.active ? <>
                {caps.ratios.length ? chip("ratio", `${ratio === "auto" ? "自动" : ratio} ▾`) : null}
                {mode === "image" ? (
                    <>
                        {chip("quality", `${qualityLabel} ▾`)}
                        {chip("count", `${count} 张 ▾`, canvas ? "画布内本轮生成张数；新建节点默认值在设置中单独调整" : "本次创作张数；画布节点默认值在设置中单独调整")}
                    </>
                ) : (
                    <>
                        {chip("resolution", `${resolutionLabel} ▾`)}
                        {chip("seconds", `${video.seconds} 秒 ▾`)}
                    </>
                )}
                {chip("presets", "预设")}
                {chip("more", "更多⋯")}
                </> : null}
            </div>
            {discussion.conversation?.purpose === "discuss" ? <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-[color:var(--ink-500)]">
                <span>讨论中 · 确认方案后才生成</span>
                <label>对话模型 <select aria-label="对话模型" value={discussion.conversation.dialogueModel} className="max-w-64 border-0 bg-transparent text-[color:var(--ink-700)]" onChange={(event) => discussion.update({ dialogueModel: event.target.value })}>
                    <option value="">选择对话模型</option>
                    {selectableModelsByCapability(config, "text").map((item) => <option key={item} value={item}>{modelOptionLabel(config, item)}</option>)}
                    {agentModels.map((item) => <option key={item.model} value={`local:${item.model}`}>{item.displayName || item.model} · 本机 Codex</option>)}
                </select></label>
                <InkButton onClick={() => useConfigStore.getState().openConfigDialog(false)}>配置模型</InkButton>
            </div> : null}
            {!native.active && discussion.conversation?.purpose !== "discuss" ? <CreationEstimate submission={estimateSubmission} config={config} /> : null}
            {discussion.conversation?.purpose !== "discuss" ? <>
            {canvas?.error ? <div role="alert" className="mt-1 text-xs text-[color:var(--zhu-600)]">{canvas.error}</div> : null}
            {native.active ? <div className="mt-2 text-xs text-[color:var(--ink-500)]">本机 Codex · {native.connected ? "已连接" : "未连接"} · {useAgentStore.getState().canvasContext ? "结果保存到当前画布" : "提交时新建结果画布"}；参数由提示词描述，按 Codex 账户规则计费</div> : <div className="mt-2 text-xs text-[color:var(--ink-500)]" data-capability-stage={readiness.stage}>{readiness.label}{!readiness.ready ? <button type="button" className="ml-2 underline" onClick={() => useConfigStore.getState().openConfigDialog(false)}>配置后提交你的第一件作品</button> : null}</div>}
            {native.active && native.error ? <div role="alert" className="mt-1 text-xs text-[color:var(--zhu-600)]">{native.error}。请查询原任务，勿直接重复生成。</div> : null}
            {!native.active && adjustNote ? (
                <div role="status" className="mt-1 text-xs text-[color:var(--zhu-600)]">
                    已调整：{adjustNote}
                </div>
            ) : null}
            {!native.active && !caps.known && model ? <div className="mt-1 text-xs text-[color:var(--ink-400)]">能力未核实，渠道可能忽略或拒绝参数</div> : null}
            {draft.references.length && mode === "video" ? (
                <div className="mt-1 text-xs text-[color:var(--ink-500)]">{video.caps.paramStyle === "openai-sora" ? "Sora 当前只接入单张参考；尾帧未核实" : `${config.videoMode === "reference" ? "多图参考" : "首尾帧"} · 用途如需修改，请打开更多`}</div>
            ) : null}
            {!native.active && draft.references.length && mode === "image" && plans.channel === "siliconflow" ? <div className="mt-1 text-xs text-[color:var(--ink-500)]">此渠道编辑只发送第一张图片</div> : null}
            </> : null}
            <div className="mt-2 flex items-center gap-3">
                <span className="min-w-0 flex-1 text-[11px] leading-5 text-[color:var(--ink-400)]">
                    {discussion.conversation?.purpose === "discuss" ? "发送只讨论方案 · 对话按所选模型计费" : native.active ? "1 次本机生图任务" : mode === "image" ? `${count} 次生成请求` : "1 次创建任务（不含轮询）"}
                    {discussion.conversation?.purpose !== "discuss" ? <><br className="sm:hidden" />{!native.active && draft.canvas ? " · 仅最终结果入画布" : ""}
                    {!native.active && mode === "image" && image.background ? " · 透明背景" : ""}
                    {mode === "video" && video.caps.audio && config.videoGenerateAudio === "true" ? " · 有声" : ""}
                    {mode === "video" && video.caps.paramStyle !== "openai-sora" && config.videoWatermark === "true" ? " · 水印" : ""}</> : null}
                </span>
                <InkButton variant="zhu" size={40} className="shrink-0" disabled={!draft.prompt.trim() || discussion.pending || uploading || !hydrated || (discussion.conversation?.purpose !== "discuss" && (busy || Boolean(canvas?.error) || (native.active && (!native.connected || native.loading || !native.codexModel))))} onClick={() => void submit()}>
                    <ArrowUp className="size-4" />
                    {uploading ? "添加中…" : discussion.pending ? "回复中…" : discussion.conversation?.purpose === "discuss" ? "发送" : busy ? "晕染中…" : discussion.conversation?.skill ? "准备方案" : mode === "image" ? "落笔生成" : "生成视频"}
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
