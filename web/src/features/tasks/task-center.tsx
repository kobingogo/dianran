// [dianran] Lightweight task center: floating pill with the live list of generation requests.
import { useEffect } from "react";
import { AudioLines, CheckCircle2, CircleSlash, Clock3, FileText, ImageIcon, ListChecks, LoaderCircle, Video, XCircle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useLocation } from "react-router-dom";

import { FriendlyErrorView } from "@/features/errors/friendly-error-view";
import { isActiveTask, useTaskStore, type GenerationTask } from "./task-store";
import { cn } from "@/lib/utils";
import { formatElapsed, phaseHint, phaseLabel } from "./task-labels";
import { useNow } from "./use-now";
import { useAgentStore } from "@/stores/use-agent-store";

const KIND_ICON = { image: ImageIcon, video: Video, text: FileText, audio: AudioLines } as const;
const RECENT_MS = 3 * 60_000;

function PhaseIcon({ task }: { task: GenerationTask }) {
    if (isActiveTask(task)) return task.phase === "queued" ? <Clock3 className="size-3.5 text-amber-500" /> : <LoaderCircle className="size-3.5 animate-spin text-[var(--brand,#E8572A)]" />;
    if (task.phase === "done") return <CheckCircle2 className="size-3.5 text-emerald-500" />;
    if (task.phase === "failed") return <XCircle className="size-3.5 text-red-500" />;
    return <CircleSlash className="size-3.5 text-stone-400" />;
}

function TaskRow({ task, now }: { task: GenerationTask; now: number }) {
    const { t } = useTranslation();
    const Icon = KIND_ICON[task.kind];
    const elapsed = (task.endedAt || now) - task.startedAt;
    const hint = phaseHint(task, t);
    return (
        <li className="border-b border-stone-100 py-2.5 last:border-b-0 dark:border-stone-800" data-task-phase={task.phase}>
            <div className="flex items-center gap-2 text-xs">
                <Icon className="size-3.5 shrink-0 text-stone-500" />
                <span className="min-w-0 flex-1 truncate font-medium text-stone-800 dark:text-stone-100">{task.model || t(`tasks.kind.${task.kind}`)}</span>
                <PhaseIcon task={task} />
                <span className="shrink-0 text-stone-600 dark:text-stone-300">{phaseLabel(task, t)}</span>
                <span className="w-11 shrink-0 text-right tabular-nums text-stone-400">{formatElapsed(elapsed)}</span>
            </div>
            <div className="mt-0.5 truncate pl-5 text-[11px] text-stone-400">
                {t(`tasks.kind.${task.kind}`)} · {task.host}
                {hint ? ` · ${hint}` : ""}
            </div>
            {task.progress !== undefined && isActiveTask(task) && task.progress > 0 && task.progress < 100 ? (
                <div className="ml-5 mt-1.5 h-1 overflow-hidden rounded-full bg-stone-200 dark:bg-stone-800">
                    <div className="h-full rounded-full bg-[var(--brand,#E8572A)] transition-[width] duration-500" style={{ width: `${task.progress}%` }} />
                </div>
            ) : null}
            {task.phase === "failed" ? (
                <div className="mt-2 flex justify-center rounded-md bg-red-50 px-2 py-2 dark:bg-red-950/30">
                    <FriendlyErrorView error={task.error || ""} status={task.status} />
                </div>
            ) : null}
        </li>
    );
}

