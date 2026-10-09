import { businessOperation } from "@/lib/write-ownership";
import { nanoid } from "nanoid";
import { saveAs } from "file-saver";
import { createZip, readZip } from "@/lib/zip";
import { getImageBlob, setImageBlob, deleteStoredImages } from "@/services/image-storage";
import { getMediaBlob, setMediaBlob, deleteStoredMedia } from "@/services/file-storage";
import { useWorkflowStore, workflowTemplate, type WorkflowTemplate } from "@/stores/canvas/use-workflow-store";
import { workflowParameterKeys, type WorkflowPlan } from "./workflow";
import type { WorkflowPluginAction } from "./plugin-actions";
import type { CanvasNodeData } from "@/types/canvas";

// Imported plans are data only. Credentials, scripts, task state and message identities are never accepted.
export function archivePlan(value: unknown): WorkflowPlan {
    const raw = value as WorkflowPlan;
    if (!raw || typeof raw.title !== "string" || !Array.isArray(raw.steps) || !raw.steps.length || !Array.isArray(raw.resources)) throw new Error("模板格式不正确");
    const ids = new Set<string>();
    const identify = (id: unknown) => {
        if (typeof id !== "string" || !id || ids.has(id)) throw new Error("模板身份重复或缺失");
        ids.add(id);
        return id;
    };
    const resources = raw.resources.map((node): CanvasNodeData => {
        identify(node.id);
        if (!["image", "video", "text", "audio"].includes(node.type) || typeof node.title !== "string" || !node.metadata || typeof node.metadata.content !== "string") throw new Error("模板素材格式不正确");
        if (node.type !== "text" && (typeof node.metadata.storageKey !== "string" || !node.metadata.storageKey.includes(":"))) throw new Error("模板媒体必须包含原始文件");
        if (!Number.isFinite(node.width) || node.width <= 0 || !Number.isFinite(node.height) || node.height <= 0) throw new Error("模板素材尺寸不正确");
        const m = node.metadata;
        return {
            id: node.id,
            type: node.type,
            title: node.title,
            position: { x: 80, y: 80 },
            width: node.width,
            height: node.height,
            metadata: { content: node.type === "text" ? m.content : "", storageKey: node.type === "text" ? undefined : m.storageKey, naturalWidth: m.naturalWidth, naturalHeight: m.naturalHeight, mimeType: m.mimeType, bytes: m.bytes, status: "success" },
        };
    });
    const steps = raw.steps.map((step) => {
        identify(step.id);
        if (!["image", "video", "text", "audio"].includes(step.mode) || typeof step.title !== "string" || typeof step.prompt !== "string" || !step.prompt.trim() || !step.parameters || !Array.isArray(step.inputs)) throw new Error("模板步骤格式不正确");
        if (step.source !== undefined && step.source !== "codex") throw new Error("模板生成来源无效");
        let action: WorkflowPluginAction | undefined;
        if (step.action) {
            const value = step.action;
            if (step.mode !== "image" || step.source || [value.nodeType, value.pluginId, value.actionId, value.version, value.digest].some((field) => typeof field !== "string" || !field) || !value.parameters || typeof value.parameters !== "object" || Array.isArray(value.parameters) || Object.values(value.parameters).some((field) => typeof field !== "string" && typeof field !== "boolean" && !(typeof field === "number" && Number.isFinite(field)))) throw new Error("模板插件步骤格式不正确");
            action = { nodeType: value.nodeType, pluginId: value.pluginId, actionId: value.actionId, version: value.version, digest: value.digest, parameters: { ...value.parameters } };
        }
        if (step.source === "codex" && (step.mode !== "image" || !step.parameters.imageModel || step.parameters.count !== "1")) throw new Error("本机 Codex 模板须使用图片模式、明确模型和一个原生任务");
        const parameters = Object.fromEntries(
            (action ? ["count"] as const : step.source === "codex" ? ["imageModel", "count"] as const : workflowParameterKeys[step.mode]).map((key) => {
                const value = step.parameters[key];
                if (typeof value !== "string") throw new Error("模板参数格式不正确");
                return [key, value];
            }),
        ) as typeof step.parameters;
        const inputs = step.inputs.map((input) => {
            if (typeof input.nodeId !== "string" || (input.stepId !== undefined && typeof input.stepId !== "string")) throw new Error("模板输入格式不正确");
            return { nodeId: input.nodeId, stepId: input.stepId };
        });
        const calls = step.mode === "image" || step.mode === "text" ? Number(parameters.count) : 1;
        if (!Number.isInteger(calls) || calls <= 0) throw new Error("模板生成数量无效");
        return { id: step.id, title: step.title, mode: step.mode, prompt: step.prompt, parameters, inputs, actual: {}, calls, endpoint: "", source: step.source, action };
    });
    const visiting = new Set<string>(),
        done = new Set<string>();
    const visit = (id: string) => {
        if (visiting.has(id)) throw new Error("模板存在循环依赖");
        if (done.has(id)) return;
        const step = steps.find((step) => step.id === id);
        if (!step) throw new Error("模板依赖步骤缺失");
        visiting.add(id);
        for (const token of step.prompt.matchAll(/@\[node:([^\]]+)\]/g)) if (!step.inputs.some((input) => input.nodeId === token[1])) throw new Error("模板提示词引用缺少输入关系");
        step.inputs.forEach((input) => {
            if (input.stepId) visit(input.stepId);
            else if (!resources.some((node) => node.id === input.nodeId)) throw new Error("模板输入素材缺失");
        });
        visiting.delete(id);
        done.add(id);
    };
    steps.forEach((step) => visit(step.id));
    return { id: nanoid(), title: raw.title, steps, resources };
}

