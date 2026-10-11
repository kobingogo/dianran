export type WritePhase = "starting" | "readonly" | "preparing" | "writer" | "draining" | "unsupported";
export function createWriteOwnership(locks?: Pick<LockManager, "request">) {
    let phase: WritePhase = "starting";
    let error = "";
    let releaseLock: (() => void) | undefined;
    let acquiring = false;
    const listeners = new Set<() => void>();
    const operations = new Set<Promise<unknown>>();
    const failures: unknown[] = [];
    const beforeRelease = new Set<() => void>();
    const publish = (next: WritePhase, reason = "") => { phase = next; error = reason; listeners.forEach((fn) => fn()); };
    const assertWriter = () => { if (phase !== "writer") throw new Error("此页面只读，请先取得编辑权；未执行写入或生成"); };
    const assertOwned = () => { if (phase !== "writer" && phase !== "draining") throw new Error("此页面没有编辑权，原数据未修改"); };
    const track = <T>(operation: () => Promise<T>): Promise<T> => {
        assertOwned();
        const promise = Promise.resolve().then(operation);
        operations.add(promise);
        void promise.then(() => operations.delete(promise), (reason) => { operations.delete(promise); failures.push(reason); });
        return promise;
    };
    return {
        getSnapshot: () => phase,
        getError: () => error,
        subscribe: (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; },
        assertWriter, assertOwned, track,
        checkpoint: () => { assertWriter(); beforeRelease.forEach((fn) => fn()); },
        beforeRelease: (fn: () => void) => { beforeRelease.add(fn); return () => { beforeRelease.delete(fn); }; },
        canWrite: () => phase === "writer",
        operation: <A extends unknown[], R>(fn: (...args: A) => Promise<R>) => async (...args: A) => { assertWriter(); return track(() => fn(...args)); },
        async acquire(reload: () => Promise<void>) {
            if (acquiring || releaseLock || phase === "writer") return;
            if (!locks) {
                acquiring = true;
                publish("preparing");
                try { await reload(); failures.length = 0; publish("writer"); }
                catch (reason) { publish("starting", String(reason)); throw reason; }
                finally { acquiring = false; }
                return;
            }
            acquiring = true;
            try {
                await new Promise<void>((resolve, reject) => {
                    void locks.request("dianran:business-writer", { ifAvailable: true }, async (lock) => {
                        if (!lock) { publish("readonly", "另一页面正在编辑，请在该页面保存并释放编辑权，或关闭该页面"); resolve(); return; }
                        const held = new Promise<void>((release) => { releaseLock = release; });
                        publish("preparing");
                        try { await reload(); failures.length = 0; publish("writer"); resolve(); }
                        catch (reason) { releaseLock = undefined; publish("readonly", String(reason)); reject(reason); return; }
                        await held;
                        releaseLock = undefined;
                        publish("readonly");
                    }).catch(reject);
                });
            } catch (reason) {
                if (phase !== "readonly") publish("unsupported", `无法建立编辑保护：${String(reason)}`);
                throw reason;
            } finally { acquiring = false; }
        },
        async relinquish(flush: () => Promise<void>) {
            assertWriter();
            if (operations.size) throw new Error("仍有生成、上传、导入或同步正在执行，请完成后再释放编辑权");
            try {
                beforeRelease.forEach((fn) => fn());
                publish("draining");
                // Unmount effects can enqueue final canvas/draft snapshots.
                await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
                failures.length = 0;
                await flush();
                while (operations.size) await Promise.all([...operations]);
                if (failures.length) throw failures[0];
                releaseLock?.();
            } catch (reason) { publish("writer", `保存失败，编辑权保留：${String(reason)}`); throw reason; }
        },
    };
}
export const writeOwnership = createWriteOwnership();
export const assertBusinessWriter = writeOwnership.assertWriter;
export const businessOperation = writeOwnership.operation;
