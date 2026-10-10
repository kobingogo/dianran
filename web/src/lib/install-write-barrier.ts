import localforage from "localforage";
import { writeOwnership } from "./write-ownership";
import { atomicStorageWrite, CONFLICT_STORE, guardedStores, isSharedBusinessKey, storageBaselines } from "./atomic-storage";
const failedWrites = new Map<string, unknown>();
export function assertStorageSaved() {
    if (failedWrites.size) throw new Error("仍有本地写入失败，请重试保存后再释放编辑权；" + String([...failedWrites.values()][0]));
}

// A Proxy survives localforage replacing its stub methods during driver initialization.
export function installWriteBarrier() {
    const create = localforage.createInstance.bind(localforage);
    const backups = new Map<string, LocalForage>();
    const queues = new Map<string, Promise<unknown>>();
    localforage.createInstance = (options) => {
        const store = create(options);
        const identity = `${store.config("name")}:${store.config("storeName")}`;
        const guarded = guardedStores.has(String(store.config("storeName")));
        const observed = storageBaselines.get(identity) || new Map<string, unknown>();
        storageBaselines.set(identity, observed);
        const remember = (key: string, value: unknown) => { if (!observed.has(key)) observed.set(key, structuredClone(value)); };
        return new Proxy(store, {
            get(target, property) {
                if (guarded && property === "getItem") return async (key: string) => { const value = await target.getItem(key); remember(key, value); return value; };
                if (guarded && property === "iterate") return async (callback: (value: unknown, key: string, iteration: number) => unknown) => target.iterate((value, key, iteration) => { remember(key, value); return callback(value, key, iteration); });
                if (["setItem", "removeItem", "clear", "dropInstance"].includes(String(property))) return (...args: unknown[]) => {
                    const key = `${target.config("name")}:${target.config("storeName")}:${property === "clear" || property === "dropInstance" ? "*" : String(args[0])}`;
                    try { return writeOwnership.track(async () => {
                        try {
                            await target.ready();
                            writeOwnership.assertOwned();
                            let result: unknown;
                            const itemKey = String(args[0]);
                            if (guarded && (property === "clear" || property === "dropInstance" || isSharedBusinessKey(String(target.config("storeName")), itemKey))) {
                                if (property === "clear" || property === "dropInstance") throw new Error("共享业务数据不能整库清空，请按具体记录删除，避免覆盖其他页面");
                                if (target.driver() !== localforage.INDEXEDDB) throw new Error("当前存储不支持原子冲突保护，未覆盖业务数据");
                                const database = String(target.config("name"));
                                let backup = backups.get(database);
                                if (!backup) { backup = create({ name: database, storeName: CONFLICT_STORE, driver: localforage.INDEXEDDB }); backups.set(database, backup); }
                                const value = structuredClone(args[1]);
                                const operation = (queues.get(identity) || Promise.resolve()).catch(() => {}).then(async () => {
                                    await backup!.ready();
                                    const merged = await atomicStorageWrite(database, String(target.config("storeName")), itemKey, observed.get(itemKey), value, property === "removeItem");
                                    observed.set(itemKey, property === "removeItem" ? undefined : value);
                                    return merged;
                                });
                                queues.set(identity, operation);
                                result = await operation;
                            } else result = await (Reflect.get(target, property).bind(target) as (...args: unknown[]) => Promise<unknown>)(...args);
                            failedWrites.delete(key);
                            return result;
                        } catch (error) { failedWrites.set(key, error); throw error; }
                    }); } catch (error) { return Promise.reject(error); }
                };
                const value = Reflect.get(target, property);
                return typeof value === "function" ? value.bind(target) : value;
            },
        });
    };
}
