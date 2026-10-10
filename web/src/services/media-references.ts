import localforage from "localforage";
import { STORAGE_NS, storageKey } from "@/constant/brand";
import { canvasIndexedStorage } from "@/lib/localforage-storage";
import { readMediaReferences } from "@/lib/media-references";
import { collectMediaStorageKeys, collectStoredReferenceValue } from "@/lib/media-references";
import { CONFLICT_STORE, MEDIA_PIN_PREFIX, openStorageDatabase } from "@/lib/atomic-storage";

const histories = new Map(["image_generation_logs", "video_generation_logs"].map((name) => [name, localforage.createInstance({ name: STORAGE_NS, storeName: name })]));
const sessionFiles = new Set<string>();
export const protectSessionMedia = async (key: string) => {
    sessionFiles.add(key);
    // Persist before writing the file; failed business saves must not make it collectible in another tab.
    await canvasIndexedStorage.setItem(MEDIA_PIN_PREFIX + key, { storageKey: key });
};
export const isSessionMedia = (key: string) => sessionFiles.has(key);

let releasePage: (() => void) | undefined;
let registration: Promise<void> | undefined;
export function registerMediaPage() {
    if (!navigator.locks) return Promise.resolve();
    if (registration) return registration;
    registration = new Promise<void>((resolve, reject) => {
        void navigator.locks.request("dianran:media-page", { mode: "shared" }, async () => {
            await new Promise<void>((release) => { releasePage = release; resolve(); });
        }).catch(reject);
    });
    return registration;
}

// Automatic collection cannot know another page's unsaved references. Keep its files until that page closes.
export async function cleanupStoredMedia(fileStore: "image_files" | "media_files", usedData: unknown) {
    if (!navigator.locks) return;
    await registerMediaPage();
    releasePage?.();
    releasePage = undefined;
    registration = undefined;
    try {
        await navigator.locks.request("dianran:media-page", { ifAvailable: true }, async (lock) => {
            if (!lock) return;
            const db = await openStorageDatabase(STORAGE_NS);
            try {
                await new Promise<void>((resolve, reject) => {
                    const metadata = ["app_state", "image_generation_logs", "video_generation_logs", "agent_media_tasks", "plugin_action_tasks", "creation_tasks", CONFLICT_STORE].filter((name) => db.objectStoreNames.contains(name));
                    const files = [fileStore, ...(fileStore === "image_files" && db.objectStoreNames.contains("image_previews") ? ["image_previews"] : [])];
                    const transaction = db.transaction([...metadata, ...files], "readwrite");
                    const used = collectMediaStorageKeys(usedData);
                    sessionFiles.forEach((key) => used.add(key));
                    const candidates = new Map<string, IDBValidKey[]>();
                    let remaining = metadata.length + files.length;
                    let error: unknown;
                    const done = () => {
                        if (--remaining) return;
                        for (const [name, keys] of candidates) for (const key of keys) if (typeof key === "string" && !used.has(key)) transaction.objectStore(name).delete(key);
                    };
                    for (const name of metadata) {
                        const request = transaction.objectStore(name).openCursor();
                        request.onsuccess = () => {
                            try {
                                const cursor = request.result;
                                if (!cursor) { done(); return; }
                                collectStoredReferenceValue(name, String(cursor.key), cursor.value, used);
                                cursor.continue();
                            } catch (reason) { error = reason; transaction.abort(); }
                        };
                    }
                    for (const name of files) {
                        const request = transaction.objectStore(name).getAllKeys();
                        request.onsuccess = () => { candidates.set(name, request.result); done(); };
                    }
                    transaction.oncomplete = () => resolve();
                    transaction.onabort = () => reject(error || transaction.error || new Error("引用核对失败，文件未清理"));
                });
            } finally { db.close(); }
        });
    } finally { await registerMediaPage(); }
}

export async function collectStoredMediaReferences(usedData: unknown) {
    const { useComposerStore } = await import("@/stores/use-composer-store");
    return readMediaReferences(
        { usedData, drafts: useComposerStore.getState() },
        (name) => canvasIndexedStorage.getItem(storageKey(name)),
        async (name) => {
            const values: unknown[] = [];
            await histories.get(name)!.iterate((value) => { values.push(value); });
            return values;
        },
    );
}
