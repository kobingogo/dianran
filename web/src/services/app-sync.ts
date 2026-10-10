import { businessOperation, writeOwnership } from "@/lib/write-ownership";
import localforage from "localforage";

import i18n from "@/i18n";
import { mergeCanvasSnapshots, mergeRecords } from "./app-sync-merge";
import { assertStorageSaved } from "@/lib/install-write-barrier";
import { flushComposerSave } from "@/stores/use-composer-store";
import { getMediaBlob, resolveMediaUrl, setMediaBlob } from "@/services/file-storage";
import { getImageBlob, resolveImageUrl, setImageBlob } from "@/services/image-storage";
import { downloadWebdavFile, readWebdavRevision, verifyWebdavConditionalWrites, WebdavRevisionConflict, uploadWebdavFile, WEBDAV_MANIFEST_FILE_NAME } from "@/services/webdav-sync";
import type { Asset } from "@/stores/use-asset-store";
import { flushAssetSave, useAssetStore } from "@/stores/use-asset-store";
import type { WebdavSyncConfig } from "@/stores/use-config-store";
import type { CanvasDeletedProject, CanvasProject } from "@/stores/canvas/use-canvas-store";
import { useCanvasStore, flushCanvasSave } from "@/stores/canvas/use-canvas-store";
import { EXPORT_APP_ID, STORAGE_NS, isAcceptedAppId, type AppFileId } from "@/constant/brand";

type StoredLog = Record<string, unknown> & { id?: string };
export type AppSyncDomainKey = "canvas" | "assets" | "image-workbench" | "video-workbench";
type DomainKey = AppSyncDomainKey;
type CanvasDomainData = { projects: CanvasProject[]; deleted: CanvasDeletedProject[] };
type AssetDomainData = { assets: Asset[] };
type LogDomainData = { logs: StoredLog[] };

type AppSyncFile = {
    storageKey: string;
    path: string;
    mimeType: string;
    bytes: number;
};

type DomainManifest<T> = {
    app: AppFileId;
    version: 1;
    domain: DomainKey;
    exportedAt: string;
    data: T;
    files: AppSyncFile[];
};

type SyncDomainOptions<T> = {
    key: DomainKey;
    label: string;
    localData: () => Promise<T>;
    emptyData: T;
    mergeData: (local: T, remote: T, conflict: (label: string) => void) => T;
    applyData?: (data: T) => Promise<void>;
};

type SyncDomainResult<T> = {
    data: T;
    mergedRemote: boolean;
    files: number;
    manifestBytes: number;
    uploadedFiles: number;
    uploadedBytes: number;
};

export type AppSyncResult = {
    backupId: string;
    completed: AppSyncDomainKey[];
    failed: { domain: AppSyncDomainKey; error: string }[];
    conflicts: string[];
    syncedAt: string;
    mergedRemote: boolean;
    projects: number;
    assets: number;
    imageLogs: number;
    videoLogs: number;
    files: number;
    manifestBytes: number;
    uploadedFiles: number;
    uploadedBytes: number;
};

export type AppSyncProgressEvent = {
    domain?: AppSyncDomainKey;
    label?: string;
    stage: string;
    current?: number;
    total?: number;
    status?: "active" | "success" | "exception";
};

export type AppSyncProgress = (event: AppSyncProgressEvent) => void;

const backupStore = localforage.createInstance({ name: STORAGE_NS, storeName: "webdav_sync_backups" });
let syncing = false;
const FILE_CONCURRENCY = 3;
const imageLogStore = localforage.createInstance({ name: STORAGE_NS, storeName: "image_generation_logs" });
const videoLogStore = localforage.createInstance({ name: STORAGE_NS, storeName: "video_generation_logs" });
type LogStore = typeof imageLogStore;
const storageKeyPattern = /^(image|video|audio|file|video-reference|audio-reference):/;

