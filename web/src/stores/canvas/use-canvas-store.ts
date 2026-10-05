import { create } from "zustand";
import { persist, type PersistStorage, type StorageValue } from "zustand/middleware";

import { nanoid } from "nanoid";
import i18n from "@/i18n";
import { canvasIndexedStorage } from "@/lib/localforage-storage";
import { createSaveQueue } from "@/lib/canvas/save-queue";
import { useCanvasSaveStore } from "./use-canvas-save-store";
import type { CanvasBackgroundMode } from "@/lib/canvas-theme";
import type { CanvasAssistantSession, CanvasConnection, CanvasNodeData, ViewportTransform } from "@/types/canvas";
import { storageKey } from "@/constant/brand";

export type CanvasProject = {
    id: string;
    title: string;
    createdAt: string;
    updatedAt: string;
    nodes: CanvasNodeData[];
    connections: CanvasConnection[];
    chatSessions: CanvasAssistantSession[];
    activeChatId: string | null;
    backgroundMode: CanvasBackgroundMode;
    showImageInfo: boolean;
    viewport: ViewportTransform;
    workflowRuns?: import("@/lib/canvas/workflow").WorkflowRun[];
};

export type CanvasDeletedProject = {
    id: string;
    deletedAt: string;
};

type CanvasStore = {
    hydrated: boolean;
    projects: CanvasProject[];
    deletedProjects: CanvasDeletedProject[];
    createProject: (title?: string) => string;
    importProject: (project: Partial<CanvasProject>) => string;
    openProject: (id: string) => CanvasProject | null;
    renameProject: (id: string, title: string) => void;
    deleteProjects: (ids: string[]) => void;
    replaceProjects: (projects: CanvasProject[], deletedProjects?: CanvasDeletedProject[]) => void;
    updateProject: (id: string, patch: Partial<Pick<CanvasProject, "nodes" | "connections" | "chatSessions" | "activeChatId" | "backgroundMode" | "showImageInfo" | "viewport" | "workflowRuns">>) => void;
};

const initialViewport: ViewportTransform = { x: 0, y: 0, k: 1 };
const CANVAS_STORE_KEY = storageKey("canvas_store");
type PersistedCanvasState = Pick<CanvasStore, "projects" | "deletedProjects">;
let queuedPersistState: PersistedCanvasState | null = null;
let readable = false;
const saveQueue = createSaveQueue<StorageValue<CanvasStore>>(
    (value) => canvasIndexedStorage.setItem(CANVAS_STORE_KEY, JSON.stringify(value)),
    (status, error) => useCanvasSaveStore.setState({ status, error: error instanceof Error ? error.message : error ? String(error) : "" }),
);
export const flushCanvasSave = () => saveQueue.flush();
export const retryCanvasSave = async () => {
    if (useCanvasSaveStore.getState().readFailed) await useCanvasStore.persist.rehydrate();
    else { useCanvasSaveStore.setState({ status: "saving", error: "" }); await saveQueue.flush(); }
};

if (typeof window !== "undefined") {
    window.addEventListener("beforeunload", (event) => {
        if (!saveQueue.hasPending()) return;
        event.preventDefault();
        event.returnValue = "";
    });
    document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "hidden") void saveQueue.flush().catch(() => {});
    });
}

const canvasStorage: PersistStorage<CanvasStore> = {
    getItem: async (name) => {
        if (readable && saveQueue.hasPending()) await saveQueue.flush();
        readable = false;
        useCanvasSaveStore.setState({ status: "loading", error: "", readFailed: false });
        const value = await canvasIndexedStorage.getItem<string>(name);
        const parsed = value ? JSON.parse(value) as StorageValue<CanvasStore> : null;
        if (parsed && (!Array.isArray(parsed.state?.projects) || !Array.isArray(parsed.state?.deletedProjects))) throw new Error("画布数据格式损坏，请保留原数据后恢复备份");
        queuedPersistState = parsed?.state as PersistedCanvasState || null;
        readable = true;
        useCanvasSaveStore.setState({ status: "saved" });
        return parsed;
    },
    setItem: (_name, value) => {
        if (!readable) return;
        const nextState = value.state as PersistedCanvasState;
        if (queuedPersistState && queuedPersistState.projects === nextState.projects && queuedPersistState.deletedProjects === nextState.deletedProjects) return;
        queuedPersistState = nextState;
        saveQueue.enqueue(value);
    },
    removeItem: (name) => canvasIndexedStorage.removeItem(name),
};

export const useCanvasStore = create<CanvasStore>()(
    persist(
        (set, get) => ({
            hydrated: false,
            projects: [],
            deletedProjects: [],
            createProject: (title = i18n.t("canvas.project.untitled")) => {
                const now = new Date().toISOString();
                const id = nanoid();
                const project: CanvasProject = {
                    id,
                    title,
                    createdAt: now,
                    updatedAt: now,
                    nodes: [],
                    connections: [],
                    chatSessions: [],
                    activeChatId: null,
                    backgroundMode: "dots",
                    showImageInfo: false,
                    viewport: initialViewport,
                };
                set((state) => ({ projects: [project, ...state.projects] }));
                return id;
            },
            importProject: (source) => {
                const now = new Date().toISOString();
                const project: CanvasProject = {
                    id: nanoid(),
                    title: source.title || i18n.t("canvas.project.imported"),
                    createdAt: source.createdAt || now,
                    updatedAt: now,
                    nodes: source.nodes || [],
                    connections: source.connections || [],
                    chatSessions: source.chatSessions || [],
                    activeChatId: source.activeChatId || null,
                    backgroundMode: source.backgroundMode || "lines",
                    showImageInfo: source.showImageInfo || false,
                    viewport: source.viewport || initialViewport,
                    workflowRuns: source.workflowRuns,
                };
                set((state) => ({ projects: [project, ...state.projects] }));
                return project.id;
            },
            openProject: (id) => {
                return get().projects.find((item) => item.id === id) || null;
            },
            renameProject: (id, title) =>
                set((state) => ({
                    projects: state.projects.map((project) => (project.id === id ? { ...project, title: title.trim() || project.title, updatedAt: new Date().toISOString() } : project)),
                })),
            deleteProjects: (ids) =>
                set((state) => {
                    const now = new Date().toISOString();
                    const removing = new Set(ids);
                    const projects = state.projects.filter((project) => !removing.has(project.id));
                    const deletedProjects = [...state.deletedProjects.filter((item) => !removing.has(item.id)), ...ids.map((id) => ({ id, deletedAt: now }))];
                    return { projects, deletedProjects };
                }),
            replaceProjects: (projects, deletedProjects = []) => set({ projects, deletedProjects }),
            updateProject: (id, patch) =>
                set((state) => ({
                    projects: state.projects.map((project) => (project.id === id ? { ...project, ...patch, updatedAt: new Date().toISOString() } : project)),
                })),
        }),
        {
            name: CANVAS_STORE_KEY,
            storage: canvasStorage,
            partialize: (state) =>
                ({
                    projects: state.projects,
                    deletedProjects: state.deletedProjects,
                }) as StorageValue<CanvasStore>["state"],
            onRehydrateStorage: () => (_state, error) => {
                if (error) {
                    useCanvasSaveStore.setState({ status: "error", readFailed: true, error: error instanceof Error ? error.message : String(error) });
                    return;
                }
                useCanvasStore.setState({ hydrated: true });
            },
        },
    ),
);
