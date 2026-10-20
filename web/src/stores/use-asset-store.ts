import { assertBusinessWriter, writeOwnership } from "@/lib/write-ownership";
import { create } from "zustand";
import { persist, type PersistStorage, type StorageValue } from "zustand/middleware";

import { nanoid } from "nanoid";
import { canvasIndexedStorage } from "@/lib/localforage-storage";
import { createSaveQueue } from "@/lib/canvas/save-queue";
import { useAssetSaveStore } from "./use-asset-save-store";
import { cleanupUnusedImages, ensureImagePreview, previewUrlFor, resolveImageUrl } from "@/services/image-storage";
import { cleanupUnusedMedia, resolveMediaUrl } from "@/services/file-storage";
import { storageKey } from "@/constant/brand";

export type AssetKind = "text" | "image" | "video";
export type TextAsset = AssetBase<"text"> & { data: { content: string } };
export type ImageAsset = AssetBase<"image"> & { data: { dataUrl: string; storageKey?: string; width: number; height: number; bytes: number; mimeType: string } };
export type VideoAsset = AssetBase<"video"> & { data: { url: string; storageKey?: string; width: number; height: number; bytes: number; mimeType: string } };
export type Asset = TextAsset | ImageAsset | VideoAsset;

type AssetBase<T extends AssetKind> = {
    id: string;
    kind: T;
    title: string;
    coverUrl: string;
    tags: string[];
    source?: string;
    note?: string;
    createdAt: string;
    updatedAt: string;
    metadata?: Record<string, unknown>;
};

type AssetStore = {
    hydrated: boolean;
    assets: Asset[];
    addAsset: (asset: Omit<Asset, "id" | "createdAt" | "updatedAt">) => Promise<string>;
    updateAsset: (id: string, patch: Partial<Omit<Asset, "id" | "createdAt">>) => Promise<void>;
    removeAsset: (id: string) => Promise<void>;
    replaceAssets: (assets: Asset[]) => Promise<void>;
    cleanupImages: (extra?: unknown) => void;
};

// 卡片用缩略图渲染，自定义封面（远程地址或单独上传的封面）保持原样。
export function assetCoverUrl(asset: Asset) {
    const own = asset.kind === "image" ? asset.data.dataUrl : "";
    const cover = asset.coverUrl || own;
    return asset.kind === "image" && cover === own ? previewUrlFor(asset.data.storageKey) || cover : cover;
}

const ASSET_STORE_KEY = storageKey("asset_store");
let readable = false;
let queuedAssets: Asset[] | undefined;
const saveQueue = createSaveQueue<StorageValue<AssetStore>>(
    (value) => canvasIndexedStorage.setItem(ASSET_STORE_KEY, JSON.stringify(value)),
    (status, error) => useAssetSaveStore.setState({ status, error: error instanceof Error ? error.message : error ? String(error) : "" }),
);
function assertReadable() {
    if (!readable) throw new Error("素材尚未读取成功，请到我的素材重试读取，原数据未覆盖");
}
export const flushAssetSave = () => { assertReadable(); return saveQueue.flush(); };
export const retryAssetSave = async () => {
    if (!readable) await useAssetStore.persist.rehydrate();
    assertReadable();
    if (saveQueue.hasPending()) useAssetSaveStore.setState({ status: "saving", error: "" });
    await saveQueue.flush();
    useAssetStore.getState().cleanupImages();
};

if (typeof window !== "undefined") {
    window.addEventListener("beforeunload", (event) => {
        if (!saveQueue.hasPending()) return;
        event.preventDefault();
        event.returnValue = "";
    });
    document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "hidden" && readable) void saveQueue.flush().catch(() => {});
    });
}

