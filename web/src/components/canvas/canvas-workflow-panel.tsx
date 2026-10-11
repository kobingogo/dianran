import { CreationEstimate } from "@/components/composer/creation-estimate";
import { workflowEstimateCondition } from "@/lib/creation-estimates";
import { exportWorkflowTemplate, importWorkflowTemplate } from "@/lib/canvas/workflow-archive";
import { nanoid } from "nanoid";
import { useEffect, useRef, useState } from "react";
import { App, Modal } from "antd";
import { useParams } from "react-router-dom";
import { useCanvasStore, flushCanvasSave } from "@/stores/canvas/use-canvas-store";
import { useWorkflowStore } from "@/stores/canvas/use-workflow-store";
import { useEffectiveConfig } from "@/stores/use-config-store";
import { createWorkflowRun, executeWorkflow, instantiateWorkflow, planWorkflow, reconcileWorkflow, workflowModel, workflowModeLabels, workflowScope, type WorkflowPlan, type WorkflowRun, type WorkflowStep, type WorkflowStepRun } from "@/lib/canvas/workflow";
import { hydrateCanvasImages } from "@/lib/canvas/canvas-generation-helpers";
import { useThemeStore } from "@/stores/use-theme-store";
import { canvasThemes } from "@/lib/canvas-theme";
import type { CanvasNodeData, CanvasConnection } from "@/types/canvas";
import { showErrorToast } from "@/features/errors/error-toast";
import { useLocalImageGeneration } from "@/hooks/use-local-image-generation";
import { useAgentStore } from "@/stores/use-agent-store";
import { fetchAgentMediaCapabilities } from "@/services/api/local-agent-media";
import { getNodeDefinition } from "@/lib/canvas/node-registry";

