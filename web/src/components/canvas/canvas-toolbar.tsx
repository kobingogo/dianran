import type { CSSProperties, MouseEvent as ReactMouseEvent, ReactNode, RefObject } from "react";
import { useEffect, useRef, useState } from "react";
import { Button, Segmented, Switch, Tooltip } from "antd";
import { CircleDot, Eraser, Grid2x2, Group, Hand, Image as ImageIcon, Info, Moon, MoreHorizontal, MousePointer2, Music2, Palette, Plus, Puzzle, Redo2, Settings2, Square, Sun, Trash2, Type, Undo2, Upload, Video, X } from "lucide-react";
import { useParams } from "react-router-dom";

import { canvasThemes, type CanvasBackgroundMode, type CanvasColorTheme, type CanvasTheme } from "@/lib/canvas-theme";
import { getNodePluginId, listNodeDefinitions, useNodeRegistryVersion } from "@/lib/canvas/node-registry";
import { useThemeStore } from "@/stores/use-theme-store";
import { AnimatedThemeToggler } from "@/components/ui/animated-theme-toggler";
import { useTranslation } from "react-i18next";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { useWorkflowStore } from "@/stores/canvas/use-workflow-store";

const ICON = { className: "size-[18px]", strokeWidth: 1.7 } as const;

