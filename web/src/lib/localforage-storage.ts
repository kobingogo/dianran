import localforage from "localforage";
import type { StateStorage } from "zustand/middleware";
import { STORAGE_NS } from "@/constant/brand";

localforage.config({
    name: STORAGE_NS,
    storeName: "app_state",
});

export const localForageStorage: StateStorage = {
    getItem: async (name) => {
        if (typeof window === "undefined") return null;
        try {
            return (await localforage.getItem<string>(name)) || null;
        } catch {
            return window.localStorage.getItem(name);
        }
    },
    setItem: async (name, value) => {
        if (typeof window === "undefined") return;
        try {
            await localforage.setItem(name, value);
        } catch {
            window.localStorage.setItem(name, value);
        }
    },
    removeItem: async (name) => {
        if (typeof window === "undefined") return;
        try {
            await localforage.removeItem(name);
        } catch {
            window.localStorage.removeItem(name);
        }
    },
};

// Canvas business data must never silently fall back to localStorage.
export const canvasIndexedStorage = localforage.createInstance({ name: STORAGE_NS, storeName: "app_state", driver: localforage.INDEXEDDB });
