import type { ButtonHTMLAttributes, ReactNode } from "react";

import { cn } from "@/lib/utils";

export type InkButtonVariant = "zhu" | "ink" | "paper" | "ghost";
export type InkButtonSize = 32 | 40 | 46;

const variants: Record<InkButtonVariant, string> = {
    zhu: "border-[var(--zhu-500)] bg-[var(--zhu-500)] text-white hover:border-[var(--zhu-600)] hover:bg-[var(--zhu-600)]",
    ink: "border-[var(--ink-900)] bg-[var(--ink-900)] text-[color:var(--paper-0)] hover:opacity-90",
    paper: "border-[var(--line-strong)] bg-[var(--paper-0)] text-[color:var(--ink-900)] hover:bg-[var(--paper-2)]",
    ghost: "border-transparent bg-transparent text-[color:var(--ink-700)] hover:bg-[var(--paper-2)]",
};
const sizes: Record<InkButtonSize, string> = { 32: "h-8 px-3 text-[13px] gap-1.5", 40: "h-10 px-[18px] text-sm gap-2", 46: "h-[46px] px-5 text-[15px] gap-2" };

/** PLAN 5.4 Button: zhu (主操作，每屏 1 个) / ink / paper / ghost；32 / 40 / 46；按下轻微下沉。 */
export function InkButton({ variant = "paper", size = 40, block, icon, className, children, type = "button", ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: InkButtonVariant; size?: InkButtonSize; block?: boolean; icon?: ReactNode }) {
    return (
        <button
            type={type}
            className={cn(
                "inline-flex shrink-0 cursor-pointer select-none items-center justify-center rounded-[var(--r-md)] border font-medium transition-[background,opacity,transform] duration-[120ms] ease-[var(--ease-ink)] active:translate-y-px disabled:cursor-not-allowed disabled:opacity-45 disabled:active:translate-y-0",
                "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--zhu-500)]",
                variants[variant],
                sizes[size],
                block && "w-full",
                className,
            )}
            {...rest}
        >
            {icon}
            {children}
        </button>
    );
}
