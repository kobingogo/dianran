// [dianran] Shared workbench layout for /image and /video (PLAN 6.3 / 6.4 / 6.10).
// Desktop (lg+): 380px paper panel on the left (scrolling body + sticky GenerateBar), results on the right.
// Phone: results on top, a floating composer card at the bottom (above the tab bar); parameters open in a bottom sheet.
import { Drawer } from "antd";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { InkChip } from "@/components/ui/chip";
import { InkButton } from "@/components/ui/ink-button";
import { cn } from "@/lib/utils";

export type WorkbenchTab = "results" | "logs";

export function WorkbenchShell({ controls, results, composer }: { controls: ReactNode; results: ReactNode; composer?: ReactNode }) {
    return (
        <>
            <main className="min-h-0 flex-1 overflow-y-auto lg:overflow-hidden">
                <div className="grid w-full grid-cols-1 lg:h-full lg:grid-cols-[380px_minmax(0,1fr)]">
                    {controls}
                    {results}
                </div>
            </main>
            {composer ? <div className="shrink-0 lg:hidden">{composer}</div> : null}
        </>
    );
}

export function WorkbenchControls({ title, subtitle, headerActions, children, footer }: { icon?: ReactNode; title: string; subtitle?: string; headerActions?: ReactNode; children: ReactNode; footer: ReactNode }) {
    return (
        <aside className="hidden min-w-0 flex-col overflow-hidden border-r border-[var(--line)] bg-[color-mix(in_srgb,var(--paper-0)_60%,transparent)] lg:flex lg:min-h-0">
            <header className="flex items-baseline justify-between gap-3 px-[22px] pb-3 pt-5">
                <div className="flex min-w-0 items-baseline gap-2.5">
                    <h1 className="m-0 shrink-0 font-[family-name:var(--font-serif)] text-[22px] font-semibold leading-tight tracking-[0.02em] text-[color:var(--ink-900)]">{title}</h1>
                    {subtitle ? <span className="truncate text-[12.5px] text-[color:var(--ink-400)]">{subtitle}</span> : null}
                </div>
                {headerActions ? <div className="flex shrink-0 gap-2">{headerActions}</div> : null}
            </header>
            <div className="thin-scrollbar min-h-0 flex-1 space-y-[18px] overflow-y-auto px-[22px] pb-5 pt-1">{children}</div>
            <footer className="border-t border-[var(--line)] bg-[var(--paper-0)] px-[22px] pb-[18px] pt-3.5">{footer}</footer>
        </aside>
    );
}

export function WorkbenchSection({ title, actions, children }: { title: string; actions?: ReactNode; children: ReactNode }) {
    return (
        <section className="min-w-0">
            <div className="mb-2 flex min-h-6 items-center justify-between gap-3">
                <span className="text-[13px] font-semibold text-[color:var(--ink-700)]">{title}</span>
                {actions ? <div className="flex flex-wrap justify-end gap-1">{actions}</div> : null}
            </div>
            {children}
        </section>
    );
}

/** Small text action used in section headers (「提示词库 · 我的素材」). */
export function SectionLink({ icon, children, onClick }: { icon?: ReactNode; children: ReactNode; onClick: () => void }) {
    return (
        <button type="button" onClick={onClick} className="inline-flex cursor-pointer items-center gap-1 rounded-md border-0 bg-transparent px-1.5 py-0.5 text-xs text-[color:var(--ink-500)] transition-colors hover:bg-[var(--paper-2)] hover:text-[color:var(--ink-900)]">
            {icon}
            {children}
        </button>
    );
}