async function syncAppDataToWebdavOwned(config: WebdavSyncConfig, onProgress?: AppSyncProgress): Promise<AppSyncResult> {
    emitProgress(onProgress, { stage: "等待本地数据加载" });
    if (!useAssetStore.getState().hydrated) await useAssetStore.persist.rehydrate();
    await waitForHydration(useCanvasStore);
    writeOwnership.checkpoint();
    await Promise.all([flushAssetSave(), flushCanvasSave(), flushComposerSave()]);
    assertStorageSaved();
    const backupId = await createSyncBackup();
    await verifyWebdavConditionalWrites(config);
    const conflicts: string[] = [];

    const outcomes = await Promise.allSettled([
        syncDomain<CanvasDomainData>(config, onProgress, {
            key: "canvas",
            label: "画布",
            emptyData: { projects: [], deleted: [] },
            localData: async () => {
                const { projects, deletedProjects } = useCanvasStore.getState();
                return { projects, deleted: deletedProjects };
            },
            mergeData: mergeCanvasSnapshots,
            applyData: async (data) => useCanvasStore.getState().replaceProjects(data.projects, data.deleted),
        }, conflicts),
        syncDomain<AssetDomainData>(config, onProgress, {
            key: "assets",
            label: "我的资产",
            emptyData: { assets: [] },
            localData: async () => ({ assets: useAssetStore.getState().assets }),
            mergeData: (local, remote, conflict) => ({ assets: mergeRecords(local.assets, remote.assets, conflict) }),
            applyData: async (data) => useAssetStore.getState().replaceAssets(await Promise.all(data.assets.map(hydrateAsset))),
        }, conflicts),
        syncDomain<LogDomainData>(config, onProgress, {
            key: "image-workbench",
            label: "生图工作台",
            emptyData: { logs: [] },
            localData: async () => ({ logs: await readStoredLogs(imageLogStore) }),
            mergeData: (local, remote, conflict) => ({ logs: mergeRecords(local.logs, remote.logs, conflict) }),
            applyData: async (data) => replaceStoredLogs(imageLogStore, data.logs),
        }, conflicts),
        syncDomain<LogDomainData>(config, onProgress, {
            key: "video-workbench",
            label: "视频创作台",
            emptyData: { logs: [] },
            localData: async () => ({ logs: await readStoredLogs(videoLogStore) }),
            mergeData: (local, remote, conflict) => ({ logs: mergeRecords(local.logs, remote.logs, conflict) }),
            applyData: async (data) => replaceStoredLogs(videoLogStore, data.logs),
        }, conflicts),
    ]);

    const keys: AppSyncDomainKey[] = ["canvas", "assets", "image-workbench", "video-workbench"];
    const completed = keys.filter((_, index) => outcomes[index].status === "fulfilled");
    const failed = outcomes.flatMap((outcome, index) => outcome.status === "rejected" ? [{ domain: keys[index], error: String(outcome.reason instanceof Error ? outcome.reason.message : outcome.reason) }] : []);
    const successful = outcomes.flatMap((outcome) => outcome.status === "fulfilled" ? [outcome.value] : []);
    const count = (index: number, field: string) => {
        const outcome = outcomes[index];
        return outcome.status === "fulfilled" ? ((outcome.value.data as Record<string, unknown[]>)[field]?.length || 0) : 0;
    };
    const sum = (field: "files" | "manifestBytes" | "uploadedFiles" | "uploadedBytes") => successful.reduce((total, item) => total + item[field], 0);
    const result: AppSyncResult = {
        backupId, completed, failed, conflicts,
        syncedAt: new Date().toISOString(), mergedRemote: successful.some((item) => item.mergedRemote),
        projects: count(0, "projects"), assets: count(1, "assets"), imageLogs: count(2, "logs"), videoLogs: count(3, "logs"),
        files: sum("files"), manifestBytes: sum("manifestBytes"), uploadedFiles: sum("uploadedFiles"), uploadedBytes: sum("uploadedBytes"),
    };
    emitProgress(onProgress, { stage: failed.length ? `已完成：${completed.map(domainLabel).join("、") || "无"}；未完成：${failed.map((item) => domainLabel(item.domain)).join("、")}` : "同步完成", status: failed.length ? "exception" : "success" });
    return result;
}

