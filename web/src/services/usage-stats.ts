// [dianran] Anonymous prompt usage counter. Counts "copy" (prompt copied) and "use" (prompt inserted / applied) per
// built-in prompt id in localStorage and sends the batch to /api/usage at most about once a day (or when the
// batch gets large). No cookies, no user identifiers: the payload is only { events: { "<promptId>": { copy, use } } }.
// Disabled in development builds, for custom (non built-in) sources, and when the browser sends Do Not Track.
import { STORAGE_NS } from "@/constant/brand";

type Counts = Record<string, { copy: number; use: number }>;
const QUEUE_KEY = `${STORAGE_NS}:usage-queue`;
const FLUSHED_KEY = `${STORAGE_NS}:usage-flushed-at`;
const FLUSH_EVERY_MS = 20 * 60 * 60 * 1000;
const FLUSH_AT_EVENTS = 40;
// Built-in library ids (custom sources use random ids and are never reported).
const BUILT_IN = /^(dianran-picks|x-trending|civitai-trending|youmind-gpt-image-2|youmind-nano-banana-pro|awesome-gpt4o-image-prompts|banana-prompt-quicker|freestylefly-gpt-image-2|awesome-gpt-image):/;

function enabled() {
    if (!import.meta.env.PROD || typeof window === "undefined") return false;
    if (navigator.doNotTrack === "1" || (window as unknown as { doNotTrack?: string }).doNotTrack === "1") return false;
    return true;
}

function readQueue(): Counts {
    try {
        return JSON.parse(localStorage.getItem(QUEUE_KEY) || "{}") as Counts;
    } catch {
        return {};
    }
}

function total(counts: Counts) {
    return Object.values(counts).reduce((sum, value) => sum + value.copy + value.use, 0);
}

export function flushPromptUsage(force = false) {
    if (!enabled()) return;
    const queue = readQueue();
    if (!Object.keys(queue).length) return;
    const last = Number(localStorage.getItem(FLUSHED_KEY) || 0);
    if (!force && Date.now() - last < FLUSH_EVERY_MS && total(queue) < FLUSH_AT_EVENTS) return;
    const body = JSON.stringify({ events: queue });
    localStorage.setItem(FLUSHED_KEY, String(Date.now()));
    localStorage.removeItem(QUEUE_KEY);
    try {
        const sent = navigator.sendBeacon?.("/api/usage", new Blob([body], { type: "application/json" }));
        if (!sent) void fetch("/api/usage", { method: "POST", headers: { "Content-Type": "application/json" }, body, keepalive: true, credentials: "omit" }).catch(() => undefined);
    } catch {
        /* best effort only */
    }
}

/** Record one anonymous copy/use of a built-in prompt (id like "x-trending:123"). */
export function trackPromptUsage(promptId: string | undefined, kind: "copy" | "use" = "copy") {
    if (!promptId || !BUILT_IN.test(promptId) || !enabled()) return;
    try {
        const queue = readQueue();
        const entry = queue[promptId] || { copy: 0, use: 0 };
        entry[kind] += 1;
        queue[promptId] = entry;
        localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
        flushPromptUsage();
    } catch {
        /* storage full or blocked: ignore */
    }
}

let installed = false;
/** Flush pending counts when the tab is hidden (once the daily interval has passed). */
export function installPromptUsageFlush() {
    if (installed || typeof document === "undefined") return;
    installed = true;
    document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "hidden") flushPromptUsage();
    });
}
