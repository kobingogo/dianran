import { cn } from "@/lib/utils";

/** PLAN 5.4 InkLoader：墨点由中心向外晕开（scale + blur + opacity），reduced-motion 时只淡入淡出。 */
export function InkLoader({ size = 120, className }: { size?: number; className?: string }) {
    return (
        <span aria-hidden className={cn("relative inline-block", className)} style={{ width: size, height: size }}>
            <span className="ink-loader-dot absolute inset-0 rounded-full" />
            <span className="ink-loader-dot ink-loader-dot-late absolute inset-0 rounded-full" />
        </span>
    );
}
