import { useState } from "react";

import { cn } from "@/lib/utils";

const RATIO_NAMES: Record<string, string> = { "1:1": "方图", "3:4": "竖版", "4:3": "横版", "9:16": "手机", "16:9": "宽屏", "2:3": "竖版", "3:2": "横版", "21:9": "超宽", "9:21": "长图", "4:5": "竖版", "5:4": "横版" };

export function ratioName(ratio: string) {
    if (ratio === "auto") return "自动";
    return RATIO_NAMES[ratio] ? `${ratio} ${RATIO_NAMES[ratio]}` : ratio;
}

function RatioShape({ ratio }: { ratio: string }) {
    const match = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(ratio);
    if (!match) return <span className="grid h-[22px] place-items-center text-[13px] leading-none">A</span>;
    const value = Number(match[1]) / Number(match[2]);
    const width = value >= 1 ? 22 : Math.max(8, 22 * value);
    const height = value >= 1 ? Math.max(8, 22 / value) : 22;
    return (
        <span className="grid h-[22px] w-6 place-items-center">
            <i className="block rounded-[2px] border-[1.6px] border-current" style={{ width, height }} />
        </span>
    );
}

/**
 * PLAN 5.4 RatioPicker：图标块显示真实比例形状 + 文字；只渲染传入的比例，其余进「更多」。
 * 数字键 1–5 在面板获得焦点时切换前 5 个比例。
 */
export function RatioPicker({ value, primary, extra = [], allowAuto, onChange, ariaLabel = "比例", className }: { value: string; primary: string[]; extra?: string[]; allowAuto?: boolean; onChange: (ratio: string) => void; ariaLabel?: string; className?: string }) {
    const [moreOpen, setMoreOpen] = useState(() => extra.includes(value));
    const visible = [...primary, ...(moreOpen ? extra : [])];
    const columns = Math.min(5, Math.max(3, primary.length || 3));
    return (
        <div
            className={className}
            onMouseDown={(event) => event.stopPropagation()}
            onKeyDown={(event) => {
                const index = Number(event.key) - 1;
                if (index >= 0 && index < 5 && primary[index] && !(event.target instanceof HTMLInputElement)) {
                    event.preventDefault();
                    onChange(primary[index]);
                }
            }}
        >
            <div role="radiogroup" aria-label={ariaLabel} className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
                {visible.map((ratio) => {
                    const on = ratio === value;
                    const [code, name] = ratioName(ratio).split(" ");
                    return (
                        <button
                            key={ratio}
                            type="button"
                            role="radio"
                            aria-checked={on}
                            aria-label={ratioName(ratio)}
                            onClick={() => onChange(ratio)}
                            className={cn(
                                "flex h-[58px] min-w-0 cursor-pointer flex-col items-center justify-center gap-[5px] rounded-[var(--r-md)] border bg-[var(--paper-0)] px-0 text-[11px] leading-none tracking-tight transition-colors duration-[120ms]",
                                "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--zhu-500)]",
                                on ? "border-[var(--ink-900)] text-[color:var(--ink-900)] shadow-[inset_0_0_0_1px_var(--ink-900)]" : "border-[var(--line)] text-[color:var(--ink-500)] hover:border-[var(--line-strong)] hover:text-[color:var(--ink-900)]",
                            )}
                        >
                            <RatioShape ratio={ratio} />
                            <span className="whitespace-nowrap">
                                {code}
                                {name ? <span className="ml-0.5">{name}</span> : null}
                            </span>
                        </button>
                    );
                })}
            </div>
            {extra.length || allowAuto ? (
                <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                    {allowAuto ? (
                        <button type="button" role="radio" aria-checked={value === "auto"} onClick={() => onChange("auto")} className={cn("cursor-pointer rounded-md border px-2 py-0.5", value === "auto" ? "border-[var(--ink-900)] bg-[var(--ink-900)] text-[color:var(--paper-0)]" : "border-[var(--line)] bg-transparent text-[color:var(--ink-500)] hover:text-[color:var(--ink-900)]")}>
                            自动 · 由模型决定
                        </button>
                    ) : null}
                    {extra.length ? (
                        <button type="button" className="cursor-pointer border-0 bg-transparent p-0 text-[color:var(--ink-500)] hover:text-[color:var(--ink-900)]" aria-expanded={moreOpen} onClick={() => setMoreOpen(!moreOpen)}>
                            {moreOpen ? "收起更多比例" : `更多（${extra.join(" / ")}）`}
                        </button>
                    ) : null}
                </div>
            ) : null}
        </div>
    );
}
