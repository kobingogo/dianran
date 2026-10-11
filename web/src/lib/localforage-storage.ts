import { writeOwnership } from "./write-ownership";
import localforage from "localforage";
import type { StateStorage } from "zustand/middleware";
import { STORAGE_NS } from "@/constant/brand";
import { StorageConflictError } from "./storage-conflicts";
import { isSharedBusinessKey } from "./atomic-storage";

localforage.config({
    name: STORAGE_NS,
    storeName: "app_state",
});

const appStorage = localforage.createInstance({ name: STORAGE_NS, storeName: "app_state" });

export const localForageStorage: StateStorage = {
    getItem: async (name) => {
        if (typeof window === "undefined") return null;
        try {
            return (await appStorage.getItem<string>(name)) || null;
        } catch {
            return window.localStorage.getItem(name);
        }
    },
    setItem: async (name, value) => {
        if (typeof window === "undefined" || !writeOwnership.canWrite()) return;
        try {
            await appStorage.setItem(name, value);
        } catch (error) {
            if (error instanceof StorageConflictError || isSharedBusinessKey("app_state", name)) throw error;
            window.localStorage.setItem(name, value);
        }
    },
    removeItem: async (name) => {
        if (typeof window === "undefined" || !writeOwnership.canWrite()) return;
        try {
            await appStorage.removeItem(name);
        } catch (error) {
            if (error instanceof StorageConflictError || isSharedBusinessKey("app_state", name)) throw error;
            window.localStorage.removeItem(name);
        }
    },
};

// Canvas business data must never silently fall back to localStorage.
export const canvasIndexedStorage = localforage.createInstance({ name: STORAGE_NS, storeName: "app_state", driver: localforage.INDEXEDDB });
