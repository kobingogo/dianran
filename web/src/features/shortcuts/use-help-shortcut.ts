// [dianran] Press "?" (Shift + /) anywhere outside text inputs to open the shortcut panel.
import { useEffect, useRef } from "react";

export function isTypingTarget(target: EventTarget | null) {
    const element = target as HTMLElement | null;
    if (!element) return false;
    if (element.isContentEditable) return true;
    return Boolean(element.closest?.("input, textarea, select, [contenteditable='true'], .cm-editor, [data-canvas-shortcuts-ignore]"));
}

export function useHelpShortcut(onOpen: () => void) {
    const callback = useRef(onOpen);
    callback.current = onOpen;
    useEffect(() => {
        const handler = (event: KeyboardEvent) => {
            if (event.key !== "?" || event.metaKey || event.ctrlKey || event.altKey) return;
            if (isTypingTarget(event.target)) return;
            event.preventDefault();
            callback.current();
        };
        window.addEventListener("keydown", handler);
        return () => window.removeEventListener("keydown", handler);
    }, []);
}
