import { Minus, Plus } from "lucide-react";

import { cn } from "@/lib/utils";

/** PLAN 5.4 Stepper：−/+ 和数字直输，上限取模型能力。 */
export function InkStepper({ value, min = 1, max, onChange, ariaLabel, className }: { value: number; min?: number; max: number; onChange: (value: number) => void; ariaLabel?: string; className?: string }) {
    const clamp = (next: number) => Math.max(min, Math.min(max, Math.floor(next) || min));
    const button = "grid h-full w-9 shrink-0 cursor-pointer place-items-center border-0 bg-transparent text-[color:var(--ink-500)] hover:text-[color:var(--ink-900)] disabled:cursor-not-allowed disabled:opacity-35";
    return (
        <div className={cn("flex h-9 items-center rounded-[var(--r-md)] border border-[var(--line)] bg-[var(--paper-0)]", className)} onMouseDown={(event) => event.stopPropagation()}>
            <button type="button" className={button} aria-label="减少" disabled={value <= min} onClick={() => onChange(clamp(value - 1))}>
                <Minus className="size-4" strokeWidth={1.7} />
            </button>
            <input
                type="number"
                inputMode="numeric"
                aria-label={ariaLabel}
                min={min}
                max={max}
                value={value}
                onChange={(event) => onChange(clamp(Number(event.target.value)))}
                className="min-w-0 flex-1 border-0 bg-transparent text-center font-[family-name:var(--font-mono)] text-sm font-medium text-[color:var(--ink-900)] outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
            />
            <button type="button" className={button} aria-label="增加" disabled={value >= max} onClick={() => onChange(clamp(value + 1))}>
                <Plus className="size-4" strokeWidth={1.7} />
            </button>
        </div>
    );
}
