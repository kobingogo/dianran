import type { ButtonHTMLAttributes } from "react";

import { cn } from "@/lib/utils";

/** PLAN 5.4 Chip：28 高，选中墨底白字。用于筛选、离散选项（视频时长）和示例。 */
export function InkChip({ selected, className, children, type = "button", ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { selected?: boolean }) {
    return (
        <button
            type={type}
            aria-pressed={selected === undefined ? undefined : selected}
            className={cn(
                "inline-flex h-7 shrink-0 cursor-pointer items-center gap-1.5 rounded-full border px-3 text-[12.5px] transition-colors duration-[120ms] disabled:cursor-not-allowed disabled:opacity-40",
                "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--zhu-500)]",
                selected ? "border-[var(--ink-900)] bg-[var(--ink-900)] text-[color:var(--paper-0)]" : "border-[var(--line)] bg-[var(--paper-0)] text-[color:var(--ink-700)] hover:border-[var(--line-strong)] hover:text-[color:var(--ink-900)]",
                className,
            )}
            onMouseDown={(event) => event.stopPropagation()}
            {...rest}
        >
            {children}
        </button>
    );
}
