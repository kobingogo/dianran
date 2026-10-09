import { createSaveQueue } from "@/lib/canvas/save-queue";
import { assertBusinessWriter, writeOwnership } from "@/lib/write-ownership";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import localforage from "localforage";
import { STORAGE_NS, storageKey } from "@/constant/brand";
import { resolveImageUrl } from "@/services/image-storage";
import { uniqueReferences, type ComposerMode, type ComposerParameters } from "@/lib/composer";
import type { ReferenceImage } from "@/types/image";
import type { CreationConversation } from "@/lib/creation-conversation";
import { nanoid } from "nanoid";
import { useConfigStore } from "./use-config-store";

export type ComposerDraft = { initialized: boolean; prompt: string; references: ReferenceImage[]; canvas: boolean; parameters?: ComposerParameters; nodeIds?: string[] };
type Draft = ComposerDraft;
export const EMPTY_COMPOSER_DRAFT: Draft = { initialized: false, prompt: "", references: [], canvas: false };
type ComposerStore = {
    hydrated: boolean;
    mode: ComposerMode;
    image: Draft;
    video: Draft;
    scoped: Record<string, Draft>;
    agentDrafts: Record<string, { prompt: string; attachments: import("@/stores/use-agent-store").AgentAttachment[]; canvasReferences: import("@/lib/canvas/canvas-resource-references").CanvasResourceReference[] }>;
    agentResultProjects: Record<string, string>;
    canvasContexts: Record<string, { scope: string; targetId?: string; mode: ComposerMode }>;
    rememberCanvasContext: (projectId: string, context?: ComposerStore["canvasContexts"][string]) => void;
    conversations: Record<string, CreationConversation>;
    activeConversations: Record<string, string>;
    ensureConversation: (scope: string, mode: ComposerMode, fresh?: boolean) => string;
    activateConversation: (id: string) => void;
    updateConversation: (id: string, change: Partial<CreationConversation>) => void;
    saveAgentResultProject: (key: string, projectId: string) => void;
    saveAgentDraft: (key: string, draft: ComposerStore["agentDrafts"][string]) => void;
    setMode: (mode: ComposerMode) => void;
    patch: (mode: ComposerMode, patch: Partial<Draft>, scope?: string) => void;
    setReferences: (mode: ComposerMode, next: ReferenceImage[] | ((refs: ReferenceImage[]) => ReferenceImage[]), scope?: string) => void;
};
const draftStorage = localforage.createInstance({ name: STORAGE_NS, storeName: "app_state" });
let draftError: unknown;
const draftQueue = createSaveQueue<string>((value) => draftStorage.setItem(storageKey("composer_drafts"), value), (_status, error) => { draftError = error; });
export const flushComposerSave = () => draftQueue.flush();
export const composerSaveError = () => draftError;
if (typeof window !== "undefined") {
    window.addEventListener("beforeunload", (event) => {
        if (!draftQueue.hasPending()) return;
        event.preventDefault();
        event.returnValue = "";
    });
    document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "hidden" && writeOwnership.canWrite()) void draftQueue.flush().catch(() => {});
    });
}
const empty = (): Draft => ({ initialized: false, prompt: "", references: [], canvas: false });
export const useComposerStore = create<ComposerStore>()(
    persist(
        (set) => {
            const commit = set;
            set = ((...args: Parameters<typeof set>) => { assertBusinessWriter(); (commit as (...values: Parameters<typeof set>) => void)(...args); }) as typeof set;
            return {
                hydrated: false,
                mode: "image",
                image: empty(),
                video: empty(),
                scoped: {},
                agentDrafts: {},
                agentResultProjects: {},
                canvasContexts: {},
                rememberCanvasContext: (projectId, context) => set((state) => { const canvasContexts = { ...state.canvasContexts }; if (context) canvasContexts[projectId] = context; else delete canvasContexts[projectId]; return { canvasContexts }; }),
                conversations: {},
                activeConversations: {},
                ensureConversation: (scope, mode, fresh = false) => {
                    const current = useComposerStore.getState();
                    if (!fresh && current.activeConversations[scope]) return current.activeConversations[scope];
                    const id = nanoid();
                    const previous = current.activeConversations[scope];
                    const draft = scope === mode ? current[mode] : current.scoped[scope] || empty();
                    set({ conversations: { ...current.conversations, ...(previous ? { [previous]: { ...current.conversations[previous], draft } } : {}), [id]: { id, mode, scope, entries: [], purpose: "generate", dialogueModel: useConfigStore.getState().config.textModel } }, activeConversations: { ...current.activeConversations, [scope]: id } });
                    if (fresh) useComposerStore.getState().patch(mode, { prompt: "", references: [], nodeIds: [] }, scope === mode ? undefined : scope);
                    return id;
                },
                activateConversation: (id) => {
                    const current = useComposerStore.getState();
                    const next = current.conversations[id];
                    if (!next) return;
                    const { scope, mode } = next;
                    const previous = current.activeConversations[scope];
                    const draft = scope === mode ? current[mode] : current.scoped[scope] || empty();
                    set({ conversations: { ...current.conversations, ...(previous ? { [previous]: { ...current.conversations[previous], draft } } : {}) }, activeConversations: { ...current.activeConversations, [scope]: id } });
                    useComposerStore.getState().patch(mode, next.draft || empty(), scope === mode ? undefined : scope);
                },
                updateConversation: (id, change) => set((state) => ({ conversations: { ...state.conversations, [id]: { ...state.conversations[id], ...change } } })),
                saveAgentResultProject: (key, projectId) => set((state) => ({ agentResultProjects: { ...state.agentResultProjects, [key]: projectId } })),
                saveAgentDraft: (key, draft) => set((state) => ({ agentDrafts: { ...state.agentDrafts, [key]: draft } })),
                setMode: (mode) => set((state) => ({ mode, [mode]: { ...state[mode], initialized: true, prompt: state[mode].initialized ? state[mode].prompt : state[state.mode].prompt } })),
                patch: (mode, patch, scope) => set((state) => {
                    const draft = scope ? state.scoped[scope] || empty() : state[mode];
                    const next = { ...draft, ...patch, initialized: draft.initialized || typeof patch.prompt === "string" };
                    return scope ? { scoped: { ...state.scoped, [scope]: next } } : { [mode]: next };
                }),
                setReferences: (mode, next, scope) => {
                    const state = useComposerStore.getState();
                    const draft = scope ? state.scoped[scope] || empty() : state[mode];
                    state.patch(mode, { references: uniqueReferences(typeof next === "function" ? next(draft.references) : next) }, scope);
                },
            };
        },
        {
            name: storageKey("composer_drafts"),
            storage: createJSONStorage(() => ({
                getItem: async (key) => {
                    const raw = await draftStorage.getItem<string>(key);
                    if (!raw) return null;
                    const saved = JSON.parse(raw);
                    if (!saved.state?.image || !saved.state?.video || !saved.state?.scoped || !saved.state?.agentDrafts) throw new Error("创作草稿格式损坏，原数据未覆盖");
                    for (const draft of [saved.state.image, saved.state.video, ...Object.values(saved.state.scoped), ...Object.values(saved.state.conversations || {}).flatMap((record) => (record as CreationConversation).draft ? [(record as CreationConversation).draft] : [])] as Draft[]) {
                        draft.references = await Promise.all(draft.references.map(async (ref) => ref.storageKey ? { ...ref, dataUrl: await resolveImageUrl(ref.storageKey, ref.dataUrl) } : ref));
                    }
                    return JSON.stringify(saved);
                },
                setItem: (_key, value) => {
                    if (writeOwnership.canWrite()) { draftQueue.enqueue(value); void draftQueue.flush().catch(() => {}); }
                },
                removeItem: (key) => draftStorage.removeItem(key),
            })),
            partialize: ({ mode, image, video, scoped, agentDrafts, agentResultProjects, conversations, activeConversations, canvasContexts }) => JSON.parse(JSON.stringify({ mode, image, video, scoped, agentDrafts, agentResultProjects, conversations, activeConversations, canvasContexts }, (_key, value) => value && typeof value === "object" && value.storageKey ? { ...value, ...(typeof value.dataUrl === "string" ? { dataUrl: "" } : {}), ...(typeof value.url === "string" ? { url: "" } : {}) } : value)),
            onRehydrateStorage: () => (_state, error) => {
                draftError = error;
                useComposerStore.setState({ hydrated: !error });
            },
        },
    ),
);

/** 仅移走已受理的同一份草稿，迟到回执不覆盖下一轮输入。 */
export function consumeComposerDraft(mode: ComposerMode, submitted: Pick<ComposerDraft, "prompt" | "references">, scope?: string) {
    const state = useComposerStore.getState();
    const current = scope ? state.scoped[scope] : state[mode];
    if (!current || current !== submitted) return;
    state.patch(mode, { prompt: "", references: [], nodeIds: [], initialized: true }, scope);
}
