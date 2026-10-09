import { comparable } from "../services/app-sync-merge";
// Reuse synchronization's comparison: property order and temporary stored-media URLs are not edits.
const equal = (a: unknown, b: unknown) => comparable(a) === comparable(b);
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value) && !(value instanceof Blob);

export class StorageConflictError extends Error {
    constructor(public path: string) { super(`另一页面已修改${path}，本页内容已保留，未覆盖已保存数据。请处理冲突后继续保存。`); this.name = "StorageConflictError"; }
}

export function mergeStorageValue(base: unknown, local: unknown, remote: unknown, path = "记录"): unknown {
    if (equal(local, base)) return remote;
    if (equal(remote, base) || equal(local, remote)) return local;
    if (path === "记录/state/mode") return local; // Last-used tab is a preference, not a creative draft.
    if (Array.isArray(local) && Array.isArray(remote) && (base == null || Array.isArray(base))) {
        const lists = [base || [], local, remote] as Record<string, unknown>[][];
        if (lists.every((items) => items.every((item) => object(item) && typeof item.id === "string") && new Set(items.map((item) => item.id)).size === items.length)) {
            const [before, ours, theirs] = lists.map((items) => new Map(items.map((item) => [item.id, item])));
            return [...new Set([...ours.keys(), ...theirs.keys()])].flatMap((id) => {
                const value = mergeStorageValue(before.get(id), ours.get(id), theirs.get(id), `${path}/${id}`);
                return value === undefined ? [] : [value];
            });
        }
    }
    // Records with an identity are indivisible: even changes to different fields can conflict semantically.
    if (object(local) && object(remote) && !local.id && !remote.id && (base == null || object(base))) {
        const before = (base || {}) as Record<string, unknown>;
        return Object.fromEntries([...new Set([...Object.keys(local), ...Object.keys(remote)])].flatMap((key) => {
            const value = mergeStorageValue(before[key], local[key], remote[key], `${path}/${key}`);
            return value === undefined ? [] : [[key, value]];
        }));
    }
    throw new StorageConflictError(path);
}

export function mergeStoredSnapshot(base: unknown, local: unknown, remote: unknown) {
    const json = typeof local === "string" && /^[\[{]/.test(local);
    const decode = (value: unknown) => json && typeof value === "string" ? JSON.parse(value) : value ?? undefined;
    const merged = mergeStorageValue(decode(base), decode(local), decode(remote));
    return json ? JSON.stringify(merged) : merged;
}

export type StorageConflict = { id: string; database: string; store: string; key: string; base: unknown; local: unknown; remote: unknown; message: string };
let conflicts: StorageConflict[] = [];
const listeners = new Set<() => void>();
export const subscribeStorageConflicts = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export const getStorageConflicts = () => conflicts;
export function reportStorageConflict(conflict: StorageConflict) {
    conflicts = [...conflicts.filter((item) => item.id !== conflict.id), conflict];
    listeners.forEach((listener) => listener());
}
export function clearStorageConflict(id: string) {
    conflicts = conflicts.filter((item) => item.id !== id);
    listeners.forEach((listener) => listener());
}
