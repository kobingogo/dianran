// [dianran] Phone layout breakpoint (< md / 768px), reactive to resizes and rotation.
import { useSyncExternalStore } from "react";

const QUERY = "(max-width: 767px)";

export const isMobileViewport = () => typeof window !== "undefined" && window.matchMedia(QUERY).matches;

export function useIsMobile() {
    return useSyncExternalStore(
        (onChange) => {
            const media = window.matchMedia(QUERY);
            media.addEventListener("change", onChange);
            return () => media.removeEventListener("change", onChange);
        },
        isMobileViewport,
        () => false,
    );
}
