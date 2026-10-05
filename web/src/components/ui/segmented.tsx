import type { KeyboardEvent, ReactNode } from "react";

import { cn } from "@/lib/utils";

export type SegmentedOption<T extends string> = { value: T; label: ReactNode; hint?: ReactNode; disabled?: boolean };

/** PLAN 5.4 Segmented：纸底凹槽、选中项浮起、可带副标题；radiogroup + 左右方向键。 */
export function InkSegmented<T extends string>({ value, options, onChange, ariaLabel, className, size = "md" }: { value: T; options: SegmentedOption<T>[]; onChange: (value: T) => void; ariaLabel?: string; className?: string; size?: "sm" | "md" }) {
    const enabled = options.filter((item) => !item.disabled);
    const move = (event: KeyboardEvent, step: number) => {
        const index = enabled.findIndex((item) => item.value === value);
        const next = enabled[(index + step + enabled.length) % enabled.length];
        if (!next) return;
        event.preventDefault();
        onChange(next.value);
        const target = (event.currentTarget as HTMLElement).querySelector<HTMLElement>(`[data-value="${CSS.escape(next.value)}"]`);
        target?.focus();
    };
    return (
        <div
            role="radiogroup"
            aria-label={ariaLabel}
            className={cn("flex gap-0.5 rounded-[11px] bg-[var(--paper-2)] p-[3px]", className)}
            onKeyDown={(event) => {
                if (event.key === "ArrowRight" || event.key === "ArrowDown") move(event, 1);
                if (event.key === "ArrowLeft" || event.key === "ArrowUp") move(event, -1);
            }}
            onMouseDown={(event) => event.stopPropagation()}
        >
            {options.map((item) => {
                const on = item.value === value;
                return (
                    <button
                        key={item.value}
                        type="button"
                        role="radio"
                        aria-checked={on}
                        data-value={item.value}
                        tabIndex={on ? 0 : -1}
                        disabled={item.disabled}
                        onClick={() => onChange(item.value)}
                        className={cn(
                            "min-w-0 flex-1 cursor-pointer rounded-lg border-0 px-1.5 text-center leading-tight transition-[background,color,box-shadow] duration-200 ease-[var(--ease-ink)] disabled:cursor-not-allowed disabled:opacity-40",
                            "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--zhu-500)]",
                            size === "sm" ? "py-1 text-[12.5px]" : "py-[7px] pb-1.5 text-[13px]",
                            on ? "bg-[var(--paper-0)] font-semibold text-[color:var(--ink-900)] shadow-[var(--sh-1)]" : "bg-transparent text-[color:var(--ink-500)] hover:text-[color:var(--ink-900)]",
                        )}
                    >
                        <span className="block truncate">{item.label}</span>
                        {item.hint ? <small className={cn("block truncate text-[11px] font-normal", on ? "font-medium text-[color:var(--zhu-600)]" : "text-[color:var(--ink-400)]")}>{item.hint}</small> : null}
                    </button>
                );
            })}
        </div>
    );
}
