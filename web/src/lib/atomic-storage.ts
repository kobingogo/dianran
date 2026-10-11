import { clearStorageConflict, mergeStoredSnapshot, reportStorageConflict, StorageConflictError, type StorageConflict } from "./storage-conflicts";
import { comparable } from "../services/app-sync-merge";

export const CONFLICT_STORE = "write_conflicts";
const pageId = crypto.randomUUID();
export const storageConflictId = (database: string, store: string, key: string) => `${database}:${store}:${key}:${pageId}`;
export const MEDIA_PIN_PREFIX = "pending-media:";
export const guardedStores = new Set(["app_state", "creation_tasks", "agent_media_tasks", "plugin_action_tasks", "image_generation_logs", "video_generation_logs"]);
const businessKeys = new Set(["canvas_store", "asset_store", "composer_drafts", "workflow_templates", "plugin_store", "creation_presets", "creation_estimates"]);
export const isSharedBusinessKey = (store: string, key: string) => guardedStores.has(store) && (store !== "app_state" || businessKeys.has(key.slice(key.lastIndexOf(":") + 1)));
export const storageBaselines = new Map<string, Map<string, unknown>>();

export function openStorageDatabase(name: string): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(name);
        request.onsuccess = () => { request.result.onversionchange = () => request.result.close(); resolve(request.result); };
        request.onerror = () => reject(request.error);
    });
}

/** The comparison, conflict backup and write share one IDB transaction across tabs. */
export async function atomicStorageWrite(database: string, store: string, key: string, base: unknown, local: unknown, remove = false) {
    const db = await openStorageDatabase(database);
    return new Promise<unknown>((resolve, reject) => {
        const names = [...new Set([store, CONFLICT_STORE, "app_state"])].filter((name) => db.objectStoreNames.contains(name));
        const transaction = db.transaction(names, "readwrite");
        const target = transaction.objectStore(store);
        const read = target.get(key);
        let conflict: StorageConflict | undefined;
        let result: unknown;
        let error: unknown;
        const id = storageConflictId(database, store, key);
        read.onsuccess = () => {
            try {
                const remote = read.result;
                result = mergeStoredSnapshot(base, remove ? undefined : local, remote);
                if (result === undefined) target.delete(key); else target.put(result, key);
                transaction.objectStore(CONFLICT_STORE).delete(id);
                // A saved business record now protects these files; release their pending-write pins atomically.
                const release = (value: unknown) => {
                    if (!value || typeof value !== "object") return;
                    if ("storageKey" in value && typeof value.storageKey === "string") transaction.objectStore("app_state").delete(MEDIA_PIN_PREFIX + value.storageKey);
                    Object.values(value).forEach(release);
                };
                release(typeof result === "string" && /^[\[{]/.test(result) ? JSON.parse(result) : result);
            } catch (reason) {
                error = reason;
                if (reason instanceof StorageConflictError) {
                    conflict = { id, database, store, key, base, local: remove ? undefined : local, remote: read.result, message: reason.message };
                    transaction.objectStore(CONFLICT_STORE).put(conflict, id);
                } else transaction.abort();
            }
        };
        transaction.oncomplete = () => {
            db.close();
            if (conflict) { reportStorageConflict(conflict); reject(error); }
            else { clearStorageConflict(id); resolve(result); }
        };
        transaction.onabort = () => { db.close(); reject(error || transaction.error || new Error("本地保存事务失败，原数据未覆盖")); };
    });
}

/** Keep the remote records and create independent copies of this page's changed canvases/assets. */
export async function preserveConflictCopies(conflict: StorageConflict) {
    const field = conflict.key.endsWith(":canvas_store") ? "projects" : conflict.key.endsWith(":asset_store") ? "assets" : "";
    if (!field) throw new Error("此记录请先下载冲突备份，再读取最新数据");
    const local = JSON.parse(String(conflict.local));
    const base = conflict.base ? JSON.parse(String(conflict.base)) : { state: { [field]: [] } };
    const previous = new Map<string, unknown>(base.state[field].map((item: { id: string }) => [item.id, item]));
    const copies = local.state[field].filter((item: { id: string }) => comparable(item) !== comparable(previous.get(item.id))).map((item: Record<string, unknown>) => {
        const copy = structuredClone(item);
        copy.id = crypto.randomUUID();
        copy.title = `${item.title || "未命名"}（冲突副本）`;
        copy.updatedAt = new Date().toISOString();
        if (field === "projects") for (const node of copy.nodes as { metadata?: Record<string, unknown> }[]) {
            if (!node.metadata) continue;
            delete node.metadata.generationTaskId;
            delete node.metadata.agentMediaRequestId;
            delete node.metadata.videoTaskId;
            delete node.metadata.videoTaskEndpoint;
            delete node.metadata.videoTaskProvider;
            if (node.metadata.status === "loading") delete node.metadata.status;
            for (const field of ["images", "texts"]) if (Array.isArray(node.metadata[field])) node.metadata[field] = (node.metadata[field] as { status?: string }[]).filter((item) => item.status !== "loading");
        }
        return copy;
    });
    const db = await openStorageDatabase(conflict.database);
    await new Promise<void>((resolve, reject) => {
        const transaction = db.transaction([conflict.store, CONFLICT_STORE], "readwrite");
        const target = transaction.objectStore(conflict.store);
        const read = target.get(conflict.key);
        let error: unknown;
        read.onsuccess = () => {
            try {
                const latest = read.result ? JSON.parse(read.result) : { ...local, state: { ...local.state, [field]: [], ...(field === "projects" ? { deletedProjects: [] } : {}) } };
                latest.state[field] = [...copies, ...latest.state[field]];
                target.put(JSON.stringify(latest), conflict.key);
                // Retain the conflict backup, including deleted records, for recovery.
            } catch (reason) { error = reason; transaction.abort(); }
        };
        transaction.oncomplete = () => { db.close(); resolve(); };
        transaction.onabort = () => { db.close(); reject(error || transaction.error); };
    });
}