export function CanvasToolbar({
    selectedCount,
    canvasTool,
    canUndo,
    canRedo,
    backgroundMode,
    showImageInfo,
    onAddImage,
    onAddVideo,
    onAddAudio,
    onAddText,
    onAddConfig,
    onAddGroup,
    onAddExtensionNode,
    onUndo,
    onRedo,
    onUpload,
    onDelete,
    onClear,
    onCanvasToolChange,
    onBackgroundModeChange,
    onShowImageInfoChange,
}: {
    selectedCount: number;
    canvasTool: "select" | "pan";
    canUndo: boolean;
    canRedo: boolean;
    backgroundMode: CanvasBackgroundMode;
    showImageInfo: boolean;
    onAddImage: () => void;
    onAddVideo: () => void;
    onAddAudio: () => void;
    onAddText: () => void;
    onAddConfig: () => void;
    onAddGroup: () => void;
    onAddExtensionNode: (type: string) => void;
    onUndo: () => void;
    onRedo: () => void;
    onUpload: () => void;
    onDelete: () => void;
    onClear: () => void;
    onCanvasToolChange: (tool: "select" | "pan") => void;
    onBackgroundModeChange: (mode: CanvasBackgroundMode) => void;
    onShowImageInfoChange: (show: boolean) => void;
}) {
    const wrapRef = useRef<HTMLDivElement>(null);
    const { t } = useTranslation();
    const { id } = useParams();
    const [guideDismissed, setGuideDismissed] = useState(false);
    const isEmptyCanvas = useCanvasStore((state) => state.projects.find((project) => project.id === id)?.nodes.length === 0);
    useEffect(() => setGuideDismissed(false), [id]);
    const rootRef = useRef<HTMLDivElement>(null);
    const colorTheme = useThemeStore((state) => state.theme);
    const setTheme = useThemeStore((state) => state.setTheme);
    const theme = canvasThemes[colorTheme];
    const [hovered, setHovered] = useState<string | null>(null);
    const [appearanceOpen, setAppearanceOpen] = useState(false);
    const [extensionsOpen, setExtensionsOpen] = useState(false);
    const [moreOpen, setMoreOpen] = useState(false);
    const isDesktop = useIsDesktop();
    // Keep extension plugin nodes synchronized with registry changes.
    useNodeRegistryVersion();
    const extensionDefs = listNodeDefinitions().filter((def) => def.showInCreateMenu !== false && getNodePluginId(def.type) !== "builtin");
    const dockStyle = { background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.toolbar.item, boxShadow: "var(--sh-2)" };
    const hoverStyle = { background: theme.toolbar.itemHover, color: theme.toolbar.activeText };
    const activeStyle = { background: theme.toolbar.activeBg, color: theme.toolbar.activeText };

    // Close extension-node and canvas-appearance popovers when clicking outside the toolbar and its panels.
    useEffect(() => {
        if (!extensionsOpen && !appearanceOpen && !moreOpen) return;
        const handlePointerDown = (event: PointerEvent) => {
            if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
                setExtensionsOpen(false);
                setAppearanceOpen(false);
                setMoreOpen(false);
            }
        };
        document.addEventListener("pointerdown", handlePointerDown, true);
        return () => document.removeEventListener("pointerdown", handlePointerDown, true);
    }, [extensionsOpen, appearanceOpen, moreOpen]);

    const common = { hovered, hoverStyle, onHover: setHovered, vertical: isDesktop };
    const toggleExtensions = () => {
        setAppearanceOpen(false);
        setMoreOpen(false);
        setExtensionsOpen((value) => !value);
    };
    const toggleAppearance = () => {
        setExtensionsOpen(false);
        setMoreOpen(false);
        setAppearanceOpen((value) => !value);
    };
    // Tools that live in the phone 「更多」 sheet (desktop shows all of them in the 笔架).
    const moreTools: { id: string; label: string; icon: ReactNode; onClick: () => void; disabled?: boolean; danger?: boolean }[] = [
        { id: "tool-undo", label: t("canvas.undo"), icon: <Undo2 {...ICON} />, onClick: onUndo, disabled: !canUndo },
        { id: "tool-redo", label: t("canvas.redo"), icon: <Redo2 {...ICON} />, onClick: onRedo, disabled: !canRedo },
        { id: "tool-audio", label: t("canvas.toolbar.audio"), icon: <Music2 {...ICON} />, onClick: onAddAudio },
        { id: "tool-config", label: t("canvas.toolbar.config"), icon: <Settings2 {...ICON} />, onClick: onAddConfig },
        { id: "tool-group", label: t("canvas.toolbar.group"), icon: <Group {...ICON} />, onClick: onAddGroup },
        ...(extensionDefs.length ? [{ id: "tool-extensions", label: t("canvas.toolbar.extensions"), icon: <Puzzle {...ICON} />, onClick: toggleExtensions }] : []),
        { id: "tool-style", label: t("canvas.toolbar.appearance"), icon: <Palette {...ICON} />, onClick: toggleAppearance },
        ...(selectedCount ? [{ id: "tool-delete", label: t("canvas.deleteSelected"), icon: <Trash2 {...ICON} />, onClick: onDelete, danger: true }] : []),
        { id: "tool-clear", label: t("canvas.toolbar.clear"), icon: <Eraser {...ICON} />, onClick: onClear, danger: true },
    ];

    return (
        <div
            ref={rootRef}
            className="pointer-events-none absolute bottom-3 left-2 right-2 z-[60] flex justify-center md:bottom-auto md:left-3 md:right-auto md:top-1/2 md:-translate-y-1/2"
            onMouseDown={(event) => event.stopPropagation()}
        >
            <div
                ref={wrapRef}
                role="toolbar"
                aria-label="笔架"
                aria-orientation={isDesktop ? "vertical" : "horizontal"}
                className="pointer-events-auto flex h-14 max-w-full items-center justify-between gap-0.5 rounded-[var(--r-lg)] border px-2 backdrop-blur max-md:w-full md:h-auto md:w-12 md:flex-col md:justify-start md:gap-1 md:px-1.5 md:py-2 [&>*]:shrink-0"
                style={dockStyle}
            >
                <ToolbarButton id={`tool-${canvasTool}`} label={t(`canvas.toolbar.${canvasTool}`)} active activeStyle={activeStyle} {...common} onClick={() => onCanvasToolChange(canvasTool === "select" ? "pan" : "select")}>
                    {canvasTool === "select" ? <MousePointer2 {...ICON} /> : <Hand {...ICON} />}
                </ToolbarButton>
                {isDesktop ? (
                    <>
                        <ToolbarButton id="tool-undo" label={t("canvas.undo")} disabled={!canUndo} {...common} onClick={onUndo}>
                            <Undo2 {...ICON} />
                        </ToolbarButton>
                        <ToolbarButton id="tool-redo" label={t("canvas.redo")} disabled={!canRedo} {...common} onClick={onRedo}>
                            <Redo2 {...ICON} />
                        </ToolbarButton>
                        <Divider theme={theme} />
                    </>
                ) : null}
                <ToolbarButton id="tool-text" label={t("canvas.toolbar.text")} {...common} onClick={onAddText}>
                    <Type {...ICON} />
                </ToolbarButton>
                <ToolbarButton id="tool-image" label={t("canvas.toolbar.image")} {...common} onClick={onAddImage}>
                    <ImageIcon {...ICON} />
                </ToolbarButton>
                <ToolbarButton id="tool-video" label={t("canvas.toolbar.video")} {...common} onClick={onAddVideo}>
                    <Video {...ICON} />
                </ToolbarButton>
                {isDesktop ? (
                    <>
                        <ToolbarButton id="tool-audio" label={t("canvas.toolbar.audio")} {...common} onClick={onAddAudio}>
                            <Music2 {...ICON} />
                        </ToolbarButton>
                        <ToolbarButton id="tool-config" label={t("canvas.toolbar.config")} {...common} onClick={onAddConfig}>
                            <Settings2 {...ICON} />
                        </ToolbarButton>
                        <ToolbarButton id="tool-group" label={t("canvas.toolbar.group")} {...common} onClick={onAddGroup}>
                            <Group {...ICON} />
                        </ToolbarButton>
                        {extensionDefs.length ? (
                            <ToolbarButton id="tool-extensions" label={t("canvas.toolbar.extensions")} active={extensionsOpen} activeStyle={activeStyle} {...common} onClick={toggleExtensions}>
                                <Puzzle {...ICON} />
                            </ToolbarButton>
                        ) : null}
                    </>
                ) : null}
                <ToolbarButton id="tool-upload" label={t("canvas.toolbar.upload")} {...common} onClick={onUpload}>
                    <Upload {...ICON} />
                </ToolbarButton>
                {isDesktop ? (
                    <>
                        <Divider theme={theme} />
                        <ToolbarButton id="tool-style" label={t("canvas.toolbar.appearance")} active={appearanceOpen} activeStyle={activeStyle} {...common} onClick={toggleAppearance}>
                            <Palette {...ICON} />
                        </ToolbarButton>
                        {selectedCount ? (
                            <ToolbarButton id="tool-delete" label={t("canvas.deleteSelected")} {...common} onClick={onDelete} danger>
                                <Trash2 {...ICON} />
                            </ToolbarButton>
                        ) : null}
                        <ToolbarButton id="tool-clear" label={t("canvas.toolbar.clear")} {...common} onClick={onClear} danger>
                            <Eraser {...ICON} />
                        </ToolbarButton>
                    </>
                ) : (
                    <ToolbarButton
                        id="tool-more"
                        label="更多工具"
                        active={moreOpen}
                        activeStyle={activeStyle}
                        {...common}
                        onClick={() => {
                            setExtensionsOpen(false);
                            setAppearanceOpen(false);
                            setMoreOpen((value) => !value);
                        }}
                    >
                        <MoreHorizontal {...ICON} />
                    </ToolbarButton>
                )}
            </div>

            {moreOpen && !isDesktop ? (
                <div role="menu" aria-label="更多工具" className="pointer-events-auto absolute bottom-[68px] left-0 right-0 z-30 grid grid-cols-4 gap-1 rounded-[var(--r-lg)] border p-2 shadow-[var(--sh-2)] backdrop-blur" style={{ background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.toolbar.item }}>
                    {moreTools.map((tool) => (
                        <button
                            key={tool.id}
                            type="button"
                            role="menuitem"
                            disabled={tool.disabled}
                            className="flex min-h-14 cursor-pointer flex-col items-center justify-center gap-1 rounded-[var(--r-sm)] border-0 bg-transparent text-[11.5px] disabled:cursor-not-allowed disabled:opacity-35"
                            style={{ color: tool.danger ? "var(--err)" : theme.toolbar.item }}
                            onClick={() => {
                                if (tool.id !== "tool-extensions" && tool.id !== "tool-style") setMoreOpen(false);
                                tool.onClick();
                            }}
                        >
                            {tool.icon}
                            {tool.label}
                        </button>
                    ))}
                </div>
            ) : null}

            {extensionsOpen && extensionDefs.length ? (
                <div
                    className="thin-scrollbar pointer-events-auto absolute bottom-[72px] left-1/2 z-30 max-h-[50vh] w-[240px] -translate-x-1/2 overflow-y-auto rounded-[var(--r-lg)] border p-2 shadow-[var(--sh-2)] backdrop-blur md:bottom-auto md:left-[60px] md:top-0 md:translate-x-0"
                    style={{ background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.toolbar.item }}
                >
                    <div className="px-1.5 pb-1.5 text-[11px] font-medium opacity-50">{t("canvas.toolbar.extensions")}</div>
                    <div className="grid gap-0.5">
                        {extensionDefs.map((def) => (
                            <button
                                key={def.type}
                                type="button"
                                className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-sm transition"
                                style={{ color: theme.toolbar.item }}
                                onMouseEnter={(event) => (event.currentTarget.style.background = theme.toolbar.itemHover)}
                                onMouseLeave={(event) => (event.currentTarget.style.background = "transparent")}
                                onClick={() => {
                                    onAddExtensionNode(def.type);
                                    setExtensionsOpen(false);
                                }}
                            >
                                <span className="grid size-7 shrink-0 place-items-center rounded-md text-base" style={{ background: theme.toolbar.itemHover }}>
                                    {def.icon}
                                </span>
                                <span className="min-w-0 flex-1 truncate">{def.title}</span>
                            </button>
                        ))}
                    </div>
                </div>
            ) : null}

            {appearanceOpen ? (
                <div
                    className="pointer-events-auto absolute bottom-[72px] left-1/2 z-30 w-[248px] -translate-x-1/2 rounded-[var(--r-lg)] border p-2.5 shadow-[var(--sh-2)] backdrop-blur md:bottom-auto md:left-[60px] md:top-0 md:translate-x-0"
                    style={{ background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.toolbar.item }}
                >
                    <div className="px-1 pb-2 text-sm font-medium opacity-65">{t("canvas.toolbar.appearance")}</div>
                    <div className="px-1 pb-1.5 text-[11px] font-medium opacity-50">{t("canvas.toolbar.themeMode")}</div>
                    <div className="grid grid-cols-2 gap-1 rounded-lg p-1" style={{ background: theme.toolbar.itemHover }}>
                        <CanvasThemeButton colorTheme={colorTheme} targetTheme="light" onThemeChange={setTheme}>
                            <Sun className="size-4" />
                            {t("canvas.toolbar.light")}
                        </CanvasThemeButton>
                        <CanvasThemeButton colorTheme={colorTheme} targetTheme="dark" onThemeChange={setTheme}>
                            <Moon className="size-4" />
                            {t("canvas.toolbar.dark")}
                        </CanvasThemeButton>
                    </div>
                    <div className="mt-3 px-1 pb-1.5 text-[11px] font-medium opacity-50">{t("canvas.toolbar.gridStyle")}</div>
                    <Segmented
                        className="w-full !p-1 [&_.ant-segmented-group]:!flex [&_.ant-segmented-item]:!min-h-8 [&_.ant-segmented-item]:!flex-1 [&_.ant-segmented-item-label]:!min-h-8 [&_.ant-segmented-item-label]:!leading-8"
                        value={backgroundMode}
                        onChange={(value) => onBackgroundModeChange(value as CanvasBackgroundMode)}
                        options={[
                            {
                                value: "dots",
                                label: (
                                    <span className="inline-flex items-center gap-1.5">
                                        <CircleDot className="size-4" />{t("canvas.toolbar.dots")}
                                    </span>
                                ),
                            },
                            {
                                value: "lines",
                                label: (
                                    <span className="inline-flex items-center gap-1.5">
                                        <Grid2x2 className="size-4" />{t("canvas.toolbar.lines")}
                                    </span>
                                ),
                            },
                            {
                                value: "blank",
                                label: (
                                    <span className="inline-flex items-center gap-1.5">
                                        <Square className="size-4" />
                                        {t("canvas.toolbar.blank")}
                                    </span>
                                ),
                            },
                        ]}
                    />
                    <div className="mt-3 flex items-center justify-between gap-3 rounded-lg px-1.5 py-1">
                        <span className="inline-flex min-w-0 items-center gap-1.5 text-[11px] font-medium opacity-65">
                            <Info className="size-3.5" />
                            {t("canvas.toolbar.imageInfo")}
                        </span>
                        <Switch size="small" checked={showImageInfo} onChange={onShowImageInfoChange} />
                    </div>
                </div>
            ) : null}

            {isEmptyCanvas && !guideDismissed ? (
                <section
                    aria-labelledby="canvas-empty-guide-title"
                    className="pointer-events-auto fixed left-1/2 top-16 z-20 w-[min(34rem,calc(100vw-1.5rem))] -translate-x-1/2 rounded-[var(--r-lg)] border p-3 shadow-[var(--sh-2)] backdrop-blur sm:p-4 md:absolute md:top-16"
                    style={{ background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.toolbar.item }}
                >
                    <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                            <h2 id="canvas-empty-guide-title" className="text-sm font-medium">{t("canvas.emptyGuide.title")}</h2>
                            <p className="mt-1 text-xs opacity-65">{t("canvas.emptyGuide.description")}</p>
                        </div>
                        <button type="button" aria-label={t("canvas.emptyGuide.dismiss")} title={t("canvas.emptyGuide.dismiss")} className="grid size-7 shrink-0 place-items-center rounded-md opacity-60 transition hover:bg-black/5 hover:opacity-100 dark:hover:bg-white/10" onClick={() => setGuideDismissed(true)}>
                            <X className="size-4" />
                        </button>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-xs">
                        <GuideAction icon={<Type className="size-4" />} label={t("canvas.toolbar.text")} onClick={onAddText} />
                        <GuideAction icon={<ImageIcon className="size-4" />} label={t("canvas.toolbar.image")} onClick={onAddImage} />
                        <GuideAction icon={<Settings2 className="size-4" />} label={t("canvas.toolbar.config")} onClick={onAddConfig} />
                        <GuideAction icon={<Plus className="size-4" />} label={t("canvas.emptyGuide.workflow")} onClick={() => useWorkflowStore.setState({ panelOpen: true })} />
                    </div>
                </section>
            ) : null}
        </div>
    );
}

