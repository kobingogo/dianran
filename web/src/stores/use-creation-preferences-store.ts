import { create } from "zustand";
import { nanoid } from "nanoid";
import { canvasIndexedStorage } from "@/lib/localforage-storage";
import { storageKey } from "@/constant/brand";
import { presetParameters, type CreationPreset } from "@/lib/creation-preferences";
import type { ComposerMode } from "@/lib/composer";
import type { AiConfig } from "./use-config-store";
const key = storageKey("creation_presets");
let writes = Promise.resolve();
export const useCreationPreferencesStore = create<{
    presets: CreationPreset[];
    load: () => Promise<void>;
    save: (title: string, mode: ComposerMode, config: AiConfig) => Promise<void>;
    remove: (id: string) => Promise<void>;
}>((set) => {
    const mutate = (change: (items: CreationPreset[]) => CreationPreset[]) => {
        const next = writes.then(async () => {
            const stored = (await canvasIndexedStorage.getItem<CreationPreset[]>(key)) || [];
            if (!Array.isArray(stored)) throw new Error("预设数据损坏，原数据未覆盖");
            const presets = change(stored);
            await canvasIndexedStorage.setItem(key, presets);
            set({ presets });
        });
        writes = next.catch(() => {});
        return next;
    };
    return {
        presets: [],
        load: async () => {
            await writes;
            const presets = (await canvasIndexedStorage.getItem<CreationPreset[]>(key)) || [];
            if (!Array.isArray(presets)) throw new Error("预设数据损坏");
            set({ presets });
        },
        save: (title, mode, config) => mutate((items) => [...items, { id: nanoid(), title: title.trim() || "创作预设", mode, parameters: presetParameters(config, mode) }]),
        remove: (id) => mutate((items) => items.filter((item) => item.id !== id)),
    };
});
