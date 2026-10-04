// [dianran] Honest in-place generation state: real phase from the request tracker + elapsed time, no fake percentage.
import { useRef } from "react";
import { LoaderCircle } from "lucide-react";
import { useTranslation } from "react-i18next";

import { useLatestActiveTask, type TaskKind } from "./task-store";
import { formatElapsed, phaseHint, phaseLabel } from "./task-labels";
import { useNow } from "./use-now";

type Props = {
    kind: TaskKind | TaskKind[];
    /** Override text color (canvas theme). */
    color?: string;
    mutedColor?: string;
    trackColor?: string;
    variant?: "node" | "card";
};

export function GenerationStatus({ kind, color, mutedColor, trackColor, variant = "node" }: Props) {
    const { t } = useTranslation();
    const mountedAt = useRef(Date.now());
    const task = useLatestActiveTask(kind);
    const now = useNow();
    const startedAt = Math.min(mountedAt.current, task?.startedAt ?? mountedAt.current);
    const elapsed = now - startedAt;
    const label = task ? phaseLabel(task, t) : t("tasks.phase.generating");
    const hint = task ? phaseHint(task, t) : "";
    const slow = elapsed > ((Array.isArray(kind) ? kind : [kind]).includes("video") ? 180_000 : 60_000);
    const progress = task?.progress !== undefined && task.progress > 0 && task.progress < 100 ? task.progress : undefined;

    return (
        <div className={variant === "node" ? "flex h-full w-full flex-col items-center justify-center gap-2.5 px-5 text-center" : "flex flex-col items-center justify-center gap-2 px-4 text-center"} style={{ color }} data-generation-status>
            <LoaderCircle className="size-7 animate-spin opacity-80" />
            <div className="text-xs font-medium tracking-wide">{label}</div>
            <div className="text-[11px] tabular-nums" style={{ color: mutedColor, opacity: mutedColor ? 1 : 0.7 }}>
                {t("tasks.elapsed", { time: formatElapsed(elapsed) })}
                {hint ? ` · ${hint}` : ""}
            </div>
            {progress !== undefined ? (
                <div className="h-1 w-32 overflow-hidden rounded-full" style={{ background: trackColor || "rgba(127,127,127,.25)" }}>
                    <div className="h-full rounded-full bg-[var(--brand,#E8572A)] transition-[width] duration-500" style={{ width: `${progress}%` }} />
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
