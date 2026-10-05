// [dianran] Shared two-column layout for the image / video workbenches.
// Desktop (lg+): controls on the left (scrolling body + sticky generate footer), results/history on the right.
// Phone: controls card stacked above the results card; settings live in a bottom drawer.
import { Segmented } from "antd";
import { History, LayoutGrid } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

export type WorkbenchTab = "results" | "logs";

export function WorkbenchShell({ controls, results }: { controls: ReactNode; results: ReactNode }) {
    return (
        <main className="min-h-0 flex-1 overflow-y-auto lg:overflow-hidden">
            <div className="mx-auto grid w-full max-w-[1680px] grid-cols-1 gap-3 p-3 sm:gap-4 sm:p-4 lg:h-full lg:grid-cols-[400px_minmax(0,1fr)] lg:gap-5 lg:p-5 xl:grid-cols-[440px_minmax(0,1fr)]">
                {controls}
                {results}
            </div>
        </main>
    );
}

export function WorkbenchControls({ icon, title, subtitle, headerActions, children, footer }: { icon: ReactNode; title: string; subtitle?: string; headerActions?: ReactNode; children: ReactNode; footer: ReactNode }) {
    return (
        <aside className="flex min-w-0 flex-col overflow-hidden rounded-xl border border-stone-200 bg-card shadow-sm dark:border-stone-800 lg:min-h-0">
            <header className="flex items-center justify-between gap-3 border-b border-stone-200 px-4 py-3.5 dark:border-stone-800 sm:px-5">
                <div className="flex min-w-0 items-center gap-3">
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-[#E8572A]/10 text-[#E8572A]">{icon}</span>
                    <div className="min-w-0">
                        <h1 className="truncate text-lg font-semibold leading-6 text-stone-950 dark:text-stone-100">{title}</h1>
                        {subtitle ? <p className="truncate text-xs leading-5 text-stone-500 dark:text-stone-400">{subtitle}</p> : null}
                    </div>
                </div>
                {headerActions ? <div className="flex shrink-0 gap-2">{headerActions}</div> : null}
            </header>
            <div className="thin-scrollbar min-h-0 flex-1 space-y-6 px-4 py-5 sm:px-5 lg:overflow-y-auto">{children}</div>
            <footer className="border-t border-stone-200 bg-card px-4 py-3 dark:border-stone-800 sm:px-5">{footer}</footer>
        </aside>
    );
}

export function WorkbenchSection({ title, actions, children }: { title: string; actions?: ReactNode; children: ReactNode }) {
    return (
        <section className="min-w-0">
            <div className="mb-2 flex min-h-6 items-center justify-between gap-3">
                <span className="text-sm font-semibold text-stone-800 dark:text-stone-200">{title}</span>
                {actions ? <div className="flex flex-wrap justify-end gap-1.5">{actions}</div> : null}
            </div>
            {children}
        </section>
    );
}

export function WorkbenchResults({ tab, onTabChange, logCount, status, children }: { tab: WorkbenchTab; onTabChange: (tab: WorkbenchTab) => void; logCount: number; status?: ReactNode; children: ReactNode }) {
    const { t } = useTranslation();
    return (
        <section id="workbench-results" className="flex min-h-[420px] min-w-0 scroll-mt-3 flex-col overflow-hidden rounded-xl border border-stone-200 bg-card shadow-sm dark:border-stone-800 lg:min-h-0">
            <header className="flex flex-wrap items-center justify-between gap-3 border-b border-stone-200 px-4 py-3 dark:border-stone-800 sm:px-5">
                <Segmented<WorkbenchTab>
                    value={tab}
                    onChange={onTabChange}
                    options={[
                        { value: "results", label: <span className="flex items-center gap-1.5 px-1"><LayoutGrid className="size-3.5" />{t("workbench.results")}</span> },
                        { value: "logs", label: <span className="flex items-center gap-1.5 px-1"><History className="size-3.5" />{t("workbench.logs")}<span className="text-xs text-stone-400">{logCount}</span></span> },
                    ]}
                />
                {status}
            </header>
            <div className="thin-scrollbar min-h-0 flex-1 overflow-y-auto p-4 sm:p-5">{children}</div>
        </section>
    );
}

export function WorkbenchEmpty({ icon, title, hint, examples, onPick }: { icon: ReactNode; title: string; hint: string; examples: string[]; onPick: (prompt: string) => void }) {
    const { t } = useTranslation();
    return (
        <div className="flex h-full min-h-[320px] flex-col items-center justify-center px-4 py-10 text-center">
            <div className="relative mb-5">
                <div className="absolute inset-0 -m-6 rounded-full bg-[radial-gradient(circle,rgba(232,87,42,0.18),transparent_70%)]" />
                <span className="relative flex size-16 items-center justify-center rounded-2xl border border-stone-200 bg-stone-50 text-stone-500 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-300">{icon}</span>
            </div>
            <h3 className="text-base font-semibold text-stone-900 dark:text-stone-100">{title}</h3>
            <p className="mt-1.5 max-w-sm text-sm leading-6 text-stone-500 dark:text-stone-400">{hint}</p>
            {examples.length ? (
                <div className="mt-6 w-full max-w-md">
                    <div className="mb-2 text-xs font-medium text-stone-400">{t("workbenchUi.tryExamples")}</div>
                    <div className="flex flex-col gap-2">
                        {examples.map((example) => (
                            <button key={example} type="button" onClick={() => onPick(example)} className="rounded-lg border border-stone-200 px-3 py-2 text-left text-sm text-stone-600 transition hover:border-[#E8572A]/60 hover:bg-[#E8572A]/5 hover:text-stone-900 dark:border-stone-800 dark:text-stone-300 dark:hover:text-stone-100">
                                {example}
                            </button>
                        ))}
                    </div>
                </div>
            ) : null}
        </div>
    );
}

export function GenerateHint() {
    const { t } = useTranslation();
    return <div className="mt-2 hidden text-center text-[11px] text-stone-400 sm:block">{t("workbenchUi.shortcutHint")}</div>;
}

/** Ctrl/⌘ + Enter in the prompt box triggers generation. */
export function isGenerateShortcut(event: { key: string; metaKey: boolean; ctrlKey: boolean; nativeEvent?: { isComposing?: boolean } }) {
    return event.key === "Enter" && (event.metaKey || event.ctrlKey) && !event.nativeEvent?.isComposing;
}

/** On phone/tablet the results card sits below the controls; bring it into view when a generation starts. */
export function revealResults() {
    if (typeof window === "undefined" || window.matchMedia("(min-width: 1024px)").matches) return;
    window.setTimeout(() => document.getElementById("workbench-results")?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
}
