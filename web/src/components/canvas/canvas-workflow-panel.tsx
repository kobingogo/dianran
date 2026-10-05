import { nanoid } from "nanoid";
import { useEffect, useRef, useState } from "react";
import { App, Modal } from "antd";
import { useParams } from "react-router-dom";
import { useCanvasStore, flushCanvasSave } from "@/stores/canvas/use-canvas-store";
import { useWorkflowStore } from "@/stores/canvas/use-workflow-store";
import { useEffectiveConfig } from "@/stores/use-config-store";
import { createWorkflowRun, executeWorkflow, instantiateWorkflow, planWorkflow, reconcileWorkflow, workflowScope, type WorkflowPlan, type WorkflowRun, type WorkflowStep, type WorkflowStepRun } from "@/lib/canvas/workflow";
import { hydrateCanvasImages } from "@/lib/canvas/canvas-generation-helpers";
import { useThemeStore } from "@/stores/use-theme-store";
import { canvasThemes } from "@/lib/canvas-theme";
import type { CanvasNodeData, CanvasConnection } from "@/types/canvas";
import { showErrorToast } from "@/features/errors/error-toast";

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
    const { message } = App.useApp();
    const config = useEffectiveConfig();
    const project = useCanvasStore((store) => store.projects.find((item) => item.id === projectId));
    const proposal = useWorkflowStore((store) => store.proposal);
    const templates = useWorkflowStore((store) => store.templates);
    const theme = canvasThemes[useThemeStore((store) => store.theme)];
    const open = useWorkflowStore((store) => store.panelOpen);
    const setOpen = (panelOpen: boolean) => useWorkflowStore.setState({ panelOpen });
    const [plan, setPlan] = useState<WorkflowPlan>();
    const [busy, setBusy] = useState(false);
    const stop = useRef(false);
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
    const inspect = async (downstream = false) => {
        try {
            await flushCanvasSave();
            const current = useCanvasStore.getState().openProject(projectId);
            if (!current) throw new Error("画布已不存在");
            setPlan(planWorkflow(current.nodes, current.connections, workflowScope(current.nodes, current.connections, [...selectedIds], downstream), config));
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
                <p>生图/视频 MVP。配置修改与连线不触发调用；每次运行创建独立配置与结果，保留原作品。依赖步骤使用上游结果的主图。</p>
                <div className="my-3 flex flex-wrap gap-3">
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
                            {plan.steps.length} 步 · 共 {plan.steps.reduce((sum, step) => sum + step.calls, 0)} 次生成请求 · 费用由配置的渠道计费
                        </p>
                        {plan.steps.map((step, index) => (
                            <div key={step.id} className="border-b py-2" style={{ borderColor: theme.node.stroke }}>
                                <p>
                                    {index + 1}. {step.title} · {step.mode === "image" ? "图片" : "视频"} · {step.calls} 次
                                </p>
                                <p className="break-all text-xs">{step.prompt}</p>
                                <p className="text-xs">
                                    模型：{step.parameters[step.mode === "image" ? "imageModel" : "videoModel"]} · 输入：
                                    {step.inputs.map((input) => (input.stepId ? `步骤 ${plan.steps.findIndex((item) => item.id === input.stepId) + 1}` : input.nodeId)).join("、") || "无"}
                                </p>
                                <pre className="overflow-auto text-xs">{JSON.stringify(step.actual, null, 2)}</pre>
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
                    {templates.map((template) => (
                        <div key={template.id} className="my-2 flex gap-3">
                            <span>{template.title}</span>
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
