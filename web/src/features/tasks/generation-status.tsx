// [dianran] Honest in-place generation state: real phase from the request tracker + elapsed time, no fake percentage.
import { useRef } from "react";
import { useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";

import { InkLoader } from "@/components/ui/ink-loader";
import { useBoundTask, isActiveTask, type TaskKind } from "./task-store";
import { formatElapsed, phaseHint, phaseLabel } from "./task-labels";
import { useNow } from "./use-now";

type Props = {
    taskId?: string;
    nodeId?: string;
    kind: TaskKind | TaskKind[];
    /** Override text color (canvas theme). */
    color?: string;
    mutedColor?: string;
    trackColor?: string;
    variant?: "node" | "card";
};

export function GenerationStatus({ kind, taskId, nodeId, color, mutedColor, trackColor, variant = "node" }: Props) {
    const { t } = useTranslation();
    const mountedAt = useRef(Date.now());
    const sourcePath = useLocation().pathname;
    const task = useBoundTask({ taskId, nodeId, sourcePath });
    const now = useNow();
    const startedAt = task?.startedAt ?? mountedAt.current;
    const elapsed = (task?.endedAt || now) - startedAt;
    const label = task ? phaseLabel(task, t) : t("tasks.phase.generating");
    const hint = task ? phaseHint(task, t) : "";
    const slow = elapsed > ((Array.isArray(kind) ? kind : [kind]).includes("video") ? 180_000 : 60_000);
    const progress = task?.progress !== undefined && task.progress > 0 && task.progress < 100 ? task.progress : undefined;

    return (
        <div className={variant === "node" ? "flex h-full w-full flex-col items-center justify-center gap-2.5 px-5 text-center" : "flex flex-col items-center justify-center gap-2 px-4 text-center"} style={{ color }} role="status" aria-live="polite" data-generation-status>
            {(!task || isActiveTask(task)) && <InkLoader size={variant === "node" ? 56 : 88} />}
            <div className="font-[family-name:var(--font-serif)] text-sm font-semibold tracking-wide">{task ? label : "晕染中…"}</div>
            <div className="text-[11px] tabular-nums" style={{ color: mutedColor, opacity: mutedColor ? 1 : 0.7 }}>
                {t("tasks.elapsed", { time: formatElapsed(elapsed) })}
                {hint ? ` · ${hint}` : ""}
            </div>
            {progress !== undefined ? (
                <div className="h-1 w-32 overflow-hidden rounded-full" style={{ background: trackColor || "rgba(127,127,127,.25)" }}>
                    <div className="h-full rounded-full bg-[var(--zhu-500)] transition-[width] duration-500" style={{ width: `${progress}%` }} />
                </div>
            ) : null}
            {!slow && elapsed > 30_000 ? (
                <div className="max-w-[220px] text-[11px] leading-4" style={{ color: mutedColor, opacity: mutedColor ? 1 : 0.7 }}>
                    可离开页面，完成后在任务中心查看
                </div>
            ) : null}
            {slow ? (
                <div className="max-w-[220px] text-[11px] leading-4" style={{ color: mutedColor, opacity: mutedColor ? 1 : 0.7 }}>
                    {t("tasks.slow")}
                </div>
            ) : null}
        </div>
    );
}
