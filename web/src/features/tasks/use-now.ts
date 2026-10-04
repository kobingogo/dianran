import { useEffect, useState } from "react";

/** Re-render every `interval` ms while `active`; returns Date.now(). */
export function useNow(active = true, interval = 1000) {
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        if (!active) return;
        const timer = window.setInterval(() => setNow(Date.now()), interval);
        return () => window.clearInterval(timer);
    }, [active, interval]);
    return now;
}