export function WorkbenchResults({ tab, onTabChange, logCount, status, actions, children }: { tab: WorkbenchTab; onTabChange: (tab: WorkbenchTab) => void; logCount: number; status?: ReactNode; actions?: ReactNode; children: ReactNode }) {
    const { t } = useTranslation();
    return (
        <section id="workbench-results" className="flex min-h-[calc(100dvh-180px)] min-w-0 scroll-mt-3 flex-col lg:min-h-0 lg:overflow-hidden">
            <header className="flex min-h-[60px] flex-wrap items-center gap-2.5 border-b border-[var(--line)] px-4 py-3 sm:px-8 lg:h-[68px] lg:py-0">
                <h2 className="m-0 mr-1 font-[family-name:var(--font-serif)] text-[17px] font-semibold text-[color:var(--ink-900)]">{tab === "logs" ? t("workbench.logs") : "本次结果"}</h2>
                <div role="tablist" className="flex gap-1.5">
                    <InkChip role="tab" aria-selected={tab === "results"} selected={tab === "results"} onClick={() => onTabChange("results")}>
                        {t("workbench.results")}
                    </InkChip>
                    <InkChip role="tab" aria-selected={tab === "logs"} selected={tab === "logs"} onClick={() => onTabChange("logs")}>
                        历史 · {logCount}
                    </InkChip>
                </div>
                <span className="flex-1" />
                {status}
                {actions}
            </header>
            <div className="thin-scrollbar min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-8 sm:py-6">{children}</div>
        </section>
    );
}

/** 会话分组标题：时间 · 提示词摘要 —— 模型 · 参数。 */
export function ResultSessionHeader({ time, prompt, meta }: { time: string; prompt: string; meta: string }) {
    return (
        <div className="mb-4 flex items-center gap-2.5 text-[12.5px] text-[color:var(--ink-500)]">
            <span className="min-w-0 max-w-[50%] truncate">
                {time} · {prompt}
            </span>
            <span className="h-px min-w-6 flex-1 bg-[var(--line)]" />
            <span className="shrink-0 truncate">{meta}</span>
        </div>
    );
}

