import { type RefObject, useEffect, useLayoutEffect, useRef } from "react";
import { ImageIcon, List, Music2, Settings2, Video, X } from "lucide-react";
import { useTranslation } from "react-i18next";

import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";
import { listNodeDefinitions, useNodeRegistryVersion } from "@/lib/canvas/node-registry";
import { CanvasNodeType, type ConnectionHandle, type Position } from "@/types/canvas";

/**
 * [dianran] phase4: the create menus live inside the zoomed world layer, so they used to shrink/grow with the canvas zoom
 * (unreadable at 25%, huge at 300%) and could open off-screen near the bottom/right edge. Counter-scale them to a constant
 * screen size and nudge them back inside the viewport.
 */
function useScreenSpaceMenu(ref: RefObject<HTMLDivElement | null>, scale: number, x: number, y: number) {
    useLayoutEffect(() => {
        const el = ref.current;
        if (!el) return;
        const k = scale > 0 ? scale : 1;
        el.style.transformOrigin = "top left";
        el.style.transform = `scale(${1 / k})`;
        const rect = el.getBoundingClientRect();
        const margin = 12;
        let dx = 0;
        let dy = 0;
        if (rect.bottom > window.innerHeight - margin) dy = Math.max(window.innerHeight - margin - rect.bottom, margin - rect.top);
        if (rect.right > window.innerWidth - margin) dx = Math.max(window.innerWidth - margin - rect.right, margin - rect.left);
        el.style.transform = `translate(${dx / k}px, ${dy / k}px) scale(${1 / k})`;
    }, [ref, scale, x, y]);
}

export type PendingConnectionCreate = {
    connection: ConnectionHandle;
    position: Position;
};

export function ConnectionCreateMenu({
    pending,
    scale = 1,
    onCreate,
    onClose,
}: {
    pending: PendingConnectionCreate;
    scale?: number;
    onCreate: (type: CanvasNodeType.Image | CanvasNodeType.Text | CanvasNodeType.Config | CanvasNodeType.Video | CanvasNodeType.Audio) => void;
    onClose: () => void;
}) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const { t } = useTranslation();
    const menuRef = useRef<HTMLDivElement>(null);
    useScreenSpaceMenu(menuRef, scale, pending.position.x, pending.position.y);
    return (
        <div
            ref={menuRef}
            className="absolute z-[120] w-[300px] rounded-[18px] border p-3 shadow-2xl backdrop-blur"
            data-connection-create-menu
            style={{ left: pending.position.x, top: pending.position.y, background: theme.node.panel, borderColor: theme.node.stroke, color: theme.node.text }}
            onMouseDown={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
        >
            <div className="mb-2 flex items-center justify-between px-1">
                <span className="text-sm font-medium" style={{ color: theme.node.muted }}>
                    {t("canvas.createMenu.fromNode")}
                </span>
                <button type="button" className="grid size-7 place-items-center rounded-lg text-base opacity-55 transition hover:bg-white/10 hover:opacity-100" onClick={onClose} aria-label={t("canvas.createMenu.close")}>
                    ×
                </button>
            </div>
            <div className="grid gap-1">
                <ConnectionCreateOption theme={theme} icon={<List className="size-5" />} title={t("canvas.createMenu.text")} description={t("canvas.createMenu.textDescription")} onClick={() => onCreate(CanvasNodeType.Text)} />
                <ConnectionCreateOption theme={theme} icon={<ImageIcon className="size-5" />} title={t("canvas.createMenu.image")} onClick={() => onCreate(CanvasNodeType.Image)} />
                <ConnectionCreateOption theme={theme} icon={<Video className="size-5" />} title={t("canvas.createMenu.video")} onClick={() => onCreate(CanvasNodeType.Video)} />
                <ConnectionCreateOption theme={theme} icon={<Music2 className="size-5" />} title={t("canvas.createMenu.audio")} onClick={() => onCreate(CanvasNodeType.Audio)} />
                <ConnectionCreateOption theme={theme} icon={<Settings2 className="size-5" />} title={t("canvas.createMenu.config")} description={t("canvas.createMenu.configDescription")} onClick={() => onCreate(CanvasNodeType.Config)} />
            </div>
        </div>
    );
}

export function ConnectionCreateOption({ theme, icon, title, description, onClick }: { theme: (typeof canvasThemes)[keyof typeof canvasThemes]; icon: React.ReactNode; title: string; description?: string; onClick?: () => void }) {
    return (
        <button
            type="button"
            className="flex h-16 w-full cursor-pointer items-center gap-3 rounded-2xl px-3 text-left transition"
            style={{ color: theme.node.text }}
            onClick={onClick}
            onMouseEnter={(event) => (event.currentTarget.style.background = theme.node.fill)}
            onMouseLeave={(event) => (event.currentTarget.style.background = "transparent")}
        >
            <span className="grid size-11 shrink-0 place-items-center rounded-xl" style={{ background: theme.node.fill, color: theme.node.muted }}>
                {icon}
            </span>
            <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2 text-base font-semibold leading-5">{title}</span>
                {description ? (
                    <span className="mt-1 block truncate text-sm" style={{ color: theme.node.muted }}>
                        {description}
                    </span>
                ) : null}
            </span>
        </button>
    );
}

export function NodeCreateMenu({ position, scale = 1, onCreate, onClose }: { position: Position; scale?: number; onCreate: (type: string) => void; onClose: () => void }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const { t } = useTranslation();
    useNodeRegistryVersion();
    const menuRef = useRef<HTMLDivElement>(null);
    useScreenSpaceMenu(menuRef, scale, position.x, position.y);
    const definitions = listNodeDefinitions().filter((def) => def.showInCreateMenu !== false);
    // Close automatically when clicking outside the menu.
    useEffect(() => {
        const handlePointerDown = (event: PointerEvent) => {
            if (menuRef.current && !menuRef.current.contains(event.target as Node)) onClose();
        };
        document.addEventListener("pointerdown", handlePointerDown, true);
        return () => document.removeEventListener("pointerdown", handlePointerDown, true);
    }, [onClose]);
    return (
        <div
            ref={menuRef}
            className="absolute z-[120] max-h-[70vh] w-[300px] overflow-y-auto rounded-[18px] border p-3 shadow-2xl backdrop-blur thin-scrollbar"
            data-canvas-no-zoom
            style={{ left: position.x, top: position.y, background: theme.node.panel, borderColor: theme.node.stroke, color: theme.node.text }}
            onPointerDown={(event) => event.stopPropagation()}
        >
            <div className="mb-2 flex items-center justify-between px-1">
                <span className="text-sm font-medium" style={{ color: theme.node.muted }}>
                    {t("canvas.createMenu.select")}
                </span>
                <button type="button" className="grid size-7 place-items-center rounded-lg opacity-55 transition hover:opacity-100" onClick={onClose} aria-label={t("canvas.createMenu.close")}>
                    <X className="size-4" />
                </button>
            </div>
            <div className="grid gap-1">
                {definitions.map((def) => (
                    <ConnectionCreateOption key={def.type} theme={theme} icon={def.icon} title={def.title} description={def.description} onClick={() => onCreate(def.type)} />
                ))}
            </div>
        </div>
    );
}