async function syncDomain<T>(config: WebdavSyncConfig, onProgress: AppSyncProgress | undefined, options: SyncDomainOptions<T>, conflicts: string[]): Promise<SyncDomainResult<T>> {
    try {
        emitProgress(onProgress, { domain: options.key, label: options.label, stage: "读取远端清单", status: "active" });
        const revision = await readDomainManifest(config, options.key, options.emptyData);
        const remoteManifest = revision?.manifest;
        if (revision && (!revision.etag || revision.etag.startsWith("W/"))) throw new Error("远端未返回可用的强 ETag；已阻止无保护覆盖，请检查服务及 CORS 暴露 ETag 设置");
        emitProgress(onProgress, { domain: options.key, label: options.label, stage: "读取本地数据", status: "active" });
        const localData = await options.localData();
        if (remoteManifest) await preserveRemoteMedia(config, remoteManifest);
        const mergedData = remoteManifest ? options.mergeData(localData, remoteManifest.data, (label) => conflicts.push(`${options.label}：${label}`)) : localData;

        if (remoteManifest) {
            emitProgress(onProgress, { domain: options.key, label: options.label, stage: "下载缺失媒体", status: "active" });
            await downloadMissingFiles(config, options.key, mergedData, remoteManifest.files, onProgress);
        }

        emitProgress(onProgress, { domain: options.key, label: options.label, stage: "上传新增媒体", status: "active" });
        const uploaded = await uploadChangedFiles(config, options.key, mergedData, remoteManifest?.files || [], onProgress);
        const manifest: DomainManifest<T> = { app: EXPORT_APP_ID, version: 1, domain: options.key, exportedAt: new Date().toISOString(), data: mergedData, files: uploaded.files };
        const manifestFile = new Blob([JSON.stringify(manifest, null, 2)], { type: "application/json" });
        emitProgress(onProgress, { domain: options.key, label: options.label, stage: `上传清单 ${formatBytes(manifestFile.size)}`, status: "active" });
        try {
            await uploadWebdavFile(config, domainPath(options.key, WEBDAV_MANIFEST_FILE_NAME), manifestFile, "application/json", { etag: revision?.etag || null });
        } catch (error) {
            if (error instanceof WebdavRevisionConflict) {
                const latest = await readDomainManifest(config, options.key, options.emptyData);
                const latestData = latest?.manifest.data;
                throw new Error(`${error.message}；已重新读取远端，当前差异：${describeDifference(localData, latestData)}。本地数据及同步前备份保留`);
            }
            throw error;
        }
        if (JSON.stringify(localData) !== JSON.stringify(await options.localData())) throw new Error("远端已写入此次快照；同步期间本地又有修改，已保留最新本地内容，请再次同步；未覆盖当前编辑");
        if (remoteManifest) {
            emitProgress(onProgress, { domain: options.key, label: options.label, stage: "清单已写入远端；保存本地合并结果", status: "active" });
            try {
                await options.applyData?.(mergedData);
                await Promise.all([flushCanvasSave(), flushAssetSave()]);
                assertStorageSaved();
            } catch (error) { throw new Error(`远端清单已写入，本地合并结果未可靠保存；请重试本地保存或恢复备份：${String(error)}`); }
        }
        emitProgress(onProgress, { domain: options.key, label: options.label, stage: "完成", current: 1, total: 1, status: "success" });

        return {
            data: mergedData,
            mergedRemote: Boolean(remoteManifest),
            files: uploaded.files.length,
            manifestBytes: manifestFile.size,
            uploadedFiles: uploaded.uploadedFiles,
            uploadedBytes: uploaded.uploadedBytes,
        };
    } catch (error) {
        emitProgress(onProgress, { domain: options.key, label: options.label, stage: error instanceof Error ? error.message : i18n.t("config.webdav.errors.syncFailed"), status: "exception" });
        throw error;
    }
}