export function CanvasWorkflowPanel({
    selectedIds,
    commit,
    execute,
}: {
    selectedIds: Set<string>;
    commit: (nodes: CanvasNodeData[], connections: CanvasConnection[]) => void;
    execute: (step: WorkflowStep, inputs: string[], state: WorkflowStepRun, checkpoint: () => Promise<void>, frozenInputs: CanvasNodeData[]) => Promise<string[]>;
}) {
    const { id: projectId = "" } = useParams();
    const { message, modal } = App.useApp();
    const config = useEffectiveConfig();
    const project = useCanvasStore((store) => store.projects.find((item) => item.id === projectId));
    const proposal = useWorkflowStore((store) => store.proposal);
    const templates = useWorkflowStore((store) => store.templates);
    const theme = canvasThemes[useThemeStore((store) => store.theme)];
    const open = useWorkflowStore((store) => store.panelOpen);
    const native = useLocalImageGeneration(open);
    const [sources, setSources] = useState<Record<string, string>>({});
    const setOpen = (panelOpen: boolean) => useWorkflowStore.setState({ panelOpen });
    const [plan, setPlan] = useState<WorkflowPlan>();
    const [busy, setBusy] = useState(false);
    const stop = useRef(false);
    const templateInput = useRef<HTMLInputElement>(null);
    const templateAction = async (action: () => Promise<void>) => { setBusy(true); try { await action(); } catch (error) { report(error); } finally { setBusy(false); } };
    useEffect(() => {
        return () => {
            stop.current = true;
            useWorkflowStore.setState({ panelOpen: false });
        };
    }, []);
    useEffect(() => {
        if (open)
            void useWorkflowStore
                .getState()
                .load()
                .catch((error) => showErrorToast(message, error, "读取模板失败"));
    }, [open, message]);
    const report = (error: unknown) => showErrorToast(message, error, "工作流未完成");
    const inspect = async (downstream = false, all = false) => {
        try {
            await flushCanvasSave();
            const current = useCanvasStore.getState().openProject(projectId);
            if (!current) throw new Error("画布已不存在");
            const scope = all ? current.nodes.filter((node) => node.type === "config" || getNodeDefinition(node.type)?.workflowAction).map((node) => node.id) : [...selectedIds];
            const nodes = current.nodes.map((node) => {
                if (!sources[node.id]) return node;
                const nativeModel = sources[node.id].startsWith("codex:") ? sources[node.id].slice(6) : "";
                return { ...node, metadata: { ...node.metadata, generationSource: nativeModel ? "codex" as const : "api" as const, codexModel: nativeModel || undefined } };
            });
            setPlan(planWorkflow(nodes, current.connections, workflowScope(nodes, current.connections, scope, downstream), config));
        } catch (error) {
            setPlan(undefined);
            report(error);
        }
    };
    const saveRun = async (run: WorkflowRun) => {
        const current = useCanvasStore.getState().openProject(projectId);
        if (!current) throw new Error("画布已不存在");
        useCanvasStore.getState().updateProject(projectId, { workflowRuns: [...(current.workflowRuns || []).filter((item) => item.id !== run.id), structuredClone(run)] });
        await flushCanvasSave();
    };
    const run = async (source: WorkflowRun) => {
        if (busy) return;
        setBusy(true);
        stop.current = false;
        try {
            const pendingNative = source.plan.steps.filter((step) => step.source === "codex" && source.steps.find((item) => item.stepId === step.id)?.status === "pending");
            pendingNative.forEach((step) => { delete step.allowUnverified; });
            if (pendingNative.length) {
                const agent = useAgentStore.getState();
                if (!agent.connected) throw new Error("请先连接本机 Agent，再执行计划");
                const capabilities = (await fetchAgentMediaCapabilities(agent.url, agent.token)).data.find((item) => item.agentId === "codex");
                let unverified = false;
                for (const step of pendingNative) {
                    const images = step.inputs.some((input) => input.stepId ? source.plan.steps.find((item) => item.id === input.stepId)?.mode === "image" : source.plan.resources.find((node) => node.id === input.nodeId)?.type === "image");
                    const availability = capabilities?.capabilities[images ? "image-edit" : "text-to-image"];
                    if (!availability || availability === "unavailable") throw new Error("计划中的本机生图能力不可用，请刷新能力");
                    unverified ||= availability === "unverified";
                }
                if (unverified) {
                    const approved = await new Promise<boolean>((resolve) => modal.confirm({ title: "本机 Codex 生图能力尚未验证", content: "本次工作流会提交原生生图任务，可能消耗 Codex 使用额度。失败或结果未知时停止下游，不改用 API，也不重复生成。", okText: "允许本次工作流", cancelText: "取消", onOk: () => resolve(true), onCancel: () => resolve(false) }));
                    if (!approved) return;
                    pendingNative.forEach((step) => { step.allowUnverified = true; });
                }
            }
            if (!source.prepared) {
                const current = useCanvasStore.getState().openProject(projectId);
                if (!current) throw new Error("画布已不存在");
                const ids = new Map<string, string>();
                const resources = await hydrateCanvasImages(
                    source.plan.resources.map((node) => {
                        const id = nanoid();
                        ids.set(node.id, id);
                        return { ...node, id, metadata: { ...node.metadata, videoTaskId: undefined, status: "success" as const } };
                    }),
                );
                source.plan.steps.forEach((step) => {
                    step.inputs.forEach((input) => {
                        if (input.stepId) return;
                        const next = ids.get(input.nodeId)!;
                        step.prompt = step.prompt.replaceAll(`@[node:${input.nodeId}]`, `@[node:${next}]`);
                        input.nodeId = next;
                    });
                });
                source.plan.resources = resources;
                source.prepared = true;
                commit([...current.nodes, ...resources], current.connections);
                await saveRun(source);
            }
            await executeWorkflow(source, execute, saveRun, () => stop.current);
        } catch (error) {
            report(error);
        } finally {
            setBusy(false);
        }
    };
    const apply = async (template: WorkflowPlan) => {
        if (busy) return;
        setBusy(true);
        try {
            const current = useCanvasStore.getState().openProject(projectId);
            if (!current) throw new Error("画布已不存在");
            const graph = instantiateWorkflow(template, { x: current.nodes.length ? Math.max(...current.nodes.map((node) => node.position.x + node.width)) + 96 : 80, y: 80 });
            const nodes = await hydrateCanvasImages(graph.nodes);
            // Missing local media is blocked by preflight, never sent as an empty reference.
            commit([...current.nodes, ...nodes], [...current.connections, ...graph.connections]);
            await flushCanvasSave();
            setPlan(undefined);
            message.success("模板已展开为独立节点，请选择节点预览后执行");
        } catch (error) {
            report(error);
        } finally {
            setBusy(false);
        }
    };
    useEffect(() => {
        if (!proposal || proposal.projectId !== projectId || busy) return;
        useWorkflowStore.setState({ proposal: undefined });
        setPlan(proposal.plan);
        setOpen(true);
    }, [proposal, projectId, busy]);
    return (
        <>
            <Modal title="工作流 · 预览后执行" open={open} onCancel={() => setOpen(false)} footer={null} width={720}>
                <p>支持生成配置和图片处理插件。修改参数与连线不执行；每次运行创建独立配置与结果，保留原作品。处理步骤接收上游全部图片，结果保存后继续下游。</p>
                <div className="my-3 space-y-2">
                    {(project?.nodes || []).filter((node) => node.type === "config" && (!node.metadata?.generationMode || node.metadata.generationMode === "image")).map((node) => (
                        <label key={node.id} className="flex items-center gap-2">
                            <span>{node.title} · 生图来源</span>
                            <select disabled={busy} className="min-w-0 flex-1 bg-transparent" value={sources[node.id] || (node.metadata?.generationSource === "codex" ? `codex:${node.metadata.codexModel}` : "api")} onChange={(event) => { setSources((current) => ({ ...current, [node.id]: event.target.value })); setPlan(undefined); }}>
                                <option value="api">模型 API（使用配置节点的模型）</option>
                                {native.models.map((model) => <option key={model.model} value={`codex:${model.model}`}>本机 Codex · {model.model}</option>)}
                                {node.metadata?.codexModel && !native.models.some((model) => model.model === node.metadata?.codexModel) && <option value={`codex:${node.metadata.codexModel}`}>本机 Codex · {node.metadata.codexModel}（待验证）</option>}
                            </select>
                        </label>
                    ))}
                    <div className="flex gap-3 text-xs">
                        <button disabled={busy} onClick={() => { const agent = useAgentStore.getState(); agent.openPanel(); agent.setAgentState({ activeTab: "setup" }); }}>{native.connected ? "查看本机连接" : "连接本机 Agent"}</button>
                        <button disabled={busy || native.loading || !native.connected} onClick={() => void native.refresh()}>刷新 Codex 模型与能力</button>
                    </div>
                    {native.error && <p className="text-xs">{native.error}</p>}
                </div>
                <div className="my-3 flex flex-wrap gap-3">
                    <button disabled={busy} onClick={() => void inspect(false, true)}>预览全部步骤</button>
                    <button disabled={busy} onClick={() => void inspect()}>
                        预览选定节点
                    </button>
                    <button disabled={busy} onClick={() => void inspect(true)}>
                        预览选定节点及下游
                    </button>
                    {busy && (
                        <button
                            onClick={() => {
                                stop.current = true;
                            }}
                        >
                            本步骤结束后停止
                        </button>
                    )}
                </div>
                {plan && (
                    <div className="space-y-3">
                        <label className="flex items-center gap-2">
                            计划名称
                            <input className="min-w-0 flex-1 bg-transparent" value={plan.title} onChange={(event) => setPlan({ ...plan, title: event.target.value })} />
                        </label>
                        <p>
                            {plan.steps.length} 步 · 共 {plan.steps.reduce((sum, step) => sum + step.calls, 0)} 次生成请求 · API 按渠道计费，本机 Codex 按账户规则计费
                        </p>
                        {plan.steps.map((step, index) => (
                            <div key={step.id} className="border-b py-2" style={{ borderColor: theme.node.stroke }}>
                                <p>
                                    {index + 1}. {step.title} · {step.action ? "插件处理" : step.source === "codex" ? "本机 Codex 生图" : workflowModeLabels[step.mode]} · {step.calls} 次
                                </p>
                                <p className="break-all text-xs">{step.prompt}</p>
                                <p className="text-xs">
                                    {step.action ? `插件：${step.action.pluginId} · ${step.action.version}` : `模型：${workflowModel(step)}`} · 输入：
                                    {step.inputs.map((input) => (input.stepId ? `步骤 ${plan.steps.findIndex((item) => item.id === input.stepId) + 1}` : plan.resources.find((node) => node.id === input.nodeId)?.title || input.nodeId)).join("、") || "无"}
                                </p>
                                <pre className="overflow-auto text-xs">{JSON.stringify(step.actual, null, 2)}</pre>
                                {step.action ? <p className="text-xs">{getNodeDefinition(step.action.nodeType)?.workflowAction?.description} · 原图保留，结果保存后继续；刷新后不自动重做。</p> : step.source === "codex" ? <p className="text-xs">一个原生任务；数量、比例等要求请写入提示词。图片保存后才执行下游。</p> : <CreationEstimate config={config} approvedCondition={workflowEstimateCondition(step, plan, config)} />}
                            </div>
                        ))}
                        <div className="flex gap-3">
                            <button disabled={busy} onClick={() => void run(createWorkflowRun(plan))}>
                                确认执行此计划
                            </button>
                            <button
                                disabled={busy}
                                onClick={() =>
                                    void useWorkflowStore
                                        .getState()
                                        .save(plan, plan.title)
                                        .then(() => message.success("模板已保存到本机"))
                                        .catch(report)
                                }
                            >
                                保存为模板
                            </button>
                        </div>
                    </div>
                )}
                <details className="mt-5">
                    <summary>本机模板（{templates.length}）</summary>
                    <input hidden ref={templateInput} type="file" accept=".zip" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void templateAction(async () => { await importWorkflowTemplate(file); message.success("模板及原始素材已导入，请展开并重新预览参数"); }); }} />
                    <button disabled={busy} onClick={() => templateInput.current?.click()}>导入模板 ZIP</button>
                    {templates.map((template) => (
                        <div key={template.id} className="my-2 flex gap-3">
                            <span>{template.title}</span>
                            <button disabled={busy} onClick={() => void templateAction(() => exportWorkflowTemplate(template))}>导出 ZIP</button>
                            <button disabled={busy} onClick={() => void apply(template.plan)}>
                                展开到画布
                            </button>
                            <button disabled={busy} onClick={() => void useWorkflowStore.getState().remove(template.id).catch(report)}>
                                删除
                            </button>
                        </div>
                    ))}
                </details>
                <details className="mt-5" open>
                    <summary>运行记录</summary>
                    {(project?.workflowRuns || []).map((runRecord) => (
                        <div className="my-3" key={runRecord.id}>
                            <p>
                                {runRecord.plan.title} · {runRecord.steps.map((step) => ({ pending: "未执行", running: "中断待核实", succeeded: "成功", failed: "失败", interrupted: "中断" })[step.status]).join(" → ")}
                            </p>
                            {runRecord.steps.some((step) => step.status === "pending") && !runRecord.steps.some((step) => ["running", "failed", "interrupted"].includes(step.status)) && (
                                <button disabled={busy} onClick={() => void run(structuredClone(runRecord))}>
                                    继续未执行步骤
                                </button>
                            )}
                            {runRecord.steps.some((step) => ["running", "failed", "interrupted"].includes(step.status)) && (
                                <div>
                                    <p className="text-xs">请在本轮结果节点重试或取任务状态；已开始的请求不会自动重提，下游保持未执行。</p>
                                    <button
                                        disabled={busy}
                                        onClick={() => {
                                            try {
                                                const current = useCanvasStore.getState().openProject(projectId)!;
                                                void run(reconcileWorkflow(runRecord, current.nodes, current.connections));
                                            } catch (error) {
                                                report(error);
                                            }
                                        }}
                                    >
                                        核对已有结果并继续
                                    </button>
                                </div>
                            )}
                        </div>
                    ))}
                </details>
            </Modal>
        </>
    );
}
