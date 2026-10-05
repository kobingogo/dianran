import { create } from "zustand";
import { nanoid } from "nanoid";
import { canvasIndexedStorage } from "@/lib/localforage-storage";
import { storageKey } from "@/constant/brand";
import type { WorkflowPlan } from "@/lib/canvas/workflow";
import type { CanvasNodeMetadata } from "@/types/canvas";

export type WorkflowTemplate = { id: string; title: string; plan: WorkflowPlan };
const key = storageKey("workflow_templates");
export function workflowTemplate(plan: WorkflowPlan, title: string): WorkflowTemplate {
    const clean = structuredClone(plan);
    clean.resources = clean.resources.map((node) => {
        const m = node.metadata || {};
        if (!m.storageKey && m.content?.startsWith("blob:")) throw new Error("临时素材尚未保存，无法创建模板");
        const metadata: CanvasNodeMetadata = { content: m.storageKey ? "" : m.content, storageKey: m.storageKey, naturalWidth: m.naturalWidth, naturalHeight: m.naturalHeight, bytes: m.bytes, mimeType: m.mimeType, status: "success" };
        return { ...node, metadata };
    });
    return { id: nanoid(), title: title.trim() || plan.title, plan: clean };
}
export const useWorkflowStore = create<{
    templates: WorkflowTemplate[];
    hydrated: boolean;
    panelOpen: boolean;
    proposal?: { projectId: string; plan: WorkflowPlan };
    load: () => Promise<void>;
    save: (plan: WorkflowPlan, title: string) => Promise<void>;
    remove: (id: string) => Promise<void>;
}>((set, get) => ({
    templates: [],
    hydrated: false,
    panelOpen: false,
    load: async () => {
        const templates = (await canvasIndexedStorage.getItem<WorkflowTemplate[]>(key)) || [];
        if (!Array.isArray(templates)) throw new Error("工作流模板数据损坏，原数据未覆盖");
        set({ templates, hydrated: true });
    },
    save: async (plan, title) => {
        if (!get().hydrated) await get().load();
        const templates = [...get().templates, workflowTemplate(plan, title)];
        await canvasIndexedStorage.setItem(key, templates);
        set({ templates });
    },
    remove: async (id) => {
        if (!get().hydrated) await get().load();
        const templates = get().templates.filter((item) => item.id !== id);
        await canvasIndexedStorage.setItem(key, templates);
        set({ templates });
    },
}));
