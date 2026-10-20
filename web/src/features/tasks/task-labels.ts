// [dianran] Shared formatting helpers for generation task phases.
import type { TFunction } from "i18next";

import type { GenerationTask } from "./task-store";

export function formatElapsed(ms: number) {
    const seconds = Math.max(0, Math.floor(ms / 1000));
    const minutes = Math.floor(seconds / 60);
    return minutes ? `${minutes}:${String(seconds % 60).padStart(2, "0")}` : `${seconds}s`;
}

export function formatBytes(bytes?: number) {
    if (!bytes) return "";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function phaseLabel(task: Pick<GenerationTask, "phase" | "progress" | "kind">, t: TFunction) {
    const base = task.phase === "unknown" || task.phase === "stale" ? "结果未知" : task.phase === "canceled" ? "已停止本地等待" : t(`tasks.phase.${task.phase}`);
    if ((task.phase === "generating" || task.phase === "queued") && task.progress !== undefined && task.progress > 0 && task.progress < 100) return `${base} ${Math.round(task.progress)}%`;
    return base;
}

export function phaseHint(task: GenerationTask, t: TFunction) {
    if (["unknown", "stale", "canceled"].includes(task.phase)) return "渠道可能仍在执行；有原任务 ID 可取状态，新请求可能再次计费";
    if (task.phase === "requesting") return t(task.kind === "video" ? "tasks.hint.requestingVideo" : "tasks.hint.requesting");
    if (task.phase === "queued") return t("tasks.hint.queued", { count: task.polls || 0 });
    if (task.saveState === "saving") return "作品已生成，正在保存";
    if (task.phase === "receiving") {
        const loaded = formatBytes(task.loadedBytes);
        const total = formatBytes(task.totalBytes);
        return loaded ? t("tasks.hint.receivingBytes", { loaded, total: total ? ` / ${total}` : "" }) : t("tasks.hint.receiving");
    }
    return "";
}