export async function exportWorkflowTemplate(template: WorkflowTemplate) {
    const plan = archivePlan(workflowTemplate(template.plan, template.title).plan);
    const assets: { key: string; path: string; mimeType: string; bytes: number; sha256: string }[] = [];
    const files: { name: string; data: BlobPart }[] = [];
    for (const node of plan.resources) {
        const key = node.metadata?.storageKey;
        if (!key || assets.some((asset) => asset.key === key)) continue;
        const blob = key.startsWith("image:") ? await getImageBlob(key) : await getMediaBlob(key);
        if (!blob) throw new Error(`原始素材缺失：${node.title}`);
        const path = `assets/${assets.length}`;
        assets.push({ key, path, mimeType: blob.type || node.metadata?.mimeType || "application/octet-stream", bytes: blob.size, sha256: await digest(blob) });
        files.push({ name: path, data: blob });
    }
    const zip = await createZip([{ name: "template.json", data: JSON.stringify({ format: "dianran-workflow", version: 1, plan, assets }) }, ...files]);
    saveAs(zip, `${template.title.replace(/[\\/:*?"<>|]/g, "_") || "工作流"}.zip`);
}

async function importWorkflowTemplateOwned(file: Blob) {
    const entries = await readZip(file);
    const manifest = entries.get("template.json");
    if (!manifest) throw new Error("ZIP 缺少 template.json");
    const data = JSON.parse(await manifest.text());
    if (data.format !== "dianran-workflow" || data.version !== 1 || !Array.isArray(data.assets)) throw new Error("不支持的模板版本");
    const plan = archivePlan(data.plan);
    const keys = new Map<string, string>();
    const required = new Set(plan.resources.map((node) => node.metadata?.storageKey).filter(Boolean));
    if (data.assets.length !== required.size || new Set(data.assets.map((asset: { key: string }) => asset.key)).size !== data.assets.length || new Set(data.assets.map((asset: { path: string }) => asset.path)).size !== data.assets.length) throw new Error("模板媒体清单身份重复或范围不符");
    // Validate every file before storing anything.
    for (const node of plan.resources) {
        const key = node.metadata?.storageKey;
        if (!key) continue;
        const matching = data.assets.filter((asset: { key: string }) => asset.key === key);
        const asset = matching[0];
        if (matching.length !== 1 || typeof asset.path !== "string" || !/^assets\/\d+$/.test(asset.path) || typeof asset.mimeType !== "string" || !entries.get(asset.path)?.size || asset.bytes !== entries.get(asset.path)!.size || typeof asset.sha256 !== "string" || asset.sha256 !== await digest(entries.get(asset.path)!)) throw new Error("模板原始文件缺失或完整性校验失败");
    }
    try {
        for (const node of plan.resources) {
            const oldKey = node.metadata?.storageKey;
            if (!oldKey) continue;
            if (!keys.has(oldKey)) {
                const asset = data.assets.find((asset: { key: string }) => asset.key === oldKey);
                const key = `${node.type}:${nanoid()}`;
                keys.set(oldKey, key);
                const blob = new Blob([entries.get(asset.path)!], { type: asset.mimeType });
                if (node.type === "image") await setImageBlob(key, blob);
                else await setMediaBlob(key, blob);
            }
            node.metadata = { ...node.metadata, storageKey: keys.get(oldKey), content: "" };
        }
        await useWorkflowStore.getState().save(plan, plan.title);
    } catch (error) {
        await Promise.allSettled([deleteStoredImages([...keys.values()].filter((key) => key.startsWith("image:"))), deleteStoredMedia([...keys.values()].filter((key) => !key.startsWith("image:")))]);
        throw error;
    }
}

export const importWorkflowTemplate = businessOperation(importWorkflowTemplateOwned);

async function digest(blob: Blob) {
    const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", await blob.arrayBuffer()));
    return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
}
