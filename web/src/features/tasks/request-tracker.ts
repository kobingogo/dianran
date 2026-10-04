// [dianran] Observe AI provider requests (XHR + fetch) to show real generation phases.
// Read-only instrumentation: requests and responses are passed through untouched.
import { nanoid } from "nanoid";

import { useTaskStore, type GenerationTask, type TaskKind, type TaskPhase } from "./task-store";

type Classified = { kind: TaskKind; role: "create" | "poll" | "download"; model: string; host: string };

const STALE_AFTER_MS = 10 * 60_000;

function targetUrl(raw: string) {
    // Local CORS proxy: http://127.0.0.1:23210/https://api.example.com/v1/...
    const nested = raw.indexOf("/http", 8);
    const value = nested > 0 ? raw.slice(nested + 1) : raw;
    try {
        return new URL(value, window.location.href);
    } catch {
        return null;
    }
}

function readModel(body: unknown): string {
    try {
        if (typeof body === "string") {
            const parsed = JSON.parse(body) as { model?: unknown };
            return typeof parsed.model === "string" ? parsed.model : "";
        }
        if (typeof FormData !== "undefined" && body instanceof FormData) {
            const model = body.get("model");
            return typeof model === "string" ? model : "";
        }
    } catch {
        // not JSON
    }
    return "";
}

