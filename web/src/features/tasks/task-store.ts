// [dianran] In-memory generation task list (not persisted). Fed by request-tracker.ts.
import { create } from "zustand";

export type TaskKind = "image" | "video" | "text" | "audio";
export type TaskPhase = "requesting" | "queued" | "generating" | "receiving" | "done" | "failed" | "canceled" | "stale";

export type GenerationTask = {
    id: string;
    kind: TaskKind;
    model: string;
    host: string;
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
    tasks: GenerationTask[];
    add: (task: GenerationTask) => void;
    update: (id: string, patch: Partial<GenerationTask>) => void;
    clearFinished: () => void;
};

export const useTaskStore = create<TaskStore>()((set) => ({
    tasks: [],
    add: (task) => set((state) => ({ tasks: [task, ...state.tasks].slice(0, MAX_TASKS) })),
    update: (id, patch) => set((state) => ({ tasks: state.tasks.map((task) => (task.id === id ? { ...task, ...patch, updatedAt: Date.now() } : task)) })),
    clearFinished: () => set((state) => ({ tasks: state.tasks.filter(isActiveTask) })),
}));

/** Most recent active task of a kind (used by in-node status labels). */
export function useLatestActiveTask(kind: TaskKind | TaskKind[]) {
    const kinds = Array.isArray(kind) ? kind : [kind];
    return useTaskStore((state) => state.tasks.find((task) => kinds.includes(task.kind) && isActiveTask(task)));
}
