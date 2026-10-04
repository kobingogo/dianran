// Remembers the last page that is not a canvas editor, so the canvas back button
// can return there. The key is intentionally not under infinite-canvas:*.
const LAST_NON_CANVAS_ROUTE_KEY = "dianran:last-non-canvas-route";
const CANVAS_EDITOR_PATH = /^\/canvas\/[^/?#]+/;

let memoryRoute = "";

function isReturnableRoute(path: string) {
    if (!path.startsWith("/") || path.startsWith("//") || path.startsWith("/\\")) return false;
    const pathname = path.split(/[?#]/)[0] || "";
    return Boolean(pathname) && !CANVAS_EDITOR_PATH.test(pathname);
}

export function rememberNonCanvasRoute(pathname: string, search = "") {
    if (CANVAS_EDITOR_PATH.test(pathname)) return;
    // /canvas?mode=new|recent only auto-opens a canvas; returning there would create another one.
    if (pathname === "/canvas" && /(?:^|[?&])mode=(?:new|recent)(?:&|$)/.test(search)) return;
    const next = `${pathname}${search}`;
    if (!isReturnableRoute(next)) return;
    memoryRoute = next;
    try {
        sessionStorage.setItem(LAST_NON_CANVAS_ROUTE_KEY, next);
    } catch {
        // Private mode can reject sessionStorage; the module variable still works for this load.
    }
}

export function lastNonCanvasRoute() {
    try {
        const stored = sessionStorage.getItem(LAST_NON_CANVAS_ROUTE_KEY) || "";
        if (isReturnableRoute(stored)) return stored;
    } catch {
        // Fall through to the in-memory route.
    }
    if (isReturnableRoute(memoryRoute)) return memoryRoute;
    return "/canvas";
}
