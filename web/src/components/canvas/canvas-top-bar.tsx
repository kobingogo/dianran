import { useWorkflowStore } from "@/stores/canvas/use-workflow-store";
import { CanvasSaveStatus } from "./canvas-save-status";
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { BookOpen, Bot, Download, Menu, PanelLeftClose, PanelLeftOpen, Pencil, Plus, Redo2, Trash2, Undo2, Upload } from "lucide-react";
import { Dropdown, Modal, Tooltip } from "antd";
import type { MenuProps } from "antd";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";

import { UserStatusActions } from "@/components/layout/user-status-actions";
import { BRAND } from "@/constant/brand";
import { DOCS_URL } from "@/constant/env";
import { isTypingTarget, useHelpShortcut } from "@/features/shortcuts/use-help-shortcut";
import { useIsMobile } from "@/hooks/use-is-mobile";
import { canvasThemes } from "@/lib/canvas-theme";
import { lastNonCanvasRoute } from "@/lib/canvas/last-non-canvas-route";
import { useAgentStore } from "@/stores/use-agent-store";
import { useCanvasSidePanelStore } from "@/stores/use-canvas-side-panel-store";
import { useThemeStore } from "@/stores/use-theme-store";

const flatIconButton =
    "shrink-0 place-items-center rounded-md transition hover:bg-black/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand)] dark:hover:bg-white/10";

