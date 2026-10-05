import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import localforage from "localforage";
import { STORAGE_NS, storageKey } from "@/constant/brand";
import { resolveImageUrl } from "@/services/image-storage";
import { uniqueReferences, type ComposerMode, type ComposerParameters } from "@/lib/composer";
import type { ReferenceImage } from "@/types/image";

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
    saveAgentDraft: (key: string, draft: ComposerStore["agentDrafts"][string]) => void;
    setMode: (mode: ComposerMode) => void;
    patch: (mode: ComposerMode, patch: Partial<Draft>, scope?: string) => void;
    setReferences: (mode: ComposerMode, next: ReferenceImage[] | ((refs: ReferenceImage[]) => ReferenceImage[]), scope?: string) => void;
};
const draftStorage = localforage.createInstance({ name: STORAGE_NS, storeName: "app_state" });
const empty = (): Draft => ({ initialized: false, prompt: "", references: [], canvas: false });
export const useComposerStore = create<ComposerStore>()(
    persist(
        (set) => ({
            hydrated: false,
            mode: "image",
            image: empty(),
            video: empty(),
            scoped: {},
            agentDrafts: {},
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
        }),
        {
            name: storageKey("composer_drafts"),
            storage: createJSONStorage(() => ({
                getItem: (key) => draftStorage.getItem<string>(key),
                setItem: async (key, value) => {
                    await draftStorage.setItem(key, value);
                },
                removeItem: async (key) => {
                    await draftStorage.removeItem(key);
                },
            })),
            partialize: ({ mode, image, video, scoped, agentDrafts }) => ({ mode, image, video, scoped, agentDrafts }),
            onRehydrateStorage: () => (state) => {
                void (async () => {
                    if (state)
                        for (const mode of ["image", "video"] as const) {
                            const references = await Promise.all(state[mode].references.map(async (ref) => (ref.storageKey ? { ...ref, dataUrl: await resolveImageUrl(ref.storageKey, ref.dataUrl) } : ref)));
                            useComposerStore.getState().setReferences(mode, references);
                        }
                    if (state) for (const [scope, draft] of Object.entries(state.scoped)) {
                        const references = await Promise.all(draft.references.map(async (ref) => ref.storageKey ? { ...ref, dataUrl: await resolveImageUrl(ref.storageKey, ref.dataUrl) } : ref));
                        useComposerStore.getState().setReferences("image", references, scope);
                    }
                    useComposerStore.setState({ hydrated: true });
                })();
            },
        },
    ),
);