async function readDomainManifest<T>(config: WebdavSyncConfig, domain: DomainKey, emptyData: T) {
    const revision = await readWebdavRevision(config, domainPath(domain, WEBDAV_MANIFEST_FILE_NAME));
    if (!revision) return null;
    const data = JSON.parse(await revision.file.text()) as DomainManifest<T>;
    if (!isAcceptedAppId(data.app) || data.domain !== domain) throw new Error(i18n.t("config.webdav.errors.invalidManifest", { domain }));
    if (data.version !== 1 || !data.data || typeof data.data !== "object" || !Array.isArray(data.files)) throw new Error("远端清单损坏，已停止同步");
    const payload = data.data as unknown as Partial<CanvasDomainData & AssetDomainData & LogDomainData>;
    const records = domain === "canvas" ? payload.projects : domain === "assets" ? payload.assets : payload.logs;
    if (!Array.isArray(records) || records.some((item) => !item || typeof item.id !== "string") || (domain === "canvas" && !Array.isArray(payload.deleted))) throw new Error("远端记录格式损坏，已停止同步");
    if (data.files.some((item) => !item || typeof item.path !== "string" || !item.path.startsWith(`${domain}/files/`) || item.path.split("/").some((part) => part === ".." || part === ".") || typeof item.storageKey !== "string")) throw new Error("远端媒体路径损坏，已停止同步");
    return { etag: revision.etag, manifest: {
        app: EXPORT_APP_ID,
        version: 1 as const,
        domain,
        exportedAt: data.exportedAt || new Date().toISOString(),
        data: data.data || emptyData,
        files: data.files,
    } };
}

async function preserveRemoteMedia<T>(config: WebdavSyncConfig, manifest: DomainManifest<T>) {
    const replacements = new Map<string, string>();
    for (const file of manifest.files) {
        const local = file.storageKey.startsWith("image:") ? await getImageBlob(file.storageKey) : await getMediaBlob(file.storageKey);
        if (!local) continue;
        const remote = await downloadWebdavFile(config, file.path);
        if (!remote) throw new Error(`远端媒体缺失：${file.storageKey}`);
        if (await blobDigest(local) === await blobDigest(remote)) continue;
        const original = file.storageKey;
        const key = `${original.split(":")[0]}:${crypto.randomUUID()}`;
        await (key.startsWith("image:") ? setImageBlob(key, remote) : setMediaBlob(key, remote));
        replacements.set(original, key);
        file.storageKey = key;
    }
    const rewrite = (value: unknown): unknown => typeof value === "string" ? replacements.get(value) || value : Array.isArray(value) ? value.map(rewrite) : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).map(([key, child]) => [key, rewrite(child)])) : value;
    if (replacements.size) manifest.data = rewrite(manifest.data) as T;
}

async function downloadMissingFiles<T>(config: WebdavSyncConfig, domain: DomainKey, data: T, remoteFiles: AppSyncFile[], onProgress?: AppSyncProgress) {
    const remoteFileMap = new Map(remoteFiles.map((item) => [item.storageKey, item]));
    const tasks: AppSyncFile[] = [];
    const storageKeys = collectStorageKeys(data);
    let scanned = 0;
    for (const storageKey of storageKeys) {
        const localBlob = storageKey.startsWith("image:") ? await getImageBlob(storageKey) : await getMediaBlob(storageKey);
        scanned += 1;
        if (localBlob) {
            emitProgress(onProgress, { domain, label: domainLabel(domain), stage: "检查缺失媒体", current: scanned, total: storageKeys.length, status: "active" });
            continue;
        }
        const remoteFile = remoteFileMap.get(storageKey);
        if (remoteFile) tasks.push(remoteFile);
        emitProgress(onProgress, { domain, label: domainLabel(domain), stage: "检查缺失媒体", current: scanned, total: storageKeys.length, status: "active" });
    }
    if (!tasks.length) {
        emitProgress(onProgress, { domain, label: domainLabel(domain), stage: "媒体已齐全", current: 1, total: 1, status: "active" });
        return;
    }
    let downloaded = 0;
    await runWithConcurrency(tasks, FILE_CONCURRENCY, async (remoteFile) => {
        const blob = await downloadWebdavFile(config, remoteFile.path);
        if (!blob) throw new Error(`远端媒体缺失：${remoteFile.storageKey}，未写入新清单`);
        const typedBlob = blob.type ? blob : blob.slice(0, blob.size, remoteFile.mimeType);
        await (remoteFile.storageKey.startsWith("image:") ? setImageBlob(remoteFile.storageKey, typedBlob) : setMediaBlob(remoteFile.storageKey, typedBlob));
        downloaded += 1;
        emitProgress(onProgress, { domain, label: domainLabel(domain), stage: "下载媒体", current: downloaded, total: tasks.length, status: "active" });
    });
}

