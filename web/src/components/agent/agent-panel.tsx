import { useState, type PointerEvent as ReactPointerEvent } from "react";
import { motion } from "motion/react";
import { useTranslation } from "react-i18next";

import { LocalAgentPanel } from "./local-agent-panel";
import { canvasThemes } from "@/lib/canvas-theme";
import { CANVAS_AGENT_PANEL_MOTION_MS, useAgentStore } from "@/stores/use-agent-store";
import { useThemeStore } from "@/stores/use-theme-store";
import { useIsMobile } from "@/hooks/use-is-mobile";
import { CreationConversationView } from "@/components/composer/creation-conversation";
import { InkButton } from "@/components/ui/ink-button";

const PANEL_MOTION_SECONDS = CANVAS_AGENT_PANEL_MOTION_MS / 1000;

export function AgentPanel() {
    const { t } = useTranslation();
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const storedWidth = useAgentStore((state) => state.width);
    // [dianran] Phones: the panel covers the screen instead of pushing the page sideways.
    const mobile = useIsMobile();
    const width = mobile ? window.innerWidth : storedWidth;
    const [resizing, setResizing] = useState(false);
    const panelMounted = useAgentStore((state) => state.panelMounted);
    const panelOpen = useAgentStore((state) => state.panelOpen);
    const panelClosing = useAgentStore((state) => state.panelClosing);
    const creation = useAgentStore((state) => state.creationContext);
    const activeTab = useAgentStore((state) => state.activeTab);
    const setAgentState = useAgentStore((state) => state.setAgentState);
    const startResize = (event: ReactPointerEvent<HTMLButtonElement>) => {
        event.preventDefault();
        const startX = event.clientX;
        const startWidth = storedWidth;
        let nextWidth = startWidth;
        const onMove = (moveEvent: PointerEvent) => {
            nextWidth = Math.min(760, Math.max(360, startWidth + startX - moveEvent.clientX));
            setAgentState({ width: nextWidth });
        };
        const onUp = () => {
            localStorage.setItem("canvas-agent-panel-width", String(nextWidth));
            window.removeEventListener("pointermove", onMove);
            window.removeEventListener("pointerup", onUp);
            setResizing(false);
        };
        setResizing(true);
        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", onUp);
    };

    if (!panelMounted) return null;

    return (
        <motion.div
            className={mobile ? "fixed inset-y-0 right-0 z-[90] flex h-dvh" : "relative z-[70] flex h-full shrink-0"}
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: panelOpen ? width + 1 : 0, opacity: panelOpen ? 1 : 0 }}
            transition={{ duration: resizing ? 0 : PANEL_MOTION_SECONDS, ease: [0.22, 1, 0.36, 1] }}
            style={{ overflow: "clip", pointerEvents: panelOpen && !panelClosing ? undefined : "none" }}
        >
            <motion.aside
                className="relative flex h-full shrink-0 flex-col border-l"
                data-canvas-shortcuts-ignore
                initial={{ x: 48 }}
                animate={{ x: panelClosing ? 28 : 0 }}
                transition={{ duration: resizing ? 0 : PANEL_MOTION_SECONDS, ease: [0.22, 1, 0.36, 1] }}
                style={{ width, background: theme.node.panel, borderColor: theme.node.stroke, color: theme.node.text }}
            >
                {!mobile ? <button type="button" className="absolute inset-y-0 left-0 z-40 w-4 -translate-x-1/2 cursor-col-resize" onPointerDown={startResize} aria-label={t("agent.panel.resize")} /> : null}
                {creation && activeTab === "chat" ? <>
                    <header className="flex shrink-0 items-center gap-2 px-4 py-3"><strong className="flex-1">创作讨论</strong><InkButton variant="ghost" size={32} onClick={() => setAgentState({ activeTab: "setup" })}>连接与设置</InkButton><InkButton variant="ghost" size={32} onClick={() => useAgentStore.getState().closePanel()}>收起</InkButton></header>
                    <div className="thin-scrollbar min-h-0 flex-1 overflow-y-auto px-4 py-2"><CreationConversationView scope={creation.scope} mode={creation.mode} /></div>
                    <div id="creation-panel-composer" className="max-h-[60dvh] shrink-0 overflow-y-auto border-t px-3 py-3" style={{ borderColor: theme.node.stroke }} />
                </> : null}
                {creation && activeTab !== "chat" ? <InkButton variant="ghost" size={32} onClick={() => setAgentState({ activeTab: "chat" })}>返回当前创作讨论</InkButton> : null}
                <LocalAgentPanel embedded headless={Boolean(creation && activeTab === "chat")} />
            </motion.aside>
        </motion.div>
    );
}
