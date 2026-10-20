import { Info } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/** PLAN 5.4 CapabilityNote：黛青提示条，说明按模型能力隐藏或调整了什么。 */
export function CapabilityNote({ children, className, tone = "dai" }: { children: ReactNode; className?: string; tone?: "dai" | "warn" }) {
    return (
        <div
            role="note"
            className={cn(
                "flex items-start gap-2 rounded-[var(--r-md)] px-3 py-2 text-xs leading-5",
                tone === "warn" ? "bg-[var(--zhu-100)] text-[color:var(--zhu-600)]" : "bg-[var(--dai-100)] text-[color:var(--dai-600)]",
                className,
            )}
        >
            <Info className="mt-0.5 size-3.5 shrink-0" strokeWidth={1.7} />
            <div className="min-w-0">{children}</div>
        </div>
    );
}
