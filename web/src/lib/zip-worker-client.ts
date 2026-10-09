export function createZipWorker() {
    return new Worker(new URL("./zip-worker.ts", import.meta.url), { type: "module" });
}
