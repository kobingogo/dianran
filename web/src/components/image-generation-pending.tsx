// [dianran] Replaced the upstream time-based fake progress bar with the real request phase + elapsed time.
import { GenerationStatus } from "@/features/tasks/generation-status";
import { cn } from "@/lib/utils";

export function ImageGenerationPending({ className, compact = false }: { className?: string; label?: string; compact?: boolean }) {
    return (
        <div className={cn("relative flex items-center justify-center overflow-hidden bg-stone-100 text-stone-500 dark:bg-white/10 dark:text-stone-300", compact ? "min-h-24" : "aspect-[4/3]", className)}>
            <GenerationStatus kind="image" variant="card" />
        </div>
    );
}
