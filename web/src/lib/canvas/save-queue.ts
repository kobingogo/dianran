export type SaveStatus = "loading" | "saved" | "saving" | "error";

/** Keep the latest snapshot after failure and serialize writes so old writes cannot win. */
export function createSaveQueue<T>(write: (value: T) => Promise<unknown>, report: (status: SaveStatus, error?: unknown) => void) {
    let pending: T | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let running: Promise<void> | undefined;
    const flush = (): Promise<void> => {
        clearTimeout(timer);
        if (running) return running.then(flush);
        if (pending === undefined) return Promise.resolve();
        running = (async () => {
            while (pending !== undefined) {
                const value: T = pending;
                try {
                    await write(value);
                } catch (error) {
                    report("error", error);
                    throw error;
                }
                if (pending === value) pending = undefined;
            }
            report("saved");
        })().finally(() => {
            running = undefined;
        });
        return running;
    };
    return {
        enqueue(value: T) {
            pending = value;
            report("saving");
            clearTimeout(timer);
            timer = setTimeout(() => {
                void flush().catch(() => {});
            }, 400);
        },
        flush,
        hasPending: () => pending !== undefined,
    };
}