export function relativeTime(createdAt?: number) {
    if (!createdAt) return "刚刚";
    const diff = Date.now() - createdAt;
    if (diff < 60_000) return "刚刚";
    if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
    const date = new Date(createdAt);
    const today = new Date();
    const hhmm = `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
    return date.toDateString() === today.toDateString() ? `今天 ${hhmm}` : `${date.getMonth() + 1}月${date.getDate()}日 ${hhmm}`;
}

/** Failure tile: names the reason and offers a fix (PLAN 6.3 / 7.1). */
export function FailureTile({ error, aspect = "aspect-[3/4]", onRetry, fixes, children }: { error: string; aspect?: string; onRetry: () => void; fixes?: ReactNode; children?: ReactNode }) {
    return (
        <div className={cn("flex flex-col items-center justify-center gap-2 overflow-hidden rounded-xl border border-[color-mix(in_srgb,var(--zhu-500)_30%,var(--line))] bg-[var(--zhu-100)] p-4 text-center", aspect)}>
            <b className="font-[family-name:var(--font-serif)] text-[15px] text-[color:var(--zhu-600)]">这次没画成</b>
            <div className="max-h-[45%] w-full overflow-y-auto text-xs leading-5 text-[color:var(--ink-500)]">{children || error}</div>
            <div className="flex flex-wrap justify-center gap-1.5">
                {fixes}
                <InkButton size={32} variant="paper" onClick={onRetry}>
                    重试
                </InkButton>
            </div>
        </div>
    );
}

/** Guess a one-click fix from the provider error. */
export function failureKind(error: string): "size" | "key" | "model" | "other" {
    if (/401|403|api[ _-]?key|unauthori[sz]ed|authenticat|鉴权|密钥|认证/i.test(error)) return "key";
    if (/size|dimension|resolution|aspect|尺寸|分辨率|比例|像素/i.test(error)) return "size";
    if (/model.*(not|unsupported|invalid)|模型.*(不存在|不支持)/i.test(error)) return "model";
    return "other";
}

/** Ink-line empty state: 一句话 + 2–3 个示例 chip (PLAN 7.6). */
export function WorkbenchEmpty({ title, hint, examples, onPick }: { icon?: ReactNode; title: string; hint: string; examples: string[]; onPick: (prompt: string) => void }) {
    return (
        <div className="flex h-full min-h-[320px] flex-col items-center justify-center px-4 py-10 text-center">
            <svg aria-hidden viewBox="0 0 160 110" className="mb-5 h-[110px] w-[160px] text-[color:var(--ink-400)]" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                <path d="M8 92c22-6 40-28 58-28s26 16 42 16 26-22 44-26" />
                <path d="M30 92c10-16 22-34 34-34" opacity=".55" />
                <path d="M96 30c3 10 3 20-2 30" />
                <circle cx="118" cy="26" r="9" fill="var(--zhu-500)" stroke="none" opacity=".85" />
                <path d="M20 100h120" opacity=".35" />
            </svg>
            <h3 className="m-0 font-[family-name:var(--font-serif)] text-lg font-semibold text-[color:var(--ink-900)]">{title}</h3>
            <p className="mt-1.5 max-w-sm text-sm leading-6 text-[color:var(--ink-500)]">{hint}</p>
            {examples.length ? (
                <div className="mt-5 flex max-w-xl flex-wrap justify-center gap-2">
                    {examples.slice(0, 3).map((example) => (
                        <InkChip key={example} onClick={() => onPick(example)} className="max-w-full">
                            <span className="truncate">{example}</span>
                        </InkChip>
                    ))}
                </div>
            ) : null}
        </div>
    );
}

/**
 * Phone composer (PLAN 6.10): prompt + parameter chips + 生成, docked above the bottom tab bar.
 * Tapping a chip opens the parameter sheet.
 */
export function MobileComposer({ prompt, onPromptChange, placeholder, chips, onOpenSettings, onGenerate, busy, disabled, label = "生成" }: { prompt: string; onPromptChange: (value: string) => void; placeholder: string; chips: string[]; onOpenSettings: () => void; onGenerate: () => void; busy?: boolean; disabled?: boolean; label?: string }) {
    return (
        <div className="border-t border-[var(--line)] bg-[var(--paper-1)] px-3 pb-3 pt-2.5">
            <div className="rounded-[var(--r-lg)] border border-[var(--line)] bg-[var(--paper-0)] p-2.5 shadow-[var(--sh-2)]">
                <textarea value={prompt} onChange={(event) => onPromptChange(event.target.value)} rows={2} placeholder={placeholder} aria-label="提示词" className="block w-full resize-none border-0 bg-transparent text-sm leading-6 text-[color:var(--ink-900)] outline-none placeholder:text-[color:var(--ink-400)]" />
                <div className="mt-1.5 flex items-center gap-1.5">
                    <div className="flex min-w-0 flex-1 gap-1.5 overflow-x-auto">
                        {chips.map((chip) => (
                            <InkChip key={chip} onClick={onOpenSettings} className="h-8">
                                {chip}
                            </InkChip>
                        ))}
                    </div>
                    <InkButton variant="zhu" size={40} className="min-h-11 px-4" disabled={disabled || busy} onClick={onGenerate}>
                        {busy ? "晕染中…" : label}
                    </InkButton>
                </div>
            </div>
        </div>
    );
}

/** Phone parameter sheet: 圆角 20、抓手条、「完成」. */
export function SettingsSheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
    return (
        <Drawer
            placement="bottom"
            open={open}
            onClose={onClose}
            closable={false}
            size="82vh"
            styles={{ wrapper: { borderRadius: "20px 20px 0 0", overflow: "hidden" }, body: { padding: "0 16px 20px", background: "var(--paper-0)" }, header: { display: "none" } }}
        >
            <div className="sticky top-0 z-10 -mx-4 bg-[var(--paper-0)] px-4 pb-2 pt-2.5">
                <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-[var(--paper-3)]" />
                <div className="flex items-center justify-between">
                    <span className="font-[family-name:var(--font-serif)] text-[17px] font-semibold text-[color:var(--ink-900)]">{title}</span>
                    <InkButton size={32} variant="ink" onClick={onClose}>
                        完成
                    </InkButton>
                </div>
            </div>
            {children}
        </Drawer>
    );
}

/** Ctrl/⌘ + Enter in the prompt box triggers generation. */
export function isGenerateShortcut(event: { key: string; metaKey: boolean; ctrlKey: boolean; nativeEvent?: { isComposing?: boolean } }) {
    return event.key === "Enter" && (event.metaKey || event.ctrlKey) && !event.nativeEvent?.isComposing;
}

/** On phone/tablet bring the results into view when a generation starts. */
export function revealResults() {
    if (typeof window === "undefined" || window.matchMedia("(min-width: 1024px)").matches) return;
    window.setTimeout(() => document.getElementById("workbench-results")?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
}
