import { businessOperation } from "@/lib/write-ownership";
import { nanoid } from "nanoid";
import { readZip } from "@/lib/zip";
import { collectMediaStorageKeys } from "@/lib/media-references";
import { EXPORT_APP_ID } from "@/constant/brand";
import { getImageBlob, setImageBlob, deleteStoredImages } from "@/services/image-storage";
import { getMediaBlob, setMediaBlob, deleteStoredMedia } from "@/services/file-storage";
import { flushCanvasSave, useCanvasStore, type CanvasProject } from "@/stores/canvas/use-canvas-store";
import { useCanvasSaveStore } from "@/stores/canvas/use-canvas-save-store";
import type { CanvasBackupIssue, CanvasExportFile } from "@/types/canvas-export";

export class CanvasBackupError extends Error {
    constructor(public report: CanvasExportFile["backup"]) {
        super("项目存在缺失文件或未打包的媒体，无法生成完整备份");
    }
}

export async function mediaDigest(blob: Blob) {
    const hash = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
    return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function validateProject(project: CanvasProject) {
    if (!project || typeof project.id !== "string" || !project.id || typeof project.title !== "string" || !Array.isArray(project.nodes) || !Array.isArray(project.connections) || !Array.isArray(project.chatSessions)) throw new Error("项目结构或身份不正确");
    if (!project.viewport || !Number.isFinite(project.viewport.x) || !Number.isFinite(project.viewport.y) || !Number.isFinite(project.viewport.k) || project.viewport.k <= 0 || project.chatSessions.some((session) => !session || typeof session.id !== "string" || !Array.isArray(session.messages))) throw new Error("项目视口或对话结构不正确");
    const nodeIds = new Set<string>(), connectionIds = new Set<string>();
    for (const node of project.nodes) {
        if (!node || typeof node.id !== "string" || !node.id || nodeIds.has(node.id) || typeof node.type !== "string" || typeof node.title !== "string" || !node.position || !Number.isFinite(node.position.x) || !Number.isFinite(node.position.y) || !Number.isFinite(node.width) || node.width <= 0 || !Number.isFinite(node.height) || node.height <= 0) throw new Error("节点身份、尺寸或位置不正确");
        nodeIds.add(node.id);
    }
    for (const edge of project.connections) {
        if (!edge || typeof edge.id !== "string" || !edge.id || connectionIds.has(edge.id) || !nodeIds.has(edge.fromNodeId) || !nodeIds.has(edge.toNodeId)) throw new Error("项目连接身份或节点引用不正确");
        connectionIds.add(edge.id);
    }
}

// Only inspect media fields: URLs appearing in prompts or text are ordinary content.
export function inspectMediaLinks(project: CanvasProject) {
    const externalLinks: CanvasBackupIssue[] = [], unavailableFiles: CanvasBackupIssue[] = [];
    const visit = (value: unknown, path: string, mediaContent = false) => {
        if (!value || typeof value !== "object") return;
        const object = value as Record<string, unknown>;
        const stored = typeof object.storageKey === "string" && /^(image|video|audio|file|video-reference|audio-reference):.+$/.test(object.storageKey);
        if (object.storageKey && !stored) unavailableFiles.push({ projectId: project.id, reference: `${path}.storageKey`, reason: "原文件身份不正确" });
        for (const [key, child] of Object.entries(object)) {
            const reference = `${path}.${key}`;
            if (!stored && typeof child === "string" && child && (["url", "dataUrl", "coverUrl"].includes(key) || key === "content" && mediaContent)) {
                if (child.startsWith("blob:")) unavailableFiles.push({ projectId: project.id, reference, reason: "临时媒体没有原文件身份，刷新后不可恢复" });
                else if (!child.startsWith("data:")) externalLinks.push({ projectId: project.id, reference, reason: child });
            }
            visit(child, reference, Array.isArray(value) ? mediaContent : key === "metadata" && ["image", "video", "audio"].includes(String(object.type)) || key === "images");
        }
    };
    visit(project, "project");
    return { externalLinks, unavailableFiles };
}

export async function prepareCanvasArchive(projects: CanvasProject[], rescue = false) {
    if (!projects.length) throw new Error("未选择可导出的画布");
    const snapshot = structuredClone(projects);
    const backup: CanvasExportFile["backup"] = { mode: rescue ? "rescue" : "complete", unavailableFiles: [], externalLinks: [] };
    const files: { name: string; data: BlobPart }[] = [];
    const items: CanvasExportFile["projects"] = [];
    for (const [index, project] of snapshot.entries()) {
        if (!rescue) validateProject(project);
        const links = inspectMediaLinks(project);
        backup.externalLinks.push(...links.externalLinks);
        backup.unavailableFiles.push(...links.unavailableFiles);
        const assets: CanvasExportFile["projects"][number]["files"] = [];
        for (const [fileIndex, storageKey] of [...collectMediaStorageKeys(project)].entries()) {
            try {
                const blob = await (storageKey.startsWith("image:") ? getImageBlob(storageKey) : getMediaBlob(storageKey));
                if (!blob || !blob.size) throw new Error("原文件缺失或为空");
                const path = `projects/${index}/files/${fileIndex}`;
                assets.push({ storageKey, path, mimeType: blob.type || "application/octet-stream", bytes: blob.size, sha256: await mediaDigest(blob) });
                files.push({ name: path, data: blob });
            } catch (error) {
                backup.unavailableFiles.push({ projectId: project.id, reference: storageKey, reason: error instanceof Error ? error.message : String(error) });
            }
        }
        items.push({ project, files: assets });
    }
    if (!rescue && (backup.unavailableFiles.length || backup.externalLinks.length)) throw new CanvasBackupError(backup);
    const manifest: CanvasExportFile = { app: EXPORT_APP_ID, version: 4, exportedAt: new Date().toISOString(), projects: items, backup };
    return { manifest, files };
}

export async function readCanvasArchive(file: Blob) {
    const entries = await readZip(file);
    const json = entries.get("projects.json");
    if (!json) throw new Error("备份包缺少 projects.json");
    const data = JSON.parse(await json.text()) as CanvasExportFile;
    if (data?.app !== EXPORT_APP_ID || data.version !== 4 || !Array.isArray(data.projects) || !data.projects.length || !data.backup || !["complete", "rescue"].includes(data.backup.mode) || !Array.isArray(data.backup.unavailableFiles) || !Array.isArray(data.backup.externalLinks)) throw new Error("备份格式或版本不支持，请使用当前版本重新导出");
    if (data.backup.mode === "complete" && (data.backup.unavailableFiles.length || data.backup.externalLinks.length)) throw new Error("完整备份清单包含未恢复的媒体");
    if ([...data.backup.unavailableFiles, ...data.backup.externalLinks].some((issue) => !issue || typeof issue.projectId !== "string" || typeof issue.reference !== "string" || typeof issue.reason !== "string")) throw new Error("备份缺失清单不正确");
    const blobs = new Map<string, Blob>(), identities = new Map<string, string>(), paths = new Set<string>(), ids = new Set<string>();
    for (const item of data.projects) {
        const project = item?.project;
        validateProject(project);
        if (ids.has(project.id) || !Array.isArray(item.files)) throw new Error("项目身份重复或原文件清单不正确");
        ids.add(project.id);
        const required = collectMediaStorageKeys(project), listed = new Set<string>();
        if ([...required].some((key) => !/^(image|video|audio|file|video-reference|audio-reference):.+$/.test(key))) throw new Error("项目原文件身份不正确");
        for (const asset of item.files) {
            if (!asset || typeof asset.storageKey !== "string" || !/^(image|video|audio|file|video-reference|audio-reference):.+$/.test(asset.storageKey) || listed.has(asset.storageKey) || !required.has(asset.storageKey) || typeof asset.path !== "string" || !/^projects\/\d+\/files\/\d+$/.test(asset.path) || paths.has(asset.path) || typeof asset.mimeType !== "string" || !Number.isInteger(asset.bytes) || asset.bytes <= 0 || typeof asset.sha256 !== "string") throw new Error("原文件清单不正确或身份重复");
            const blob = entries.get(asset.path);
            if (!blob || blob.size !== asset.bytes || await mediaDigest(blob) !== asset.sha256) throw new Error(`原文件缺失或校验失败：${asset.storageKey}`);
            if (identities.has(asset.storageKey) && identities.get(asset.storageKey) !== asset.sha256) throw new Error("同一文件身份对应不同内容");
            identities.set(asset.storageKey, asset.sha256);
            listed.add(asset.storageKey);
            paths.add(asset.path);
            blobs.set(asset.storageKey, new Blob([blob], { type: asset.mimeType }));
        }
        for (const key of required) {
            if (!listed.has(key) && (data.backup.mode !== "rescue" || !data.backup.unavailableFiles.some((issue) => issue.projectId === project.id && issue.reference === key))) throw new Error(`项目引用未包含原文件：${key}`);
        }
        const links = inspectMediaLinks(project);
        if (data.backup.mode === "complete" && (links.externalLinks.length || links.unavailableFiles.length)) throw new Error("项目仍引用未打包的媒体，不能按完整备份恢复");
        for (const [actual, declared] of [[links.externalLinks, data.backup.externalLinks], [links.unavailableFiles, data.backup.unavailableFiles]]) if (actual.some((issue) => !declared.some((saved) => saved.projectId === issue.projectId && saved.reference === issue.reference && saved.reason === issue.reason))) throw new Error("未打包媒体没有列入抢救清单");
    }
    return { manifest: data, blobs };
}

async function restoreCanvasArchiveOwned(archive: Awaited<ReturnType<typeof readCanvasArchive>>, allowRescue = false) {
    if (archive.manifest.backup.mode === "rescue" && !allowRescue) throw new Error("抢救包只恢复可用内容，请先确认缺失清单");
    if (!useCanvasStore.getState().hydrated || useCanvasSaveStore.getState().readFailed) throw new Error("本机画布尚未读取成功，原数据未覆盖");
    await flushCanvasSave();
    const projects = structuredClone(archive.manifest.projects.map((item) => item.project));
    const remapped = new Map<string, { key: string; url: string }>();
    try {
        // Never write imported bytes under an existing user's file identity.
        for (const project of projects) for (const oldKey of collectMediaStorageKeys(project)) {
            if (remapped.has(oldKey)) continue;
            const key = `${oldKey.split(":")[0]}:${nanoid()}`;
            remapped.set(oldKey, { key, url: "" });
            const blob = archive.blobs.get(oldKey);
            if (blob) remapped.get(oldKey)!.url = await (key.startsWith("image:") ? setImageBlob(key, blob) : setMediaBlob(key, blob));
        }
    } catch (error) {
        await Promise.allSettled([deleteStoredImages([...remapped.values()].map((item) => item.key).filter((key) => key.startsWith("image:"))), deleteStoredMedia([...remapped.values()].map((item) => item.key).filter((key) => !key.startsWith("image:")))]);
        throw error;
    }
    const rewrite = (value: unknown) => {
        if (!value || typeof value !== "object") return;
        const object = value as Record<string, unknown>;
        const mapped = typeof object.storageKey === "string" ? remapped.get(object.storageKey) : undefined;
        if (mapped) {
            object.storageKey = mapped.key;
            for (const field of ["url", "dataUrl", "content", "coverUrl"]) if (typeof object[field] === "string") object[field] = mapped.url;
        }
        Object.values(object).forEach(rewrite);
    };
    projects.forEach(rewrite);
    // Once projects enter memory, retain their files on save failure for retry/rescue.
    const ids = projects.map((project) => useCanvasStore.getState().importProject(project));
    await flushCanvasSave();
    return ids;
}

export const restoreCanvasArchive = businessOperation(restoreCanvasArchiveOwned);
