import { assertBusinessWriter, writeOwnership } from "@/lib/write-ownership";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { localForageStorage } from "@/lib/localforage-storage";
import { storageKey } from "@/constant/brand";

export type InstalledPlugin = {
    id: string;
    name: string;
    version: string;
    description?: string;
    url: string; // Installation source used for updates.
    source: string; // Cached plugin source for offline use and pinned versions.
    sourceDigest?: string; // SHA-256 of the exact user-approved source snapshot.
    enabled: boolean;
    local?: boolean; // Local plugin discovered in web/public/plugins; disabled by default and refetched from its URL when enabled.
    official?: boolean; // Installed from the official registry and grouped accordingly in the manager.
    installedAt: string;
};

type PluginStore = {
    plugins: InstalledPlugin[];
    upsert: (plugin: Omit<InstalledPlugin, "installedAt"> & { installedAt?: string }) => void;
    setEnabled: (id: string, enabled: boolean) => void;
    remove: (id: string) => void;
};

export const usePluginStore = create<PluginStore>()(
    persist(
        (set) => {
            const commit = set;
            set = ((...args: Parameters<typeof set>) => { assertBusinessWriter(); (commit as (...values: Parameters<typeof set>) => void)(...args); }) as typeof set;
            return {
                plugins: [],
                upsert: (plugin) =>
                    set((state) => {
                        const installedAt = plugin.installedAt || new Date().toISOString();
                        const exists = state.plugins.some((item) => item.id === plugin.id);
                        const next = { ...plugin, installedAt };
                        return { plugins: exists ? state.plugins.map((item) => (item.id === plugin.id ? next : item)) : [next, ...state.plugins] };
                    }),
                setEnabled: (id, enabled) => set((state) => ({ plugins: state.plugins.map((item) => (item.id === id ? { ...item, enabled } : item)) })),
                remove: (id) => set((state) => ({ plugins: state.plugins.filter((item) => item.id !== id) })),
            };
        },
        {
            name: storageKey("plugin_store"),
            storage: createJSONStorage(() => localForageStorage),
        },
    ),
);