export function CanvasTopBar({
    title,
    titleDraft,
    isTitleEditing,
    onTitleDraftChange,
    onStartTitleEditing,
    onFinishTitleEditing,
    onCancelTitleEditing,
    canUndo,
    canRedo,
    onCreateProject,
    onDeleteProject,
    onExportProject,
    onImportImage,
    onOpenPlugins,
    onUndo,
    onRedo,
    agentOpen,
    compactAgentStatus,
    onToggleAgent,
}: {
    title: string;
    titleDraft: string;
    isTitleEditing: boolean;
    onTitleDraftChange: (value: string) => void;
    onStartTitleEditing: () => void;
    onFinishTitleEditing: () => void;
    onCancelTitleEditing: () => void;
    canUndo: boolean;
    canRedo: boolean;
    onCreateProject: () => void;
    onDeleteProject: () => void;
    onExportProject: () => void;
    onImportImage: () => void;
    onOpenPlugins: () => void;
    onUndo: () => void;
    onRedo: () => void;
    agentOpen: boolean;
    compactAgentStatus: { connected: boolean; enabled: boolean; activity: string };
    onToggleAgent: () => void;
}) {
    const colorTheme = useThemeStore((state) => state.theme);
    const { t } = useTranslation();
    const theme = canvasThemes[colorTheme];
    const navigate = useNavigate();
    const mobile = useIsMobile();
    const titleRef = useRef<HTMLDivElement>(null);
    const [shortcutsOpen, setShortcutsOpen] = useState(false);
    const sidePanelOpen = useCanvasSidePanelStore((state) => state.panelOpen);
    const toggleSidePanel = useCanvasSidePanelStore((state) => state.togglePanel);
    const agentToken = useAgentStore((state) => state.token);
    const agentConfigured = compactAgentStatus.connected || compactAgentStatus.enabled || Boolean(agentToken.trim());
    // [dianran] "?" opens the shortcut panel.
    useHelpShortcut(() => setShortcutsOpen(true));

    const goBack = useCallback(() => navigate(lastNonCanvasRoute()), [navigate]);
    const goHome = useCallback(() => navigate("/"), [navigate]);

    useEffect(() => {
        if (!isTitleEditing) return;
        const close = (event: PointerEvent) => {
            if (titleRef.current?.contains(event.target as Node)) return;
            onFinishTitleEditing();
        };
        document.addEventListener("pointerdown", close, true);
        return () => document.removeEventListener("pointerdown", close, true);
    }, [isTitleEditing, onFinishTitleEditing]);

    // First Escape keeps the canvas handler (clear selection, close menus). A second
    // press within 800ms, or Ctrl/Cmd+[, leaves. Inputs and open overlays do neither.
    useEffect(() => {
        let lastEsc = 0;
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.repeat || event.isComposing || exitShortcutBlocked(event)) return;
            const chord = (event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && event.code === "BracketLeft";
            if (chord) {
                event.preventDefault();
                lastEsc = 0;
                goBack();
                return;
            }
            if (event.key !== "Escape" || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey || event.defaultPrevented) return;
            const now = performance.now();
            if (lastEsc && now - lastEsc <= 800) {
                lastEsc = 0;
                goBack();
                return;
            }
            lastEsc = now;
        };
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, [goBack]);

    const actionItems: MenuProps["items"] = [
        { key: "new", icon: <Plus className="size-4" />, label: t("canvas.create"), onClick: onCreateProject },
        { key: "delete", danger: true, icon: <Trash2 className="size-4" />, label: t("canvas.deleteCurrent"), onClick: onDeleteProject },
        { type: "divider" },
        { key: "import", icon: <Upload className="size-4" />, label: t("canvas.importAsset"), onClick: onImportImage },
        { key: "export", icon: <Download className="size-4" />, label: t("canvas.exportCurrent"), onClick: onExportProject },
        { type: "divider" },
        { key: "undo", disabled: !canUndo, icon: <Undo2 className="size-4" />, label: <MenuLabel text={t("canvas.undo")} shortcut="⌘ Z" />, onClick: onUndo },
        { key: "redo", disabled: !canRedo, icon: <Redo2 className="size-4" />, label: <MenuLabel text={t("canvas.redo")} shortcut="⌘ ⇧ Z / ⌘ Y" />, onClick: onRedo },
    ];
    const menuItems: MenuProps["items"] = [
        ...(DOCS_URL
            ? [
                  { key: "docs", icon: <BookOpen className="size-4" />, label: t("canvas.docs"), onClick: () => window.open(DOCS_URL, "_blank", "noopener,noreferrer") },
                  { type: "divider" as const },
              ]
            : []),
        ...(actionItems ?? []),
    ];
    const phoneItems: MenuProps["items"] = [
        {
            key: "panel",
            icon: sidePanelOpen ? <PanelLeftClose className="size-4" /> : <PanelLeftOpen className="size-4" />,
            label: sidePanelOpen ? t("canvas.collapsePanel") : t("canvas.expandPanel"),
            onClick: toggleSidePanel,
        },
        { key: "rename", icon: <Pencil className="size-4" />, label: t("canvas.project.rename"), onClick: onStartTitleEditing },
        { key: "image", label: t("navigation.image"), onClick: () => navigate("/image") },
        { key: "video", label: t("navigation.video"), onClick: () => navigate("/video") },
        { key: "agent", icon: <Bot className="size-4" />, label: agentConfigured ? agentStatusLabel(compactAgentStatus, t) : "Agent", onClick: onToggleAgent },
        { type: "divider" },
        ...(actionItems ?? []),
    ];

    const iconStyle = { color: theme.node.text };
    const modeClass = "rounded-md px-2.5 py-1 text-xs transition hover:bg-black/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand)] dark:hover:bg-white/10";

    return (
        <>
            <header
                className="absolute inset-x-0 top-0 z-[80] flex h-[60px] items-center gap-2 px-2 md:px-4"
                style={{ background: theme.toolbar.panel, borderBottom: `1px solid ${theme.toolbar.border}`, backdropFilter: "blur(8px)" }}
            >
                <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
                    <div className="flex shrink-0 items-center gap-2.5">
                        <button
                            type="button"
                            onClick={goHome}
                            aria-label={t("canvas.goHome")}
                            title={t("canvas.goHome")}
                            className="grid size-[30px] place-items-center rounded-[6px] text-[10.5px] font-bold leading-none text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand)]"
                            style={{
                                background: "var(--brand)",
                                writingMode: "vertical-rl",
                                fontFamily: '"Songti SC","Noto Serif SC","Source Han Serif SC",serif',
                                letterSpacing: "0.08em",
                                boxShadow: "inset 0 0 0 1.5px rgba(255,240,230,.7)",
                            }}
                        >
                            {BRAND.nameZh}
                        </button>
                        <button
                            type="button"
                            onClick={goBack}
                            aria-label={t("canvas.back")}
                            title={`${t("canvas.back")}（Esc Esc / ⌘[）`}
                            className="inline-flex h-10 items-center pr-0.5 text-[13px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand)]"
                            style={{ color: theme.node.label }}
                        >
                            ‹ {t("canvas.back")}
                        </button>
                    </div>

                    <div className="hidden md:contents">
                        <Tooltip title={sidePanelOpen ? t("canvas.collapsePanel") : t("canvas.expandPanel")}>
                            <button
                                type="button"
                                onClick={toggleSidePanel}
                                aria-label={sidePanelOpen ? t("canvas.collapsePanel") : t("canvas.expandPanel")}
                                className={`${flatIconButton} grid size-7`}
                                style={iconStyle}
                            >
                                {sidePanelOpen ? <PanelLeftClose className="size-4" /> : <PanelLeftOpen className="size-4" />}
                            </button>
                        </Tooltip>
                    </div>

                    <div ref={titleRef} className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden">
                        <button type="button" className="hidden shrink-0 text-sm md:inline" style={{ color: theme.node.muted }} onClick={() => navigate("/canvas")}>
                            {t("canvas.projects")}
                        </button>
                        <span className="hidden shrink-0 text-sm md:inline" style={{ color: theme.node.faint }} aria-hidden>
                            /
                        </span>
                        {isTitleEditing ? (
                            <input
                                autoFocus
                                value={titleDraft}
                                aria-label={t("canvas.project.rename")}
                                onChange={(event) => onTitleDraftChange(event.target.value)}
                                onBlur={onFinishTitleEditing}
                                onKeyDown={(event) => {
                                    if (event.key === "Enter") onFinishTitleEditing();
                                    if (event.key === "Escape") {
                                        event.stopPropagation();
                                        onCancelTitleEditing();
                                    }
                                }}
                                className="min-w-0 w-[140px] max-w-[46vw] bg-transparent p-0 text-left text-base font-semibold tracking-normal outline-none md:max-w-[220px] md:text-lg"
                                style={{ color: theme.node.text }}
                            />
                        ) : (
                            <button
                                type="button"
                                className="min-w-0 max-w-[46vw] truncate border-b border-dashed border-transparent text-left text-base font-semibold tracking-normal transition hover:border-current md:max-w-[220px] md:text-lg xl:max-w-[280px]"
                                style={{ color: theme.node.text }}
                                onDoubleClick={onStartTitleEditing}
                                title={`${title} · ${t("canvas.renameHint")}`}
                            >
                                {title}
                            </button>
                        )}
                        {isTitleEditing ? null : (
                            <button
                                type="button"
                                aria-label={t("canvas.project.rename")}
                                title={t("canvas.renameHint")}
                                onClick={onStartTitleEditing}
                                className={`${flatIconButton} hidden size-7 md:grid`}
                                style={{ color: theme.node.faint }}
                            >
                                <Pencil className="size-3.5" />
                            </button>
                        )}
                        <CanvasSaveStatus />
                        <button type="button" className="shrink-0 rounded px-2 py-1 text-xs hover:bg-black/5 dark:hover:bg-white/10" style={{ color: theme.node.muted }} onClick={() => useWorkflowStore.setState({ panelOpen: true })}>工作流</button>
                    </div>
                </div>

                <div className="hidden shrink-0 items-center gap-0.5 md:flex" role="radiogroup" aria-label={t("canvas.workbench")}>
                    <button type="button" role="radio" aria-checked="true" className={modeClass} style={{ background: theme.toolbar.activeBg, color: theme.toolbar.activeText }}>
                        {t("navigation.canvas")}
                    </button>
                    <button type="button" role="radio" aria-checked="false" className={modeClass} style={{ color: theme.node.muted }} onClick={() => navigate("/image")}>
                        {t("navigation.image")}
                    </button>
                    <button type="button" role="radio" aria-checked="false" className={modeClass} style={{ color: theme.node.muted }} onClick={() => navigate("/video")}>
                        {t("navigation.video")}
                    </button>
                </div>

                <div className="flex shrink-0 items-center justify-end gap-1 md:min-w-0 md:flex-1">
                    {mobile ? (
                        <UserStatusActions variant="canvas" menuOnly extraItems={phoneItems} onOpenShortcuts={() => setShortcutsOpen(true)} onOpenPlugins={onOpenPlugins} />
                    ) : (
                        <>
                            <Dropdown trigger={["click"]} menu={{ items: menuItems }}>
                                <button type="button" className={`${flatIconButton} grid size-7`} style={iconStyle} aria-label={t("canvas.openMenu")}>
                                    <Menu className="size-4" />
                                </button>
                            </Dropdown>
                            {agentConfigured ? <CompactAgentStatus status={compactAgentStatus} onClick={onToggleAgent} /> : null}
                            <UserStatusActions variant="canvas" onOpenShortcuts={() => setShortcutsOpen(true)} onOpenPlugins={onOpenPlugins} />
                            <span className="mx-0.5 h-4 w-px" style={{ background: theme.toolbar.border }} aria-hidden />
                            <button
                                type="button"
                                aria-label={t("canvas.openAgent")}
                                aria-pressed={agentOpen}
                                title={t("canvas.openAgent")}
                                onClick={onToggleAgent}
                                className="inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-xs font-medium transition hover:bg-black/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand)] dark:hover:bg-white/10"
                                style={{ color: theme.node.text, background: agentOpen ? theme.toolbar.activeBg : "transparent" }}
                            >
                                <Bot className="size-4" />
                                Agent
                            </button>
                        </>
                    )}
                </div>
            </header>
            <Modal title={t("canvas.shortcuts")} open={shortcutsOpen} onCancel={() => setShortcutsOpen(false)} footer={null} centered>
                <div className="space-y-2 border-t pt-4 text-sm" style={{ borderColor: theme.node.stroke }}>
                    <Shortcut keys={["Ctrl / Space", t("canvas.shortcut.drag")]} value={t("canvas.shortcut.toggleTool")} />
                    <Shortcut keys={[t("canvas.shortcut.wheel")]} value={t("canvas.shortcut.zoom")} />
                    <Shortcut keys={[t("canvas.shortcut.zoomSlider")]} value={t("canvas.shortcut.preciseZoom")} />
                    <Shortcut keys={[t("canvas.shortcut.drag")]} value={t("canvas.shortcut.boxSelect")} />
                    <Shortcut keys={["Shift / Cmd", t("canvas.shortcut.click")]} value={t("canvas.shortcut.addSelection")} />
                    <Shortcut keys={["Ctrl / Cmd", "A"]} value={t("canvas.shortcut.selectAll")} />
                    <Shortcut keys={["Ctrl / Cmd", "C / V"]} value={t("canvas.shortcut.copyPaste")} />
                    <Shortcut keys={["Ctrl / Cmd", "G"]} value={t("canvas.shortcut.group")} />
                    <Shortcut keys={["Ctrl / Cmd", "Shift", "G"]} value={t("canvas.shortcut.ungroup")} />
                    <Shortcut keys={["Ctrl / Cmd", "Z"]} value={t("canvas.undo")} />
                    <Shortcut keys={["Ctrl / Cmd", "Shift", "Z"]} value={t("canvas.redo")} />
                    <Shortcut keys={["Ctrl / Cmd", "Y"]} value={t("canvas.redo")} />
                    <Shortcut keys={["Delete / Backspace"]} value={t("canvas.shortcut.delete")} />
                    <Shortcut keys={["Esc"]} value={t("canvas.shortcut.escape")} />
                    <Shortcut keys={["Esc", "Esc"]} value={t("canvas.shortcut.back")} />
                    <Shortcut keys={["Ctrl / ⌘", "["]} value={t("canvas.shortcut.back")} />
                    <Shortcut keys={[t("canvas.shortcut.dropMedia")]} value={t("canvas.shortcut.upload")} />
                    <Shortcut keys={["?"]} value={t("canvas.shortcut.help")} />
                </div>
            </Modal>
        </>
    );
}

