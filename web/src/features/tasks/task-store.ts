// Business receipts persist across pages; network observations only supplement the task list.
import { create } from "zustand";
import localforage from "localforage";
import { STORAGE_NS } from "@/constant/brand";
import { createSaveQueue } from "@/lib/canvas/save-queue";
import { writeOwnership } from "@/lib/write-ownership";

export type TaskKind = "image" | "video" | "text" | "audio";
export type TaskPhase = "requesting" | "queued" | "generating" | "receiving" | "done" | "failed" | "canceled" | "stale" | "unknown";

export type GenerationTask = {
    managed?: boolean;
    summary?: string;
    batchId?: string;
    creationId?: string;
    nodeId?: string;
    source?: "api" | "agent" | "plugin";
    saveState?: "saving" | "saved" | "error";
    saveError?: string;
    hidden?: boolean;
    id: string;
    kind: TaskKind;
    model: string;
    host: string;
    /** Same-tab workbench route where this request started (path only; no query or hash). */
    sourcePath?: string;
    phase: TaskPhase;
    startedAt: number;
    updatedAt: number;
    endedAt?: number;
    /** Real progress reported by the provider (0-100), when available. */
    progress?: number;
    loadedBytes?: number;
    totalBytes?: number;
    status?: number;
    error?: string;
    /** Provider-side task id / operation name used to match polling requests. */
    remoteId?: string;
    polls?: number;
};

export const ACTIVE_PHASES: TaskPhase[] = ["requesting", "queued", "generating", "receiving"];
export const isActiveTask = (task: GenerationTask) => ACTIVE_PHASES.includes(task.phase);

const MAX_TASKS = 40;

type TaskStore = {
    storageError: string;
    tasks: GenerationTask[];
    add: (task: GenerationTask) => void;
    update: (id: string, patch: Partial<GenerationTask>) => void;
    clearFinished: () => void;
    /** In-memory UI flag only. Not persisted, so existing task data is untouched. */
    centerOpen: boolean;
    setCenterOpen: (open: boolean) => void;
};

export const useTaskStore = create<TaskStore>()((set) => ({
    storageError: "",
    tasks: [],
    centerOpen: false,
    add: (task) => set((state) => ({ tasks: [task, ...state.tasks.filter((item) => item.id !== task.id)].filter((item, index, all) => item.managed || all.slice(0, index).filter((value) => !value.managed).length < MAX_TASKS) })),
    update: (id, patch) => set((state) => ({ tasks: state.tasks.map((task) => (task.id === id ? { ...task, ...patch, updatedAt: Date.now() } : task)) })),
    clearFinished: () => set((state) => ({ tasks: state.tasks.flatMap((task) => isActiveTask(task) || task.phase === "unknown" || (task.saveState === "error" || task.saveState === "saving") ? [task] : task.managed ? [{ ...task, hidden: true }] : []) })),
    setCenterOpen: (centerOpen) => set({ centerOpen }),
}));

const storage = localforage.createInstance({ name: STORAGE_NS, storeName: "creation_tasks" });
let readable = false;
const restoredTasks = new WeakMap<GenerationTask, GenerationTask>();
const saves = createSaveQueue<GenerationTask[]>(async (tasks) => { await storage.setItem("tasks", tasks.map((task) => restoredTasks.get(task) || task)); }, (status, error) => useTaskStore.setState({ storageError: status === "error" ? `任务记录未保存：${String(error)}` : "" }));
useTaskStore.subscribe((state, previous) => {
    if (readable && state.tasks !== previous.tasks && writeOwnership.canWrite()) {
        saves.enqueue(state.tasks.filter((task) => task.managed));
        void saves.flush().catch(() => {});
    }
});
export const flushTaskSave = () => saves.flush();
export async function reloadCreationTasks() {
    await saves.flush();
    const saved = await storage.getItem<GenerationTask[]>("tasks");
    if (saved && (!Array.isArray(saved) || saved.some((task) => !task.id || !task.kind || !task.phase))) throw new Error("任务记录损坏，原数据未覆盖");
    const current = useTaskStore.getState().tasks.filter((task) => !task.managed);
    useTaskStore.setState({ tasks: [...current, ...(saved || []).filter((task) => !current.some((item) => item.id === task.id)).map((task) => {
        if (!isActiveTask(task)) return task;
        const restored = { ...task, phase: "unknown" as const, error: "请查询原任务；其他页面或远端可能仍在执行，不会自动重新生成" };
        restoredTasks.set(restored, task); // A display-only unknown must not overwrite another page's live receipt.
        return restored;
    })] });
    readable = true;
}
export function beginCreationTask(input: Pick<GenerationTask, "id" | "kind" | "model" | "sourcePath"> & Partial<GenerationTask>) {
    const now = Date.now();
    const previous = useTaskStore.getState().tasks.find((task) => task.id === input.id);
    useTaskStore.getState().add({ host: input.source === "agent" ? "本机 Codex" : "模型 API", phase: "requesting", startedAt: now, ...previous, updatedAt: now, ...input, managed: true, hidden: false });
    return input.id;
}
export function updateCreationTask(id: string, patch: Partial<GenerationTask>) {
    const terminal = patch.phase && !ACTIVE_PHASES.includes(patch.phase);
    useTaskStore.getState().update(id, { ...patch, ...(terminal ? { endedAt: Date.now() } : patch.phase ? { endedAt: undefined } : {}) });
}

export function useBoundTask(binding: { taskId?: string; nodeId?: string; sourcePath?: string }) {
    return useTaskStore((state) => binding.taskId ? state.tasks.find((task) => task.id === binding.taskId) : binding.nodeId ? state.tasks.find((task) => task.nodeId === binding.nodeId && task.sourcePath === binding.sourcePath && !task.hidden) : undefined);
}

export function useActiveTaskCount() {
    return useTaskStore((state) => {
        let count = 0;
        for (const task of state.tasks) if (isActiveTask(task)) count += 1;
        return count;
    });
}

/** Most recent active task of a kind (used by in-node status labels). */
export function useLatestActiveTask(kind: TaskKind | TaskKind[]) {
    const kinds = Array.isArray(kind) ? kind : [kind];
    return useTaskStore((state) => state.tasks.find((task) => kinds.includes(task.kind) && isActiveTask(task)));
}