async function uploadChangedFiles<T>(config: WebdavSyncConfig, domain: DomainKey, data: T, remoteFiles: AppSyncFile[], onProgress?: AppSyncProgress) {
    const remoteFileMap = new Map(remoteFiles.map((item) => [item.storageKey, item]));
    const files: AppSyncFile[] = [];
    const tasks: Array<{ item: AppSyncFile; blob: Blob }> = [];
    let uploadedFiles = 0;
    let uploadedBytes = 0;

    const storageKeys = collectStorageKeys(data);
    let scanned = 0;
    for (const storageKey of storageKeys) {
        const blob = storageKey.startsWith("image:") ? await getImageBlob(storageKey) : await getMediaBlob(storageKey);
        const remoteFile = remoteFileMap.get(storageKey);
        if (!blob) {
            if (remoteFile) files.push(remoteFile);
            else throw new Error(`本地媒体缺失：${storageKey}，未写入新清单`);
            scanned += 1;
            emitProgress(onProgress, { domain, label: domainLabel(domain), stage: "检查本地媒体", current: scanned, total: storageKeys.length, status: "active" });
            continue;
        }
        const item: AppSyncFile = {
            storageKey,
            path: domainPath(domain, `files/${await blobDigest(blob)}.${fileExtension(blob.type, storageKey)}`),
            mimeType: blob.type || remoteFile?.mimeType || "application/octet-stream",
            bytes: blob.size,
        };
        files.push(item);
        if (!remoteFile || remoteFile.path !== item.path) tasks.push({ item, blob });
        scanned += 1;
        emitProgress(onProgress, { domain, label: domainLabel(domain), stage: "检查本地媒体", current: scanned, total: storageKeys.length, status: "active" });
    }

    if (!tasks.length) {
        emitProgress(onProgress, { domain, label: domainLabel(domain), stage: "媒体无需上传", current: 1, total: 1, status: "active" });
        return { files, uploadedFiles, uploadedBytes };
    }

    await runWithConcurrency(tasks, FILE_CONCURRENCY, async ({ item, blob }) => {
        await uploadWebdavFile(config, item.path, blob, item.mimeType);
        uploadedFiles += 1;
        uploadedBytes += blob.size;
        emitProgress(onProgress, { domain, label: domainLabel(domain), stage: `上传媒体 ${formatBytes(blob.size)}`, current: uploadedFiles, total: tasks.length, status: "active" });
    });

    return { files, uploadedFiles, uploadedBytes };
}

async function hydrateAsset(asset: Asset): Promise<Asset> {
    if (asset.kind === "image" && asset.data.storageKey) {
        const dataUrl = await resolveImageUrl(asset.data.storageKey, asset.data.dataUrl);
        return { ...asset, coverUrl: asset.coverUrl.startsWith("blob:") ? dataUrl : asset.coverUrl, data: { ...asset.data, dataUrl } };
    }
    if (asset.kind === "video" && asset.data.storageKey) {
        const url = await resolveMediaUrl(asset.data.storageKey, asset.data.url);
        return { ...asset, coverUrl: asset.coverUrl.startsWith("blob:") ? url : asset.coverUrl, data: { ...asset.data, url } };
    }
    return asset;
}