const assetStorage: PersistStorage<AssetStore> = {
    getItem: async (name) => {
        if (readable && saveQueue.hasPending()) await saveQueue.flush();
        readable = false;
        useAssetSaveStore.setState({ status: "loading", error: "", readFailed: false });
        const value = await canvasIndexedStorage.getItem<string>(name);
        const parsed = value == null ? null : JSON.parse(value) as StorageValue<AssetStore>;
        if (value != null && (!parsed || parsed.version !== 0 || !Array.isArray(parsed.state?.assets))) throw new Error("素材数据格式损坏或版本未知，请保留原数据后恢复备份");
        if (parsed?.state.assets.some((asset) => !asset || typeof asset.id !== "string" || !["text", "image", "video"].includes(asset.kind) || !asset.data || typeof asset.title !== "string" || typeof asset.coverUrl !== "string")) throw new Error("素材记录损坏，请保留原数据后恢复备份");
        if (parsed) parsed.state.assets = await Promise.all(
            parsed.state.assets.map(async (asset) => {
                if (asset.kind === "video" && asset.data.storageKey) return { ...asset, data: { ...asset.data, url: await resolveMediaUrl(asset.data.storageKey, asset.data.url) } };
                if (asset.kind !== "image") return asset;
                if (asset.data.storageKey) {
                    void ensureImagePreview(asset.data.storageKey);
                    return {
                        ...asset,
                        coverUrl: asset.coverUrl.startsWith("blob:") ? await resolveImageUrl(asset.data.storageKey, asset.coverUrl) : asset.coverUrl,
                        data: { ...asset.data, dataUrl: await resolveImageUrl(asset.data.storageKey, asset.data.dataUrl) },
                    };
                }
                return asset;
            }),
        );
        queuedAssets = parsed?.state.assets;
        readable = true;
        useAssetSaveStore.setState({ status: "saved", error: "", readFailed: false });
        return parsed;
    },
    setItem: (_name, value) => {
        if (!readable || (!writeOwnership.canWrite() && writeOwnership.getSnapshot() !== "draining") || queuedAssets === value.state.assets) return;
        queuedAssets = value.state.assets;
        saveQueue.enqueue(value);
    },
    removeItem: (name) => canvasIndexedStorage.removeItem(name),
};

export const useAssetStore = create<AssetStore>()(
    persist(
        (set, get) => {
            const commit = set;
            set = ((...args: Parameters<typeof set>) => { assertBusinessWriter(); (commit as (...values: Parameters<typeof set>) => void)(...args); }) as typeof set;
            return {
                hydrated: false,
                assets: [],
                addAsset: async (asset) => {
                    assertReadable();
                    const now = new Date().toISOString();
                    const id = nanoid();
                    set((state) => ({ assets: [{ ...asset, id, createdAt: now, updatedAt: now } as Asset, ...state.assets] }));
                    await flushAssetSave();
                    return id;
                },
                updateAsset: async (id, patch) => {
                    assertReadable();
                    set((state) => ({
                        assets: state.assets.map((asset) => (asset.id === id ? ({ ...asset, ...patch, updatedAt: new Date().toISOString() } as Asset) : asset)),
                    }));
                    await flushAssetSave();
                },
                removeAsset: async (id) => {
                    assertReadable();
                    set((state) => ({ assets: state.assets.filter((asset) => asset.id !== id) }));
                    await flushAssetSave();
                    get().cleanupImages();
                },
                replaceAssets: async (assets) => {
                    assertReadable();
                    set({ assets });
                    await flushAssetSave();
                },
                cleanupImages: (extra) => {
                    if (!writeOwnership.canWrite()) return;
                    window.setTimeout(async () => {
                        try {
                            assertBusinessWriter();
                            await flushAssetSave();
                            const { useCanvasStore } = await import("@/stores/canvas/use-canvas-store");
                            const used = { assets: get().assets, projects: useCanvasStore.getState().projects, extra };
                            await cleanupUnusedImages(used);
                            await cleanupUnusedMedia(used);
                        } catch (error) {
                            console.error("素材引用无法核对，已停止清理；原始文件保留", error);
                        }
                    }, 0);
                },
            };
        },
        {
            name: ASSET_STORE_KEY,
            storage: assetStorage,
            partialize: (state) => ({ assets: state.assets }) as StorageValue<AssetStore>["state"],
            onRehydrateStorage: () => (_state, error) => {
                if (error) {
                    useAssetSaveStore.setState({ status: "error", readFailed: !readable, error: error instanceof Error ? error.message : String(error) });
                    return;
                }
                useAssetStore.setState({ hydrated: true });
            },
        },
    ),
);