export function TaskCenter({ className }: { className?: string }) {
    const { t } = useTranslation();
    // [dianran] On the canvas editor the left side panel + zoom controls own the bottom-left corner and the toolbar spans the
    // bottom edge, so the pill sits top-right under the canvas top bar and slides left of the Agent panel when it is open.
    const onCanvas = /^\/canvas\/[^/]+/.test(useLocation().pathname);
    const agentOpen = useAgentStore((state) => state.panelOpen);
    const agentWidth = useAgentStore((state) => state.width);
    const tasks = useTaskStore((state) => state.tasks);
    const clearFinished = useTaskStore((state) => state.clearFinished);
    const open = useTaskStore((state) => state.centerOpen);
    const setOpen = useTaskStore((state) => state.setCenterOpen);
    const active = tasks.filter(isActiveTask);
    const now = useNow(tasks.length > 0, active.length > 0 || open ? 1000 : 5000);
    const recentFailed = tasks.filter((task) => task.phase === "failed" && now - (task.endedAt || 0) < RECENT_MS);
    const hasRecent = tasks.length > 0 && (active.length > 0 || tasks.some((task) => now - (task.endedAt || now) < RECENT_MS));
    // Off the canvas editor the rail / phone chip is the entry, so the floating pill only stays on the canvas.
    const showPill = className ? hasRecent : onCanvas && hasRecent;

    useEffect(() => {
        if (!open) return;
        const onKey = (event: KeyboardEvent) => {
            if (event.key === "Escape") setOpen(false);
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [open, setOpen]);

    if (!showPill && !open) return null;

    return (
        <>
            {open ? (
                <>
                    <button type="button" tabIndex={-1} className="fixed inset-0 z-[64] cursor-default bg-transparent" aria-label={t("tasks.close")} onClick={() => setOpen(false)} />
                    <div
                        role="dialog"
                        aria-label={t("tasks.title")}
                        data-task-center
                        className={cn(
                            "fixed z-[66] w-[min(340px,calc(100vw-24px))] rounded-xl border border-stone-200 bg-white p-3 shadow-xl dark:border-stone-700 dark:bg-stone-900",
                            onCanvas ? "top-[68px]" : "top-[4.25rem] right-3 md:bottom-4 md:left-24 md:right-auto md:top-auto",
                        )}
                        style={onCanvas ? { right: agentOpen && window.innerWidth >= 640 ? agentWidth + 17 : 16 } : undefined}
                    >
                        <div className="mb-1 flex items-center justify-between">
                            <div className="text-sm font-semibold">{t("tasks.title")}</div>
                            <button type="button" className="text-[11px] text-stone-400 transition hover:text-stone-700 dark:hover:text-stone-200" onClick={clearFinished}>
                                {t("tasks.clear")}
                            </button>
                        </div>
                        <div className="mb-1 text-[11px] leading-4 text-stone-400">{t("tasks.description")}</div>
                        {tasks.length ? (
                            <ul className="max-h-[50vh] overflow-y-auto">
                                {tasks.map((task) => (
                                    <TaskRow key={task.id} task={task} now={now} />
                                ))}
                            </ul>
                        ) : (
                            <p className="py-6 text-center text-xs text-stone-400">{t("tasks.empty")}</p>
                        )}
                    </div>
                </>
            ) : null}
            {showPill && !open ? (
                <button
                    type="button"
                    className={
                        className ||
                        `fixed z-[65] inline-flex h-9 items-center gap-2 rounded-full border border-stone-200 bg-white/95 px-3.5 text-xs font-medium text-stone-700 shadow-lg backdrop-blur transition-[right,box-shadow] duration-300 hover:shadow-xl dark:border-stone-700 dark:bg-stone-900/95 dark:text-stone-200 ${onCanvas ? "top-[60px] sm:top-[68px]" : "right-3 bottom-[calc(56px+env(safe-area-inset-bottom,0px)+12px)] md:bottom-4 md:left-24 md:right-auto"}`
                    }
                    style={onCanvas && !className ? { right: agentOpen && window.innerWidth >= 640 ? agentWidth + 17 : 16 } : undefined}
                    aria-label={t("tasks.title")}
                    data-task-center-trigger
                    onClick={() => setOpen(true)}
                >
                    {active.length ? <LoaderCircle className="size-3.5 animate-spin text-[var(--brand,#E8572A)]" /> : recentFailed.length ? <XCircle className="size-3.5 text-red-500" /> : <ListChecks className="size-3.5" />}
                    {active.length ? t("tasks.running", { count: active.length }) : recentFailed.length ? t("tasks.failedCount", { count: recentFailed.length }) : t("tasks.recent")}
                </button>
            ) : null}
        </>
    );
}
