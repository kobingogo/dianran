import { useEffect, useState } from "react";
import { App, Button, Input, Modal } from "antd";
import { X } from "lucide-react";
import { Composer } from "@/components/composer/composer";
import { createComposerSubmission, type ComposerMode, type ComposerParameters } from "@/lib/composer";
import { canvasReferenceIds, prepareCanvasSubmission, type CanvasSubmission } from "@/lib/canvas/canvas-composer";
import { buildGenerationConfig, hasResumableVideoTask } from "@/lib/canvas/canvas-generation-helpers";
import { getGroupResourceNodes, isCanvasReferenceNode } from "@/lib/canvas/canvas-resource-references";
import { EMPTY_COMPOSER_DRAFT, useComposerStore } from "@/stores/use-composer-store";
import { useConfigStore } from "@/stores/use-config-store";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";
import type { ReferenceImage } from "@/types/image";
import { CreationDetails } from "@/components/composer/creation-details";

export function CanvasDockedComposer({ projectId, nodes, target, availableInputs, runningId, onSubmit, onSelect, onStop, onGetStatus, onDraftChange }: {
    projectId: string; nodes: CanvasNodeData[]; availableInputs: CanvasNodeData[]; target?: CanvasNodeData; runningId: string | null;
    onSubmit: (submission: CanvasSubmission, target?: CanvasNodeData, branch?: "regenerate" | "edit" | "video") => Promise<void>;
    onSelect: (id: string | null) => void; onStop: (id: string) => void; onGetStatus: (node: CanvasNodeData) => void;
    onDraftChange: (id: string, prompt: string, parameters?: ComposerParameters, nodeIds?: string[]) => void;
}) {
    const { message } = App.useApp();
    const [mode, setMode] = useState<ComposerMode>("image");
    const [branch, setBranch] = useState<"edit" | "video">();
    const [picker, setPicker] = useState(false);
    const [search, setSearch] = useState("");
    const [active, setActive] = useState(0);
    const [submitting, setSubmitting] = useState(false);
    const hydrated = useComposerStore((state) => state.hydrated);
    const scope = projectId + ":" + (target?.id || "new") + ":" + mode;
    const draft = useComposerStore((state) => state.scoped[scope] || EMPTY_COMPOSER_DRAFT);
    const hasResult = Boolean(target?.metadata?.content);
    const referenceIds = [...new Set([...(draft.nodeIds || []), ...canvasReferenceIds(draft.prompt)])];
    let error = "";
    try {
        if (draft.prompt.trim()) prepareCanvasSubmission(mode, draft.prompt, draft.references, { ...useConfigStore.getState().config, ...draft.parameters }, nodes, draft.nodeIds);
    } catch (e) { error = e instanceof Error ? e.message : "引用无法读取"; }

    useEffect(() => {
        setMode(target?.type === CanvasNodeType.Video || target?.metadata?.generationMode === "video" ? "video" : "image");
        setBranch(undefined);
        setPicker(false);
    }, [target?.id]);
    useEffect(() => {
        if (!hydrated || draft.parameters) return;
        const config = buildGenerationConfig(useConfigStore.getState().config, target, mode);
        const parameters = target?.metadata?.creation?.parameters || {
            imageModel: mode === "image" ? config.model : config.imageModel, videoModel: mode === "video" ? config.model : config.videoModel,
            size: config.size, videoSize: config.videoSize, quality: config.quality, background: config.background, count: config.count,
            vquality: config.vquality, videoSeconds: config.videoSeconds, videoGenerateAudio: config.videoGenerateAudio, videoWatermark: config.videoWatermark, videoMode: config.videoMode,
        };
        useComposerStore.getState().patch(mode, { prompt: draft.initialized ? draft.prompt : target?.metadata?.composerContent ?? target?.metadata?.prompt ?? "", parameters, nodeIds: draft.nodeIds || target?.metadata?.draftReferenceIds || canvasReferenceIds(target?.metadata?.composerContent || ""), initialized: true }, scope);
    }, [scope, hydrated, draft.parameters, draft.initialized, target, mode]);
    useEffect(() => {
        if (draft.initialized && target && !hasResult) onDraftChange(target.id, draft.prompt, draft.parameters, referenceIds);
    }, [draft.prompt, draft.parameters, draft.nodeIds, draft.initialized, target?.id, hasResult, onDraftChange]);

    const addReference = (id: string) => {
        const prompt = draft.prompt.replace(/@$/, "");
        useComposerStore.getState().patch(mode, { prompt: prompt.includes("@[node:" + id + "]") ? prompt : prompt + " @[node:" + id + "] "  , nodeIds: [...new Set([...(draft.nodeIds || []), id])] }, scope);
        setPicker(false);
    };
    const continueEditing = (nextMode: ComposerMode) => {
        if (!target?.metadata?.content) return;
        const nextScope = projectId + ":" + target.id + ":" + nextMode;
        const existing = useComposerStore.getState().scoped[nextScope];
        let prompt = existing?.prompt ?? target.metadata.prompt ?? "";
        if (!prompt.includes("@[node:" + target.id + "]")) prompt += " @[node:" + target.id + "]";
        useComposerStore.getState().patch(nextMode, { prompt, nodeIds: [...new Set([...(existing?.nodeIds || []), target.id])] }, nextScope);
        setBranch(nextMode === "video" ? "video" : "edit");
        setMode(nextMode);
    };
    const submit = async (submission: CanvasSubmission, kind: "regenerate" | "edit" | "video" | undefined = branch) => {
        if (submitting) return;
        setSubmitting(true);
        try { await onSubmit(submission, target, kind || (hasResult ? mode === "video" ? "video" : "edit" : undefined)); }
        catch (e) { message.error(e instanceof Error ? e.message : "提交失败"); }
        finally { setSubmitting(false); }
    };
    const regenerate = () => {
        const creation = target?.metadata?.creation;
        const input = target?.metadata?.inputSnapshot;
        if (!creation || !input || !target) return;
        const submission = createComposerSubmission(creation.mode, creation.prompt, input.referenceImages, { ...useConfigStore.getState().config, ...creation.parameters }, false, 15);
        void submit({ ...submission, input: { ...input, prompt: submission.prompt }, composerContent: target.metadata?.composerContent || creation.composerContent || creation.prompt, inputNodeIds: target.metadata?.inputNodeIds || [], materials: [] }, "regenerate");
    };
    const candidates = nodes.filter((node) => node.id !== target?.id && isCanvasReferenceNode(node, nodes) && (node.title + " " + node.type).toLowerCase().includes(search.toLowerCase()));
    const header = <div data-testid="canvas-composer-target" className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[color:var(--ink-500)]">
        <span className="min-w-0 max-w-full truncate text-[color:var(--zhu-600)]">{!target ? "新建" : target.type === CanvasNodeType.Config ? "编辑配置：" : hasResult ? branch === "video" ? "转视频：" : "继续编辑：" : "填充节点："}{target?.title}</span>
        {target ? <button onClick={() => onSelect(null)}>新建</button> : null}
        {hasResult && target?.type === CanvasNodeType.Image ? <>
            <button onClick={() => continueEditing("image")}>继续编辑</button>
            <button onClick={() => continueEditing("video")}>转视频</button>
            <button onClick={() => addReference(target.id)}>用作参考</button>
        </> : null}
        {hasResult && target?.metadata?.inputSnapshot ? <button disabled={Boolean(runningId) || submitting} onClick={regenerate}>再生成</button> : null}
        {target?.metadata?.creation ? <CreationDetails creation={target.metadata.creation} /> : null}
        {target?.metadata?.sourceConfigId ? <button onClick={() => onSelect(target.metadata!.sourceConfigId!)}>定位来源配置</button> : null}
        {target?.metadata?.agentSource ? <button onClick={() => void import("@/stores/use-agent-store").then(({ useAgentStore }) => { useAgentStore.getState().setAgentState({ sourceToLocate: target.metadata!.agentSource, activeTab: "chat" }); useAgentStore.getState().openPanel(); })}>查看来源轮次</button> : null}
        {availableInputs.filter((node) => !referenceIds.includes(node.id)).map((node) => <button key={node.id} onClick={() => addReference(node.id)}>可用输入（未加入本轮）：{node.title}</button>)}
        {target?.metadata?.inputChanged ? <span>输入已变化 · 尚未重新生成</span> : null}
        {target && hasResumableVideoTask(target) ? <button disabled={Boolean(runningId)} onClick={() => onGetStatus(target)}>取任务状态</button> : null}
        {runningId ? <button onClick={() => onStop(runningId)}>停止等待</button> : null}
    </div>;
    return <div data-canvas-no-zoom data-testid="canvas-docked-composer" className="pointer-events-auto w-full" onPointerDown={(event) => event.stopPropagation()}>
        <Composer key={scope} mode={mode} onModeChange={setMode} busy={submitting || Boolean(runningId)} onSubmit={(value) => void submit(value as CanvasSubmission)} canvas={{
            scope, header, error, onReference: () => { setSearch(""); setActive(0); setPicker(true); },
            prepare: (prompt: string, refs: ReferenceImage[], config) => prepareCanvasSubmission(mode, prompt, refs, config, nodes, draft.nodeIds),
            referenceBar: referenceIds.length ? <div aria-label="本轮引用" className="mb-2 flex gap-2 overflow-x-auto">
                {referenceIds.map((id) => {
                    const node = nodes.find((node) => node.id === id);
                    return <span key={id} className="flex shrink-0 items-center gap-1 text-xs text-[color:var(--ink-500)]">
                        {node?.type === CanvasNodeType.Image && node.metadata?.content ? <img src={node.metadata.content} alt={node.title} className="h-9 w-9 rounded object-cover" /> : null}
                        {node?.title || "失效引用：" + id}
                        {node?.type === CanvasNodeType.Group ? <span>（整组：{getGroupResourceNodes(id, nodes).map((child) => child.title).join("、")}）</span> : null}
                        <button aria-label={"移除引用 " + (node?.title || id)} onClick={() => useComposerStore.getState().patch(mode, { prompt: draft.prompt.replaceAll("@[node:" + id + "]", ""), nodeIds: referenceIds.filter((value) => value !== id) }, scope)}><X className="size-3" /></button>
                    </span>;
                })}
            </div> : null,
        }} />
        <Modal title="引用画布素材" open={picker} onCancel={() => setPicker(false)} footer={null} width={480}>
            <Input autoFocus aria-label="搜索画布素材" placeholder="搜索名称 · 方向键选择，Enter 引用" value={search} onChange={(event) => { setSearch(event.target.value); setActive(0); }} onKeyDown={(event) => {
                if (event.nativeEvent.isComposing) return;
                if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); setActive((value) => Math.max(0, Math.min(candidates.length - 1, value + (event.key === "ArrowDown" ? 1 : -1)))); }
                if (event.key === "Enter" && candidates[active]) { event.preventDefault(); addReference(candidates[active].id); }
            }} />
            <div role="listbox" aria-label="画布素材" className="mt-3 max-h-[50vh] overflow-auto">
                {candidates.map((node, index) => <button key={node.id} role="option" aria-selected={index === active} className="flex w-full items-center gap-2 rounded p-2 text-left text-sm hover:bg-[var(--paper-2)]" onClick={() => addReference(node.id)}>
                    {node.type === CanvasNodeType.Image && node.metadata?.content ? <img src={node.metadata.content} alt="" className="size-8 rounded object-cover" /> : null}
                    <span className="truncate">{node.title}</span><span className="ml-auto text-xs text-[color:var(--ink-400)]">{node.type === "image" ? "图片" : node.type === "text" ? "文字" : node.type === "group" ? "组" : node.type === "video" ? "视频" : node.type === "audio" ? "音频" : "素材"}</span>
                </button>)}
                {!candidates.length ? <div className="p-3 text-sm">暂无可引用的素材，可通过 + 上传或选择我的素材。</div> : null}
            </div>
            <Button type="text" onClick={() => setPicker(false)}>完成</Button>
        </Modal>
    </div>;
}
