import { useState } from "react";
import { App, Modal, Select } from "antd";
import { useNavigate } from "react-router-dom";
import { appendDeliveryGraph, type Deliverable } from "@/lib/canvas/canvas-delivery-graph";
import { hydrateNodeGenerationContext } from "@/components/canvas/canvas-node-generation";
import { InkButton } from "@/components/ui/ink-button";
import { type ComposerSubmission } from "@/lib/composer";
import { showErrorToast } from "@/features/errors/error-toast";

export type { Deliverable } from "@/lib/canvas/canvas-delivery-graph";
async function canvasStore() {
    const { useCanvasStore } = await import("@/stores/canvas/use-canvas-store");
    if (!useCanvasStore.persist.hasHydrated()) await useCanvasStore.persist.rehydrate();
    if (!useCanvasStore.getState().hydrated) throw new Error("画布读取失败，请先重试读取，原数据未覆盖");
    return useCanvasStore;
}
export async function prepareCanvasSubmission(submission: ComposerSubmission) {
    if (!submission.canvas || submission.canvasProjectId) return submission;
    const store = await canvasStore();
    return { ...submission, canvasProjectId: store.getState().createProject(submission.prompt.slice(0, 24)) };
}
export async function deliverToCanvas(kind: "image" | "video", result: Deliverable, projectId?: string, process = false) {
    let references = result.creation?.references || [];
    if (process) {
        if (!result.creation || references.length !== result.creation.referenceIds.length) throw new Error("此结果缺少完整输入快照，只能送入最终结果");
        references = (await hydrateNodeGenerationContext({ prompt: result.creation.prompt, referenceImages: references, referenceVideos: [], referenceAudios: [], textCount: 0, imageCount: references.length, videoCount: 0, audioCount: 0 })).referenceImages;
    }
    const store = await canvasStore();
    const target = projectId || store.getState().createProject(result.creation?.prompt.slice(0, 24) || "工作台结果");
    const project = store.getState().openProject(target);
    if (!project) throw new Error("目标画布已不存在，请重新选择");
    store.getState().updateProject(target, appendDeliveryGraph(kind, result, project.nodes, project.connections, process, references));
    const { flushCanvasSave } = await import("@/stores/canvas/use-canvas-store");
    await flushCanvasSave();
    return target;
}
export function CanvasDeliveryButton({ kind, result }: { kind: "image" | "video"; result: Deliverable }) {
    const { message } = App.useApp();
    const navigate = useNavigate();
    const [projects, setProjects] = useState<Array<{ id: string; title: string }>>([]);
    const [open, setOpen] = useState(false);
    const [target, setTarget] = useState("");
    const [process, setProcess] = useState(false);
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
            const id = await deliverToCanvas(kind, result, target || undefined, process);
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
                <p className="text-sm text-[color:var(--ink-500)]">默认送入最终结果；可将本轮参考素材、配置与结果连线一起送入。</p>
                <label className="my-3 flex items-center gap-2"><input type="checkbox" checked={process} onChange={(event) => setProcess(event.target.checked)} disabled={!result.creation || (result.creation.references?.length || 0) !== result.creation.referenceIds.length} />连同创作过程送入画布</label>
                <Select className="w-full" aria-label="目标画布" value={target} onChange={setTarget} options={[{ value: "", label: "新建画布" }, ...projects.map((project) => ({ value: project.id, label: project.title }))]} />
            </Modal>
        </>
    );
}
