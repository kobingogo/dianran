import { useEffect, type ReactNode } from "react";

import { InkButton } from "@/components/ui/ink-button";
import { cn } from "@/lib/utils";

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

/**
 * PLAN 5.4 GenerateBar：参数摘要 + 预计耗时 / 调用次数 + 朱砂主按钮「落笔生成 ⌘↵」。
 * ⌘/Ctrl+Enter 全局触发（输入法组字时不触发）。
 */
export function GenerateBar({ summary, estimate, label = "落笔生成", busyLabel, busy, disabled, onGenerate, extra, className, shortcut = true }: { summary?: ReactNode; estimate?: ReactNode; label?: ReactNode; busyLabel?: ReactNode; busy?: boolean; disabled?: boolean; onGenerate: () => void; extra?: ReactNode; className?: string; shortcut?: boolean }) {
    useEffect(() => {
        if (!shortcut) return;
        const handler = (event: KeyboardEvent) => {
            if (event.key !== "Enter" || !(event.metaKey || event.ctrlKey) || event.isComposing || event.defaultPrevented) return;
            if (disabled || busy) return;
            event.preventDefault();
            onGenerate();
        };
        window.addEventListener("keydown", handler);
        return () => window.removeEventListener("keydown", handler);
    }, [busy, disabled, onGenerate, shortcut]);
    return (
        <div className={cn("space-y-2.5", className)}>
            {summary || estimate ? (
                <div className="flex items-center justify-between gap-3 text-xs text-[color:var(--ink-500)]">
                    <span className="min-w-0 truncate">{summary}</span>
                    <span className="shrink-0">{estimate}</span>
                </div>
            ) : null}
            <InkButton variant="zhu" size={46} block disabled={disabled || busy} onClick={onGenerate}>
                {busy ? busyLabel || label : label}
                {shortcut ? <span className="hidden rounded-[5px] border border-b-2 border-white/50 px-1.5 font-[family-name:var(--font-mono)] text-[11px] leading-4 sm:inline">{isMac ? "⌘ ↵" : "Ctrl ↵"}</span> : null}
            </InkButton>
            {extra}
        </div>
    );
}
