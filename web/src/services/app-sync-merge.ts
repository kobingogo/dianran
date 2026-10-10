import type { CanvasDeletedProject, CanvasProject } from "@/stores/canvas/use-canvas-store";

export function comparable(value: unknown): string {
    if (Array.isArray(value)) return `[${value.map(comparable).join(",")}]`;
    if (value && typeof value === "object") {
        const object = value as Record<string, unknown>;
        const mediaKey = object.storageKey || (object.data as Record<string, unknown> | undefined)?.storageKey;
        const storedMedia = typeof mediaKey === "string" && /^(image|video|audio|file|video-reference|audio-reference):.+$/.test(mediaKey);
        const entries = Object.entries(object).filter(([key, item]) => !(storedMedia && ["url", "dataUrl", "coverUrl", "content"].includes(key) && typeof item === "string" && /^(blob:|data:)/.test(item)));
        return `{${entries.sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${comparable(item)}`).join(",")}}`;
    }
    return JSON.stringify(value);
}

// Without a common ancestor, differing records are conservatively preserved, independent of clocks.
export function mergeRecords<T extends { id?: string; title?: string; name?: string }>(local: T[], remote: T[], conflict: (label: string) => void) {
    const items = new Map(local.filter((item) => item.id).map((item) => [item.id!, item]));
    for (const item of remote) {
        if (!item.id) continue;
        const current = items.get(item.id);
        if (!current) items.set(item.id, item);
        else if (comparable(current) !== comparable(item)) {
            const label = item.title || item.name || item.id;
            conflict(`${label}：两侧内容不同，已保留远端副本`);
            const copy = { ...item, id: crypto.randomUUID() };
            if (item.title) copy.title = `${item.title}（远端冲突副本）`;
            if (item.name) copy.name = `${item.name}（远端冲突副本）`;
            items.set(copy.id!, copy);
        }
    }
    return [...items.values()];
}

export function mergeCanvasSnapshots(local: { projects: CanvasProject[]; deleted: CanvasDeletedProject[] }, remote: typeof local, conflict: (label: string) => void) {
    const deleted = new Map([...remote.deleted, ...local.deleted].map((item) => [item.id, item]));
    const projects = mergeRecords(local.projects, remote.projects, conflict).map((project) => {
        if (!deleted.has(project.id)) return project;
        conflict(`${project.title}：删除与编辑冲突，保留删除标记及作品副本`);
        return { ...project, id: crypto.randomUUID(), title: `${project.title}（删除冲突副本）` };
    });
    return { projects, deleted: [...deleted.values()] };
}
