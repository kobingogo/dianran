// Anonymous built-in prompt counters. Copy/use indicates interaction, never generation success or quality.
import localforage from "localforage";
import { STORAGE_NS } from "@/constant/brand";
import { assertBusinessWriter, writeOwnership } from "@/lib/write-ownership";

type Counts = Record<string, { copy: number; use: number }>;
type Batch = { batchId: string; day: string; events: Counts };
type Queue = { events: Counts; pending?: Batch; attemptedAt: number };
const QUEUE_KEY = `${STORAGE_NS}:usage-batches`;
const FLUSH_EVERY_MS = 20 * 60 * 60 * 1000;
const FLUSH_AT_EVENTS = 40;
// Existing API boundaries; splitting preserves excess counts rather than silently clipping them.
const MAX_IDS = 60, MAX_COUNT = 30;
const BUILT_IN = /^(dianran-picks|x-trending|civitai-trending|youmind-gpt-image-2|youmind-nano-banana-pro|awesome-gpt4o-image-prompts|banana-prompt-quicker|freestylefly-gpt-image-2|awesome-gpt-image):/;
let chain: Promise<unknown> = Promise.resolve();
let availability: "unknown" | "available" | "unavailable" = "unknown";
const statusListeners = new Set<() => void>();
export function subscribePromptUsageStatus(listener: () => void) { statusListeners.add(listener); return () => { statusListeners.delete(listener); }; }
function setAvailability(status: typeof availability) { availability = status; statusListeners.forEach((listener) => listener()); }
export function getPromptUsageStatus() { return availability; }
function enabled() {
    return import.meta.env.PROD && typeof window !== "undefined" && writeOwnership.canWrite() && navigator.doNotTrack !== "1" && (window as unknown as { doNotTrack?: string }).doNotTrack !== "1";
}
function serial(action: () => Promise<void>) {
    const task = chain.catch(() => undefined).then(action);
    chain = task;
    return task.catch(() => undefined); // Optional anonymous counters cannot interrupt creation.
}
async function readQueue(): Promise<Queue> {
    return await localforage.getItem<Queue>(QUEUE_KEY) || { events: {}, attemptedAt: 0 };
}
function total(counts: Counts) { return Object.values(counts).reduce((sum, entry) => sum + entry.copy + entry.use, 0); }
async function flush(queue: Queue, force: boolean) {
    if (!enabled() || availability === "unavailable") return;
    if (!queue.pending && !total(queue.events)) return;
    if (!force && Date.now() - queue.attemptedAt < FLUSH_EVERY_MS && total(queue.events) < FLUSH_AT_EVENTS) return;
    if (availability === "unknown") {
        const response = await fetch("/api/usage", { credentials: "omit", cache: "no-store" });
        const info = response.ok && response.headers.get("content-type")?.includes("application/json") ? await response.json() : null;
        if (info?.enabled !== true || info?.protocol !== 2) { setAvailability("unavailable"); return; }
        setAvailability("available");
    }
    if (!queue.pending) {
        const events: Counts = {};
        for (const [id, counts] of Object.entries(queue.events).slice(0, MAX_IDS)) {
            const sent = { copy: Math.min(MAX_COUNT, counts.copy), use: Math.min(MAX_COUNT, counts.use) };
            events[id] = sent;
            counts.copy -= sent.copy; counts.use -= sent.use;
            if (!counts.copy && !counts.use) delete queue.events[id];
        }
        queue.pending = { batchId: crypto.randomUUID(), day: new Date().toISOString().slice(0, 10), events };
    }
    queue.attemptedAt = Date.now();
    assertBusinessWriter();
    await localforage.setItem(QUEUE_KEY, queue); // Identity persisted before a possibly uncertain network request.
    const batch = queue.pending;
    const response = await fetch("/api/usage", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(batch), keepalive: true, credentials: "omit" });
    const receipt = response.ok && response.headers.get("content-type")?.includes("application/json") ? await response.json() : null;
    if (receipt?.accepted !== true || receipt?.batchId !== batch.batchId) return;
    assertBusinessWriter();
    delete queue.pending;
    await localforage.setItem(QUEUE_KEY, queue);
}
export function flushPromptUsage(force = false) {
    if (!enabled()) return Promise.resolve();
    return serial(async () => flush(await readQueue(), force));
}
export function trackPromptUsage(promptId: string | undefined, kind: "copy" | "use" = "copy") {
    if (!promptId || !BUILT_IN.test(promptId) || !enabled() || availability === "unavailable") return;
    void serial(async () => {
        const queue = await readQueue();
        const entry = queue.events[promptId] ||= { copy: 0, use: 0 };
        entry[kind] += 1;
        assertBusinessWriter();
        await localforage.setItem(QUEUE_KEY, queue);
        await flush(queue, false);
    });
}
let installed = false;
export function installPromptUsageFlush() {
    if (installed || typeof document === "undefined") return;
    installed = true;
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") void flushPromptUsage(); });
}
