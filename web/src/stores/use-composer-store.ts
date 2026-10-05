import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import localforage from "localforage";
import { STORAGE_NS, storageKey } from "@/constant/brand";
import { resolveImageUrl } from "@/services/image-storage";
import { uniqueReferences, type ComposerMode } from "@/lib/composer";
import type { ReferenceImage } from "@/types/image";

type Draft = { initialized: boolean; prompt: string; references: ReferenceImage[]; canvas: boolean };
type ComposerStore = {
    hydrated: boolean;
    mode: ComposerMode;
    image: Draft;
    video: Draft;
    setMode: (mode: ComposerMode) => void;
    patch: (mode: ComposerMode, patch: Partial<Draft>) => void;
    setReferences: (mode: ComposerMode, next: ReferenceImage[] | ((refs: ReferenceImage[]) => ReferenceImage[])) => void;
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
            setMode: (mode) => set((state) => ({ mode, [mode]: { ...state[mode], initialized: true, prompt: state[mode].initialized ? state[mode].prompt : state[state.mode].prompt } })),
            patch: (mode, patch) => set((state) => ({ [mode]: { ...state[mode], ...patch, initialized: state[mode].initialized || typeof patch.prompt === "string" } })),
            setReferences: (mode, next) => set((state) => ({ [mode]: { ...state[mode], references: uniqueReferences(typeof next === "function" ? next(state[mode].references) : next) } })),
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
            partialize: ({ mode, image, video }) => ({ mode, image, video }),
            onRehydrateStorage: () => (state) => {
                void (async () => {
                    if (state)
                        for (const mode of ["image", "video"] as const) {
                            const references = await Promise.all(state[mode].references.map(async (ref) => (ref.storageKey ? { ...ref, dataUrl: await resolveImageUrl(ref.storageKey, ref.dataUrl) } : ref)));
                            useComposerStore.getState().setReferences(mode, references);
                        }
                    useComposerStore.setState({ hydrated: true });
                })();
            },
        },
    ),
);