function ToolbarButton({
    id,
    label,
    active,
    hovered,
    activeStyle,
    hoverStyle,
    vertical,
    onHover,
    onClick,
    disabled = false,
    danger = false,
    children,
}: {
    id: string;
    label: string;
    active?: boolean;
    hovered: string | null;
    activeStyle?: CSSProperties;
    hoverStyle: CSSProperties;
    vertical: boolean;
    onHover: (id: string | null) => void;
    onClick?: (event: ReactMouseEvent<HTMLElement>) => void;
    disabled?: boolean;
    danger?: boolean;
    children: ReactNode;
}) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];

    return (
        <Tooltip title={label} placement={vertical ? "right" : "top"} mouseEnterDelay={0.25}>
            <Button
                type="text"
                aria-label={label}
                title={label}
                aria-pressed={active ? true : undefined}
                className="!h-9 !w-9 !min-w-9 !rounded-[10px] !p-0"
                disabled={disabled}
                style={active ? activeStyle : hovered === id && !disabled ? hoverStyle : { color: danger ? "var(--err)" : theme.toolbar.item, opacity: disabled ? 0.35 : 1 }}
                icon={children}
                onMouseEnter={() => onHover(id)}
                onMouseLeave={() => onHover(null)}
                onClick={onClick}
            />
        </Tooltip>
    );
}