export function classifyRequest(method: string, rawUrl: string, body?: unknown): Classified | null {
    const url = targetUrl(rawUrl);
    if (!url || url.origin === window.location.origin) return null;
    if (/^(127\.0\.0\.1|localhost)$/.test(url.hostname) && url.port === "17371") return null; // local agent
    const path = url.pathname.toLowerCase();
    const verb = method.toUpperCase();
    const host = url.host;
    const model = readModel(body);
    const geminiModel = decodeURIComponent(path.match(/\/models\/([^/:]+):/)?.[1] || "");
    if (verb === "POST") {
        if (/\/images\/(generations|edits)$/.test(path)) return { kind: "image", role: "create", model, host };
        if (/\/audio\/speech$/.test(path)) return { kind: "audio", role: "create", model, host };
        if (/\/(responses|chat\/completions)$/.test(path)) return { kind: "text", role: "create", model, host };
        if (/\/videos$/.test(path) || /\/video\/(generations|create|submit)/.test(path) || /:predictlongrunning$/.test(path)) return { kind: "video", role: "create", model: model || geminiModel, host };
        if (/:(stream)?generatecontent$/.test(path)) return { kind: /image|banana/.test(geminiModel) ? "image" : "text", role: "create", model: geminiModel, host };
        return null;
    }
    if (verb === "GET") {
        if (/\/videos\/[^/]+\/content$/.test(path)) return { kind: "video", role: "download", model: "", host };
        if (/\/videos\/[^/]+$/.test(path) || /\/operations\//.test(path) || /\/video\/(query|status|tasks?)\b/.test(path) || /\/tasks?\/[^/]+$/.test(path)) return { kind: "video", role: "poll", model: "", host };
    }
    return null;
}

const store = () => useTaskStore.getState();

function startTask(info: Classified): string {
    const now = Date.now();
    const task: GenerationTask = { id: nanoid(), kind: info.kind, model: info.model, host: info.host, phase: "requesting", startedAt: now, updatedAt: now };
    store().add(task);
    return task.id;
}

function findVideoTask(rawUrl: string) {
    return store().tasks.find((task) => task.kind === "video" && task.remoteId && rawUrl.includes(task.remoteId) && !task.endedAt);
}

function remoteIdOf(payload: unknown): string {
    if (!payload || typeof payload !== "object") return "";
    const record = payload as Record<string, unknown>;
    const data = record.data && typeof record.data === "object" ? (record.data as Record<string, unknown>) : undefined;
    const candidates = [record.id, record.task_id, record.taskId, record.name, data?.id, data?.task_id, data?.taskId];
    const value = candidates.find((item) => typeof item === "string" && item.length > 3);
    return typeof value === "string" ? value : "";
}

function remoteStatusOf(payload: unknown): { phase?: TaskPhase; progress?: number; error?: string } {
    if (!payload || typeof payload !== "object") return {};
    const record = payload as Record<string, unknown>;
    const data = record.data && typeof record.data === "object" ? (record.data as Record<string, unknown>) : record;
    const status = String(data.status ?? data.state ?? data.task_status ?? record.status ?? "").toLowerCase();
    const rawProgress = Number(data.progress ?? record.progress);
    const progress = Number.isFinite(rawProgress) ? (rawProgress <= 1 && rawProgress > 0 ? rawProgress * 100 : rawProgress) : undefined;
    if (record.done === true) return record.error ? { phase: "failed", error: JSON.stringify(record.error).slice(0, 300) } : { phase: "done", progress: 100 };
    if (/fail|error|cancel|reject/.test(status)) return { phase: "failed", error: String((data.error as { message?: string })?.message || data.fail_reason || data.error || status).slice(0, 300) };
    if (/complet|succe|success|done|finish/.test(status)) return { phase: "done", progress: 100 };
    if (/queue|pending|submit|wait|created/.test(status)) return { phase: "queued", progress };
    if (/progress|process|running|generat/.test(status)) return { phase: "generating", progress };
    return { progress };
}

function safeJson(text: string): unknown {
    if (!text || text.length > 200_000) return null;
    try {
        return JSON.parse(text);
    } catch {
        return null;
    }
}

function finishCreate(id: string, kind: TaskKind, status: number, bodyText: string | null) {
    if (status >= 400 || status === 0) {
        const payload = bodyText ? safeJson(bodyText) : null;
        const message = payload && typeof payload === "object" ? extractMessage(payload) : bodyText?.slice(0, 300) || "";
        store().update(id, { phase: "failed", status, error: message || `HTTP ${status}`, endedAt: Date.now() });
        return;
    }
    if (kind === "video") {
        const payload = bodyText ? safeJson(bodyText) : null;
        const remoteId = remoteIdOf(payload);
        const state = remoteStatusOf(payload);
        if (remoteId && state.phase !== "done") {
            store().update(id, { phase: state.phase === "failed" ? "failed" : "queued", remoteId, status, progress: state.progress, error: state.error, ...(state.phase === "failed" ? { endedAt: Date.now() } : {}) });
            return;
        }
    }
    store().update(id, { phase: "done", status, progress: 100, endedAt: Date.now() });
}

function extractMessage(payload: object): string {
    const record = payload as Record<string, unknown>;
    const error = record.error;
    if (typeof error === "string") return error;
    if (error && typeof error === "object" && typeof (error as { message?: unknown }).message === "string") return (error as { message: string }).message;
    if (typeof record.message === "string") return record.message;
    if (typeof record.msg === "string") return record.msg;
    if (typeof record.detail === "string") return record.detail;
    return "";
}

function handlePoll(rawUrl: string, status: number, bodyText: string | null) {
    const task = findVideoTask(rawUrl);
    if (!task) return;
    if (status >= 400) {
        store().update(task.id, { polls: (task.polls || 0) + 1 });
        return;
    }
    const state = remoteStatusOf(bodyText ? safeJson(bodyText) : null);
    const patch: Partial<GenerationTask> = { polls: (task.polls || 0) + 1 };
    if (state.progress !== undefined) patch.progress = Math.max(0, Math.min(100, state.progress));
    if (state.phase === "failed") Object.assign(patch, { phase: "failed", error: state.error, endedAt: Date.now() });
    else if (state.phase === "done") Object.assign(patch, { phase: "receiving", progress: 100 });
    else if (state.phase) patch.phase = state.phase;
    store().update(task.id, patch);
}

function markFailed(id: string, error: string, phase: TaskPhase = "failed") {
    store().update(id, { phase, error, endedAt: Date.now() });
}

let installed = false;

export function installRequestTracker() {
    if (installed || typeof window === "undefined") return;
    installed = true;
    patchXhr();
    patchFetch();
    window.setInterval(() => {
        const now = Date.now();
        for (const task of store().tasks) {
            if (!task.endedAt && now - task.updatedAt > STALE_AFTER_MS) store().update(task.id, { phase: "stale", endedAt: now });
        }
    }, 30_000);
}

function patchXhr() {
    const proto = XMLHttpRequest.prototype;
    const open = proto.open;
    const send = proto.send;
    type Tracked = XMLHttpRequest & { __dr?: { method: string; url: string } };
    proto.open = function (this: Tracked, method: string, url: string | URL, ...rest: unknown[]) {
        this.__dr = { method, url: String(url) };
        return (open as (...args: unknown[]) => void).call(this, method, url, ...rest);
    } as typeof proto.open;
    proto.send = function (this: Tracked, body?: Document | XMLHttpRequestBodyInit | null) {
        const meta = this.__dr;
        const info = meta ? classifyRequest(meta.method, meta.url, body) : null;
        if (meta && info) {
            const url = meta.url;
            if (info.role === "create") {
                const id = startTask(info);
                const xhr = this;
                xhr.addEventListener("readystatechange", () => {
                    if (xhr.readyState === 2) store().update(id, { phase: "receiving", status: xhr.status });
                });
                xhr.addEventListener("progress", (event) => store().update(id, { phase: "receiving", loadedBytes: event.loaded, totalBytes: event.lengthComputable ? event.total : undefined }));
                xhr.addEventListener("load", () => finishCreate(id, info.kind, xhr.status, xhr.responseType === "" || xhr.responseType === "text" ? xhr.responseText : null));
                xhr.addEventListener("error", () => markFailed(id, "Network Error"));
                xhr.addEventListener("timeout", () => markFailed(id, "timeout"));
                xhr.addEventListener("abort", () => markFailed(id, "canceled", "canceled"));
            } else {
                const xhr = this;
                xhr.addEventListener("load", () => {
                    if (info.role === "poll") handlePoll(url, xhr.status, xhr.responseType === "" || xhr.responseType === "text" ? xhr.responseText : null);
                    else {
                        const task = findVideoTask(url);
                        if (task) store().update(task.id, xhr.status < 400 ? { phase: "done", progress: 100, endedAt: Date.now() } : { phase: "failed", status: xhr.status, error: `HTTP ${xhr.status}`, endedAt: Date.now() });
                    }
                });
                if (info.role === "download") {
                    xhr.addEventListener("progress", (event) => {
                        const task = findVideoTask(url);
                        if (task) store().update(task.id, { phase: "receiving", loadedBytes: event.loaded, totalBytes: event.lengthComputable ? event.total : undefined });
                    });
                }
            }
        }
        return send.call(this, body);
    };
}

function patchFetch() {
    const original = window.fetch.bind(window);
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
        const method = init?.method || (input instanceof Request ? input.method : "GET");
        const url = input instanceof Request ? input.url : String(input);
        const info = classifyRequest(method, url, init?.body);
        if (!info) return original(input, init);
        const id = info.role === "create" ? startTask(info) : "";
        const signal = init?.signal || (input instanceof Request ? input.signal : undefined);
        if (id && signal) {
            signal.addEventListener("abort", () => {
                const task = store().tasks.find((item) => item.id === id);
                if (task && !task.endedAt) markFailed(id, "canceled", "canceled");
            });
        }
        let response: Response;
        try {
            response = await original(input, init);
        } catch (error) {
            const aborted = error instanceof DOMException && error.name === "AbortError";
            if (id) markFailed(id, aborted ? "canceled" : error instanceof Error ? error.message : "Network Error", aborted ? "canceled" : "failed");
            throw error;
        }
        try {
            if (info.role === "poll" || (info.role === "create" && (info.kind === "video" || !response.ok))) {
                const text = await response
                    .clone()
                    .text()
                    .catch(() => null);
                if (info.role === "poll") handlePoll(url, response.status, text);
                else finishCreate(id, info.kind, response.status, text);
                return response;
            }
            const taskId = id || findVideoTask(url)?.id || "";
            if (!taskId) return response;
            store().update(taskId, { phase: "receiving", status: response.status });
            if (!response.body) {
                store().update(taskId, { phase: "done", progress: 100, endedAt: Date.now() });
                return response;
            }
            const total = Number(response.headers.get("content-length")) || undefined;
            let loaded = 0;
            let lastUpdate = 0;
            const counter = new TransformStream<Uint8Array, Uint8Array>({
                transform(chunk, controller) {
                    loaded += chunk.byteLength;
                    const now = Date.now();
                    if (now - lastUpdate > 250) {
                        lastUpdate = now;
                        store().update(taskId, { loadedBytes: loaded, totalBytes: total });
                    }
                    controller.enqueue(chunk);
                },
                flush() {
                    store().update(taskId, { phase: "done", progress: 100, loadedBytes: loaded, totalBytes: total, endedAt: Date.now() });
                },
            });
            const tracked = new Response(response.body.pipeThrough(counter), { status: response.status, statusText: response.statusText, headers: response.headers });
            try {
                Object.defineProperty(tracked, "url", { value: response.url });
            } catch {
                // ignore
            }
            return tracked;
        } catch {
            return response;
        }
    };
}
