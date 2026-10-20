// [dianran] Lightweight placeholder while a lazily loaded page chunk downloads.
export function RouteFallback() {
    return (
        <div className="flex h-full w-full items-center justify-center" aria-busy="true">
            <span className="relative flex size-3">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--brand,#E8572A)] opacity-60" />
                <span className="relative inline-flex size-3 rounded-full bg-[var(--brand,#E8572A)]" />
            </span>
        </div>
    );
}