function GuideAction({ icon, label, onClick }: { icon: ReactNode; label: string; onClick: () => void }) {
    return (
        <button type="button" className="inline-flex min-h-8 items-center gap-1.5 rounded-md bg-transparent px-1 text-left transition hover:opacity-70" onClick={onClick}>
            {icon}
            <span>{label}</span>
        </button>
    );
}

function useIsDesktop() {
    const query = "(min-width: 768px)";
    const [matches, setMatches] = useState(() => (typeof window === "undefined" ? true : window.matchMedia(query).matches));
    useEffect(() => {
        const media = window.matchMedia(query);
        const update = () => setMatches(media.matches);
        update();
        media.addEventListener("change", update);
        return () => media.removeEventListener("change", update);
    }, []);
    return matches;
}

function Divider({ theme }: { theme: CanvasTheme }) {
    return <div aria-hidden className="mx-1 h-6 w-px md:mx-0 md:my-1 md:h-px md:w-6" style={{ background: theme.toolbar.border }} />;
}

function CanvasThemeButton({ colorTheme, targetTheme, onThemeChange, children }: { colorTheme: CanvasColorTheme; targetTheme: CanvasColorTheme; onThemeChange: (theme: CanvasColorTheme) => void; children: ReactNode }) {
    const theme = canvasThemes[colorTheme];
    const active = colorTheme === targetTheme;
    const activeStyle = colorTheme === "light" ? { background: "#111111", color: "#ffffff" } : { background: theme.toolbar.activeBg, color: theme.toolbar.activeText };
    const { t } = useTranslation();
    const label = targetTheme === "dark" ? t("topNav.darkTheme") : t("topNav.lightTheme");

    return (
        <AnimatedThemeToggler
            theme={colorTheme}
            targetTheme={targetTheme}
            onThemeChange={onThemeChange}
            className="inline-flex h-8 min-w-0 items-center justify-center gap-1.5 rounded-md px-2 text-sm transition"
            style={active ? activeStyle : { color: theme.toolbar.item }}
            aria-label={label}
            title={label}
        >
            {children}
        </AnimatedThemeToggler>
    );
}
