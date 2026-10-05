import { useState } from "react";
import { App, Modal, Select } from "antd";
import { useNavigate } from "react-router-dom";
import { nanoid } from "nanoid";
import { InkButton } from "@/components/ui/ink-button";
import { type ComposerSubmission, type CreationSnapshot } from "@/lib/composer";
import type { CanvasNodeData } from "@/types/canvas";
import { showErrorToast } from "@/features/errors/error-toast";

export type Deliverable = { id: string; url: string; storageKey?: string; width: number; height: number; bytes: number; mimeType?: string; creation?: CreationSnapshot };
async function canvasStore() {
    const { useCanvasStore } = await import("@/stores/canvas/use-canvas-store");
    if (!useCanvasStore.persist.hasHydrated()) await useCanvasStore.persist.rehydrate();
    return useCanvasStore;
}
export async function prepareCanvasSubmission(submission: ComposerSubmission) {
    if (!submission.canvas || submission.canvasProjectId) return submission;
    const store = await canvasStore();
    return { ...submission, canvasProjectId: store.getState().createProject(submission.prompt.slice(0, 24)) };
}
export async function deliverToCanvas(kind: "image" | "video", result: Deliverable, projectId?: string) {
    const store = await canvasStore();
    const target = projectId || store.getState().createProject(result.creation?.prompt.slice(0, 24) || "工作台结果");
    const project = store.getState().openProject(target);
    if (!project) throw new Error("目标画布已不存在，请重新选择");
    if (project.nodes.some((node) => node.metadata?.sourceResultId === result.id)) return target;
    const width = 360;
    const height = width * ((result.height || 1) / (result.width || 1));
    const node: CanvasNodeData = {
        id: nanoid(),
        type: kind,
        title: kind === "image" ? "生图结果" : "视频结果",
        position: { x: project.nodes.length ? Math.max(...project.nodes.map((node) => node.position.x + node.width)) + 40 : 80, y: 80 },
        width,
        height,
        metadata: {
            content: result.url,
            status: "success",
            storageKey: result.storageKey,
            naturalWidth: result.width,
            naturalHeight: result.height,
            bytes: result.bytes,
            mimeType: result.mimeType,
            prompt: result.creation?.prompt,
            model: result.creation?.parameters[kind === "image" ? "imageModel" : "videoModel"],
            creation: result.creation,
            sourceResultId: result.id,
        },
    };
    store.getState().updateProject(target, { nodes: [...project.nodes, node] });
    return target;
}
export function CanvasDeliveryButton({ kind, result }: { kind: "image" | "video"; result: Deliverable }) {
    const { message } = App.useApp();
    const navigate = useNavigate();
    const [projects, setProjects] = useState<Array<{ id: string; title: string }>>([]);
    const [open, setOpen] = useState(false);
    const [target, setTarget] = useState("");
    const [busy, setBusy] = useState(false);
    const choose = async () => {
        try {
            const store = await canvasStore();
            setProjects(store.getState().projects);
            setOpen(true);
        } catch (error) {
            showErrorToast(message, error, "读取画布失败");
        }
    };
    const deliver = async () => {
        if (busy) return;
        setBusy(true);
        try {
            const id = await deliverToCanvas(kind, result, target || undefined);
            setOpen(false);
            navigate(`/canvas/${id}`);
        } catch (error) {
            showErrorToast(message, error, "送入画布失败");
        } finally {
            setBusy(false);
        }
    };
    return (
        <>
            <InkButton size={32} variant="paper" onClick={() => void choose()}>
                送入画布
            </InkButton>
            <Modal title="送入画布" open={open} onCancel={() => setOpen(false)} onOk={() => void deliver()} confirmLoading={busy} okText="送入并打开">
                <p className="text-sm text-[color:var(--ink-500)]">仅送最终结果、提示词与本轮参数；不包含输入节点和完整创作过程。</p>
                <Select className="w-full" aria-label="目标画布" value={target} onChange={setTarget} options={[{ value: "", label: "新建画布" }, ...projects.map((project) => ({ value: project.id, label: project.title }))]} />
            </Modal>
        </>
    );
}