function exitShortcutBlocked(event: KeyboardEvent) {
    if (isTypingTarget(event.target)) return true;
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest("[data-canvas-no-zoom],[data-canvas-shortcuts-ignore],.ant-modal,.ant-modal-wrap,.ant-drawer,.ant-image-preview,.ant-popover,.ant-dropdown,.ant-select-dropdown,[role='dialog'],[aria-modal='true']")) return true;
    return overlayOpen();
}

function overlayOpen() {
    const nodes = document.querySelectorAll(".ant-modal-wrap, .ant-drawer-open, .ant-image-preview-wrap, .ant-popover, .ant-dropdown, .ant-select-dropdown");
    for (const node of nodes) {
        if (!(node instanceof HTMLElement)) continue;
        if (node.classList.contains("ant-dropdown-hidden") || node.classList.contains("ant-popover-hidden") || node.classList.contains("ant-select-dropdown-hidden")) continue;
        const style = getComputedStyle(node);
        if (style.display === "none" || style.visibility === "hidden") continue;
        return true;
    }
    return false;
}

function agentStatusLabel(status: { connected: boolean; enabled: boolean; activity: string }, t: TFunction) {
    if (status.connected) return t("canvas.agentConnected");
    if (status.enabled) return t("canvas.agentConnecting", { activity: status.activity || t("canvas.connecting") });
    return t("canvas.agentDisconnected");
}