async function readStoredLogs(store: LogStore) {
    const logs: StoredLog[] = [];
    await store.iterate<StoredLog, void>((value) => {
        if (value && typeof value === "object") logs.push(value);
    });
    return logs;
}

async function replaceStoredLogs(store: LogStore, logs: StoredLog[], removeMissing = false) {
    const previous = removeMissing ? await readStoredLogs(store) : [];
    await runWithConcurrency(logs, FILE_CONCURRENCY, async (log) => {
        const id = getStringField(log, "id");
        if (id) await store.setItem(id, log);
    });
    const keeping = new Set(logs.map((log) => getStringField(log, "id")));
    for (const log of previous) { const id = getStringField(log, "id"); if (id && !keeping.has(id)) await store.removeItem(id); }
}

function collectStorageKeys(value: unknown, keys = new Set<string>()) {
    if (typeof value === "string") {
        if (storageKeyPattern.test(value)) keys.add(value);
        return [...keys];
    }
    if (!value || typeof value !== "object") return [...keys];
    if ("storageKey" in value && typeof value.storageKey === "string" && storageKeyPattern.test(value.storageKey)) keys.add(value.storageKey);
    Object.values(value).forEach((item) => (Array.isArray(item) ? item.forEach((child) => collectStorageKeys(child, keys)) : collectStorageKeys(item, keys)));
    return [...keys];
}

function domainPath(domain: DomainKey, path: string) {
    return `${domain}/${path}`;
}

function domainLabel(domain: DomainKey) {
    if (domain === "canvas") return "画布";
    if (domain === "assets") return "我的资产";
    if (domain === "image-workbench") return "生图工作台";
    return "视频创作台";
}

function emitProgress(onProgress: AppSyncProgress | undefined, event: AppSyncProgressEvent) {
    onProgress?.(event);
}

function getStringField(item: Record<string, unknown>, key: string) {
    const value = item[key];
    return typeof value === "string" ? value : "";
}

