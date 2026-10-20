import { businessOperation } from "@/lib/write-ownership";
import { saveAs } from "file-saver";

import { createZip, readZip } from "@/lib/zip";
import { getMediaBlob, setMediaBlob } from "@/services/file-storage";
import { getImageBlob, setImageBlob } from "@/services/image-storage";
import type { Asset } from "@/stores/use-asset-store";
import { EXPORT_APP_ID, type AppFileId } from "@/constant/brand";

type AssetExportFile = {
    app: AppFileId;
    version: 1;
    exportedAt: string;
    assets: Asset[];
    files: AssetExportItem[];
    rescue?: { unavailableFiles: { storageKey: string; reason: string }[] };
};

type AssetExportItem = {
    storageKey: string;
    path: string;
    mimeType: string;
    bytes: number;
};

export async function exportAssets(assets: Asset[], filename: string, rescue = false) {
    const files: AssetExportItem[] = [];
    const zipFiles: { name: string; data: BlobPart }[] = [];
    const unavailableFiles: { storageKey: string; reason: string }[] = [];

    await Promise.all(
        assets.map(async (asset) => {
            if (asset.kind !== "image" && asset.kind !== "video") return;
            const storageKey = asset.data.storageKey;
            if (!storageKey) return;
            let blob: Blob | null;
            try {
                blob = asset.kind === "image" ? await getImageBlob(storageKey) : await getMediaBlob(storageKey);
                if (!blob) throw new Error("原文件缺失");
            } catch (error) {
                if (!rescue) throw error;
                unavailableFiles.push({ storageKey, reason: error instanceof Error ? error.message : String(error) });
                return;
            }
            const path = `files/${safeFileName(storageKey)}.${fileExtension(blob.type, asset.kind)}`;
            files.push({ storageKey, path, mimeType: blob.type || asset.data.mimeType, bytes: blob.size });
            zipFiles.push({ name: path, data: blob });
        }),
    );

    const data: AssetExportFile = { app: EXPORT_APP_ID, version: 1, exportedAt: new Date().toISOString(), assets, files, ...(rescue ? { rescue: { unavailableFiles } } : {}) };
    if (rescue) zipFiles.push({ name: "抢救说明.txt", data: "这是当前页面素材列表及可读取原文件的抢救包，不代表保存成功或完整站点备份。缺失/不可读取文件列在 assets.json 的 rescue.unavailableFiles 中。远程链接、素材 metadata 中引用的创作过程文件不保证已打包；不含画布、草稿、工作流模板、生成历史和 API Key。" });
    const zip = await createZip([{ name: "assets.json", data: JSON.stringify(data, null, 2) }, ...zipFiles]);
    saveAs(zip, filename);
}

async function readAssetPackageOwned(file: File) {
    const zip = await readZip(file);
    const assetFile = zip.get("assets.json");
    if (!assetFile) throw new Error("missing assets.json");
    const data = JSON.parse(await assetFile.text()) as AssetExportFile;
    if (data.rescue?.unavailableFiles.length) throw new Error("抢救包包含未恢复的文件，请保留清单并补齐文件后再导入");
    await Promise.all(
        data.files.map(async (item) => {
            const blob = zip.get(item.path);
            if (!blob) return;
            const typedBlob = blob.type ? blob : blob.slice(0, blob.size, item.mimeType);
            await (item.storageKey.startsWith("image:") ? setImageBlob(item.storageKey, typedBlob) : setMediaBlob(item.storageKey, typedBlob));
        }),
    );
    return data.assets;
}

function safeFileName(value: string) {
    return value.replace(/[\\/:*?"<>|]/g, "_");
}

function fileExtension(mimeType: string, kind: Asset["kind"]) {
    if (mimeType.includes("png")) return "png";
    if (mimeType.includes("jpeg")) return "jpg";
    if (mimeType.includes("webp")) return "webp";
    if (mimeType.includes("gif")) return "gif";
    if (mimeType.includes("mp4")) return "mp4";
    if (mimeType.includes("webm")) return "webm";
    return kind === "image" ? "png" : "bin";
}

export const readAssetPackage = businessOperation(readAssetPackageOwned);
