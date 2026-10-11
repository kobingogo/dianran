import { createSaveQueue } from "@/lib/canvas/save-queue";
import { recordLocalDiagnostic } from "@/stores/use-local-diagnostics-store";
import { useEffect, useState } from "react";
import { create } from "zustand";
import localforage from "localforage";
import { STORAGE_NS, storageKey } from "@/constant/brand";
import { assertBusinessWriter } from "@/lib/write-ownership";
import { modelCapabilityOf, resolveModelChannel, modelOptionName, type AiConfig, type ModelCapability } from "@/stores/use-config-store";

const storage = localforage.createInstance({ name: STORAGE_NS, storeName: "app_state" });
const evidenceKey = storageKey("capability_evidence");
type Evidence = Record<string, { succeededAt?: number; modelsReadAt?: number; error?: string }>;
export const useCapabilityEvidenceStore = create<{ records: Evidence; error: string }>(() => ({ records: {}, error: "" }));
const evidenceQueue = createSaveQueue<Evidence>((records) => storage.setItem(evidenceKey, records), (status) => useCapabilityEvidenceStore.setState({ error: status === "error" ? "能力记录尚未保存；不会将它视为作品备份" : "" }));
export const flushCapabilityEvidence = () => evidenceQueue.flush();
export async function capabilityIdentity(config: Pick<AiConfig, "baseUrl" | "apiKey" | "apiFormat"> & { channels?: AiConfig["channels"] }, capability: ModelCapability | "models", model = "") {
    const channel = config.channels && model ? resolveModelChannel(config as AiConfig, model) : config;
    const identity = JSON.stringify(["id" in channel ? channel.id : "", channel.baseUrl.trim().replace(/\/+$/, ""), channel.apiFormat, channel.apiKey, capability, modelOptionName(model)]);
    return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(identity))), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
export async function reloadCapabilityEvidence() {
    try { useCapabilityEvidenceStore.setState({ records: await storage.getItem<Evidence>(evidenceKey) || {}, error: "" }); }
    catch { useCapabilityEvidenceStore.setState({ records: {}, error: "能力记录读取失败，配置与作品仍可使用" }); }
}
export async function recordCapabilityEvidence(config: Parameters<typeof capabilityIdentity>[0], capability: ModelCapability | "models", model: string, error?: string) {
    assertBusinessWriter();
    const key = await capabilityIdentity(config, capability, model);
    assertBusinessWriter();
    const current = useCapabilityEvidenceStore.getState().records;
    const record = error ? { ...current[key], error } : { ...current[key], error: undefined, ...(capability === "models" ? { modelsReadAt: Date.now() } : { succeededAt: Date.now() }) };
    const records = { ...current, [key]: record };
    useCapabilityEvidenceStore.setState({ records });
    evidenceQueue.enqueue(records);
    await evidenceQueue.flush().catch(() => {});
}
export function capabilityReadiness(config: AiConfig, capability: ModelCapability, model: string) {
    const ready = Boolean(model && modelCapabilityOf(config, model) === capability && resolveModelChannel(config, model).baseUrl.trim() && resolveModelChannel(config, model).apiKey.trim());
    return { ready, stage: ready ? "configured" as const : "missing" as const, label: ready ? "已配置，尚无此模型的生成成功记录" : `缺少${{ image: "生图", video: "视频", text: "文本", audio: "音频" }[capability]}渠道或对应模型；当前仅可准备内容，真实生成需先配置` };
}
export function useCapabilityReadiness(config: AiConfig, capability: ModelCapability, model: string) {
    const records = useCapabilityEvidenceStore((state) => state.records);
    const storageError = useCapabilityEvidenceStore((state) => state.error);
    const [identity, setIdentity] = useState({ model: "", key: "", models: "" });
    const base = capabilityReadiness(config, capability, model);
    const channel = resolveModelChannel(config, model);
    const signature = JSON.stringify([capability, model, channel.id, channel.baseUrl, channel.apiFormat, channel.apiKey]);
    useEffect(() => {
        let live = true;
        void Promise.all([capabilityIdentity(config, capability, model), capabilityIdentity(channel, "models")]).then(([key, models]) => { if (live) setIdentity({ model: signature, key, models }); }).catch(() => { if (live) setIdentity({ model: "", key: "", models: "" }); });
        return () => { live = false; };
    }, [signature]);
    const record = identity.model === signature ? records[identity.key] : undefined;
    if (!base.ready) return base;
    if (record?.error) return { ...base, label: `已配置；最近生成未成功：${record.error}` };
    if (record?.succeededAt) return { ...base, stage: "succeeded" as const, label: `此渠道与模型有生成成功记录；不保证下一次请求成功${storageError ? `（${storageError}）` : ""}` };
    if (identity.model === signature && records[identity.models]?.error) return { ...base, label: `已配置；模型读取失败：${records[identity.models].error}` };
    if (identity.model === signature && records[identity.models]?.modelsReadAt) return { ...base, stage: "models-read" as const, label: "已读取渠道模型；此能力尚无生成成功记录" };
    return base;
}
/** Evidence storage failure must never turn a successful paid request into a failed request. */
export async function observeGeneration<T>(config: AiConfig, capability: ModelCapability, model: string, run: () => Promise<T>): Promise<T> {
    try {
        const result = await run();
        void recordLocalDiagnostic("generation-success");
        await recordCapabilityEvidence(config, capability, model).catch(() => {});
        return result;
    } catch (error) {
        await recordCapabilityEvidence(config, capability, model, error instanceof Error ? error.message : "生成未成功").catch(() => {});
        throw error;
    }
}