async function blobDigest(blob: Blob) {
    const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function describeDifference(local: unknown, remote: unknown) {
    const list = (value: unknown) => Object.values(value || {}).flatMap((item) => Array.isArray(item) ? item : []).filter((item) => item && typeof item.id === "string");
    const a = new Map(list(local).map((item) => [item.id, item]));
    const b = new Map(list(remote).map((item) => [item.id, item]));
    const changed = [...a].filter(([id, item]) => b.has(id) && JSON.stringify(item) !== JSON.stringify(b.get(id))).map(([id, item]) => item.title || item.name || id);
    return `本地独有 ${[...a.keys()].filter((id) => !b.has(id)).length}，远端独有 ${[...b.keys()].filter((id) => !a.has(id)).length}，内容不同 ${changed.length}${changed.length ? `（${changed.join("、")}）` : ""}`;
}

function fileExtension(mimeType: string, storageKey: string) {
    if (mimeType.includes("png")) return "png";
    if (mimeType.includes("jpeg")) return "jpg";
    if (mimeType.includes("webp")) return "webp";
    if (mimeType.includes("gif")) return "gif";
    if (mimeType.includes("mp4")) return "mp4";
    if (mimeType.includes("webm")) return "webm";
    if (mimeType.includes("wav")) return "wav";
    if (mimeType.includes("mpeg") || mimeType.includes("mp3")) return "mp3";
    return storageKey.startsWith("image:") ? "png" : "bin";
}

function waitForHydration<T extends { hydrated: boolean }>(store: { getState: () => T; subscribe: (listener: (state: T) => void) => () => void }) {
    if (store.getState().hydrated) return Promise.resolve();
    return new Promise<void>((resolve) => {
        const unsubscribe = store.subscribe((state) => {
            if (!state.hydrated) return;
            unsubscribe();
            resolve();
        });
    });
}

async function runWithConcurrency<T, R>(items: T[], limit: number, worker: (item: T, index: number) => Promise<R>) {
    const results = new Array<R>(items.length);
    let nextIndex = 0;
    await Promise.all(
        Array.from({ length: Math.min(limit, items.length) }, async () => {
            while (nextIndex < items.length) {
                const index = nextIndex++;
                results[index] = await worker(items[index], index);
            }
        }),
    );
    return results;
}

function formatBytes(bytes: number) {
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

type SyncBackup = { canvas: CanvasDomainData; assets: AssetDomainData; image: StoredLog[]; video: StoredLog[]; media: { key: string; blob: Blob }[] };
async function createSyncBackup() {
    const { projects, deletedProjects } = useCanvasStore.getState();
    const backup: SyncBackup = { canvas: { projects, deleted: deletedProjects }, assets: { assets: useAssetStore.getState().assets }, image: await readStoredLogs(imageLogStore), video: await readStoredLogs(videoLogStore), media: [] };
    for (const key of collectStorageKeys(backup)) {
        const blob = key.startsWith("image:") ? await getImageBlob(key) : await getMediaBlob(key);
        if (!blob) throw new Error(`无法备份媒体 ${key}，已停止同步`);
        backup.media.push({ key, blob });
    }
    const id = crypto.randomUUID();
    await backupStore.setItem(id, backup);
    await backupStore.setItem("latest", id);
    return id;
}
export const restoreLatestSyncBackup = businessOperation(async () => {
    if (syncing) throw new Error("同步进行中，请完成后再恢复备份");
    const id = await backupStore.getItem<string>("latest");
    const stored = id ? await backupStore.getItem<SyncBackup>(id) : null;
    const backup = stored ? structuredClone(stored) : null;
    if (!backup) throw new Error("没有可恢复的同步前备份");
    // Preserve the current state too, so restoring cannot silently destroy later edits.
    writeOwnership.checkpoint();
    await Promise.all([flushCanvasSave(), flushAssetSave(), flushComposerSave()]);
    assertStorageSaved();
    await createSyncBackup();
    const replacements = new Map<string, string>();
    for (const { key, blob } of backup.media) {
        const current = key.startsWith("image:") ? await getImageBlob(key) : await getMediaBlob(key);
        if (current && await blobDigest(current) === await blobDigest(blob)) continue;
        const freshKey = `${key.split(":")[0]}:${crypto.randomUUID()}`;
        await (freshKey.startsWith("image:") ? setImageBlob(freshKey, blob) : setMediaBlob(freshKey, blob));
        replacements.set(key, freshKey);
    }
    const rewrite = (value: unknown): unknown => typeof value === "string" ? replacements.get(value) || value : Array.isArray(value) ? value.map(rewrite) : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).map(([key, child]) => [key, rewrite(child)])) : value;
    backup.canvas = rewrite(backup.canvas) as CanvasDomainData;
    backup.assets = rewrite(backup.assets) as AssetDomainData;
    backup.image = rewrite(backup.image) as StoredLog[];
    backup.video = rewrite(backup.video) as StoredLog[];
    useCanvasStore.getState().replaceProjects(backup.canvas.projects, backup.canvas.deleted);
    await useAssetStore.getState().replaceAssets(await Promise.all(backup.assets.assets.map(hydrateAsset)));
    await replaceStoredLogs(imageLogStore, backup.image, true);
    await replaceStoredLogs(videoLogStore, backup.video, true);
    await Promise.all([flushCanvasSave(), flushAssetSave()]);
    assertStorageSaved();
});
export const syncAppDataToWebdav = businessOperation(async (config: WebdavSyncConfig, onProgress?: AppSyncProgress) => {
    if (syncing) throw new Error("已有同步正在执行，请等待其完成");
    syncing = true;
    try { return await syncAppDataToWebdavOwned(config, onProgress); }
    finally { syncing = false; }
});
