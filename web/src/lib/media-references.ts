export function collectMediaStorageKeys(value: unknown, keys = new Set<string>()) {
    if (!value || typeof value !== "object") return keys;
    if ("storageKey" in value && typeof value.storageKey === "string" && value.storageKey.includes(":")) keys.add(value.storageKey);
    Object.values(value).forEach((item) => collectMediaStorageKeys(item, keys));
    return keys;
}

export function collectStoredReferenceValue(store: string, key: string, raw: unknown, keys: Set<string>) {
    const value = typeof raw === "string" && /^[\[{]/.test(raw) ? JSON.parse(raw) : raw;
    const name = key.slice(key.lastIndexOf(":") + 1);
    if (store === "app_state") {
        const field = name === "canvas_store" ? "projects" : name === "asset_store" ? "assets" : "";
        if (field && !Array.isArray((value as { state?: Record<string, unknown> })?.state?.[field])) throw new Error(`${name} 数据损坏，已停止清理素材`);
        if (name === "workflow_templates" && !Array.isArray(value)) throw new Error("模板数据损坏，已停止清理素材");
        if (name === "composer_drafts" && (!(value as { state?: { image?: unknown; video?: unknown } })?.state?.image || !(value as { state?: { video?: unknown } })?.state?.video)) throw new Error("草稿数据损坏，已停止清理素材");
    }
    if (store.endsWith("generation_logs") && (!value || typeof value !== "object" || !("references" in value) || !Array.isArray(value.references))) throw new Error("生成历史损坏，已停止清理素材");
    collectMediaStorageKeys(value, keys);
    if (store === "write_conflicts" && value && typeof value === "object") {
        for (const field of ["base", "local", "remote"]) {
            const snapshot = (value as Record<string, unknown>)[field];
            if (typeof snapshot === "string" && /^[\[{]/.test(snapshot)) collectMediaStorageKeys(JSON.parse(snapshot), keys);
        }
    }
}

// Read every authoritative source before either file store starts deleting.
export async function readMediaReferences(
    usedData: unknown,
    readState: (name: string) => Promise<unknown>,
    readHistory: (name: string) => Promise<unknown[]>,
) {
    const keys = collectMediaStorageKeys(usedData);
    for (const [name, field] of [["asset_store", "assets"], ["canvas_store", "projects"], ["composer_drafts", "image"]]) {
        const raw = await readState(name);
        if (raw == null) continue;
        if (typeof raw !== "string") throw new Error(`${name} 数据损坏，已停止清理素材`);
        const value = JSON.parse(raw);
        const valid = field === "image" ? value?.state?.image && value?.state?.video : Array.isArray(value?.state?.[field]);
        if (!valid) throw new Error(`${name} 数据损坏，已停止清理素材`);
        collectMediaStorageKeys(value, keys);
    }
    const templates = await readState("workflow_templates");
    if (templates != null && !Array.isArray(templates)) throw new Error("模板数据损坏，已停止清理素材");
    collectMediaStorageKeys(templates, keys);
    for (const name of ["image_generation_logs", "video_generation_logs"]) {
        const logs = await readHistory(name);
        if (logs.some((log) => !log || typeof log !== "object" || !("references" in log) || !Array.isArray(log.references))) throw new Error(`${name} 数据损坏，已停止清理素材`);
        collectMediaStorageKeys(logs, keys);
    }
    return keys;
}
