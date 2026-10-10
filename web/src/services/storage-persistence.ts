export type StoragePersistence = "persistent" | "temporary" | "unsupported";

export async function readStoragePersistence(): Promise<StoragePersistence> {
    if (!navigator.storage?.persisted) return "unsupported";
    return await navigator.storage.persisted() ? "persistent" : "temporary";
}

export async function requestStoragePersistence(): Promise<StoragePersistence> {
    if (!navigator.storage?.persist) return "unsupported";
    await navigator.storage.persist();
    return readStoragePersistence();
}
