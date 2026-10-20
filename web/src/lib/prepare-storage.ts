import localforage from "localforage";
import { STORAGE_NS } from "@/constant/brand";
import { CONFLICT_STORE } from "./atomic-storage";

export const storageStores = ["app_state", "creation_tasks", "image_generation_logs", "video_generation_logs", "agent_media_tasks", "plugin_action_tasks", CONFLICT_STORE, "image_files", "image_previews", "media_files", "webdav_sync_backups", "prompt_pipeline", "prompt_cache", "local_diagnostics"];

// Complete schema upgrades before concurrent reads/writes can reopen closed connections.
export async function prepareStorage() {
    for (const storeName of storageStores) await localforage.createInstance({ name: STORAGE_NS, storeName, driver: localforage.INDEXEDDB }).ready();
}