function MenuLabel({ text, shortcut }: { text: string; shortcut: string }) {
    return (
        <span className="flex min-w-36 items-center justify-between gap-8">
            <span>{text}</span>
            <span className="text-xs opacity-45">{shortcut}</span>
        </span>
    );
}

function CompactAgentStatus({ status, onClick }: { status: { connected: boolean; enabled: boolean; activity: string }; onClick: () => void }) {
    const colorTheme = useThemeStore((state) => state.theme);
    const theme = canvasThemes[colorTheme];
    const { t } = useTranslation();
    const label = agentStatusLabel(status, t);
    const quiet = !status.connected && !status.enabled;
    const color = status.connected ? "#16a34a" : status.enabled ? "#d97706" : theme.node.faint;
    return (
        <button type="button" className="flex h-8 max-w-[108px] items-center gap-1.5 text-xs transition hover:opacity-75 lg:max-w-[140px]" style={{ color }} onClick={onClick} aria-label={label} title={label}>
            <span className="size-1.5 shrink-0 rounded-full" style={{ background: quiet ? theme.node.faint : color }} />
            <span className="truncate">{label}</span>
        </button>
    );
}

function Shortcut({ keys, value }: { keys: string[]; value: string }) {
    return (
        <div className="grid grid-cols-[minmax(0,1fr)_120px] items-center gap-6 rounded-lg px-1 py-1.5">
            <span className="flex min-w-0 flex-wrap items-center gap-1.5">
                {keys.map((key, index) => (
                    <span key={`${key}-${index}`} className="flex items-center gap-1.5">
                        {index ? <span className="text-xs opacity-35">+</span> : null}
                        <kbd
                            className="min-w-9 rounded-md border px-2.5 py-1.5 text-center text-xs font-medium leading-none shadow-[inset_0_-1px_0_rgba(0,0,0,.08),0_1px_2px_rgba(0,0,0,.06)]"
                            style={{ borderColor: "rgba(120,113,108,.28)", background: "linear-gradient(#fff, rgba(245,245,244,.92))", color: "rgb(68,64,60)" }}
                        >
                            {key}
                        </kbd>
                    </span>
                ))}
            </span>
            <span className="text-right text-sm opacity-55">{value}</span>
        </div>
    );
}
