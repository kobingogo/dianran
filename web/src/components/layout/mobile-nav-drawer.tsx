import { Drawer } from "antd";
import { Bot, Moon, Settings2, Sun } from "lucide-react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";

import { navigationTools, type NavigationToolSlug } from "@/constant/navigation-tools";
import { cn } from "@/lib/utils";
import { useAgentStore } from "@/stores/use-agent-store";
import { useConfigStore } from "@/stores/use-config-store";
import { useThemeStore } from "@/stores/use-theme-store";

type MobileNavDrawerProps = {
    open: boolean;
    activeToolSlug?: NavigationToolSlug;
    onClose: () => void;
};

export function MobileNavDrawer({ open, activeToolSlug, onClose }: MobileNavDrawerProps) {
    const { t } = useTranslation();
    const theme = useThemeStore((state) => state.theme);
    const setTheme = useThemeStore((state) => state.setTheme);
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);
    const toggleAgent = useAgentStore((state) => state.togglePanel);
    const agentOpen = useAgentStore((state) => state.panelOpen);
    const itemClass = "flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left text-base text-stone-600 transition hover:bg-stone-100 hover:text-stone-950 dark:text-stone-300 dark:hover:bg-stone-800 dark:hover:text-stone-100";
    // [dianran] Collapsed header on phones: the actions hidden from the top bar live here.
    const actions = [
        { key: "config", icon: Settings2, label: t("navigation.config"), onClick: () => openConfigDialog(false) },
        { key: "theme", icon: theme === "dark" ? Sun : Moon, label: t(theme === "dark" ? "topNav.lightTheme" : "topNav.darkTheme"), onClick: () => setTheme(theme === "dark" ? "light" : "dark") },
        { key: "agent", icon: Bot, label: t(agentOpen ? "topNav.closeAgent" : "topNav.openAgent"), onClick: toggleAgent },
    ];

    return (
        <Drawer title={t("topNav.navigation")} placement="left" size={280} open={open} onClose={onClose} className="md:hidden">
            <div className="space-y-1">
                {navigationTools.map((tool) => {
                    const Icon = tool.icon;
                    const active = tool.slug === activeToolSlug;
                    return (
                        <Link
                            key={tool.slug}
                            to={`/${tool.slug}`}
                            onClick={onClose}
                            className={cn(
                                "flex items-center gap-3 rounded-lg px-3 py-3 text-base transition",
                                active ? "bg-stone-100 font-medium text-stone-950 dark:bg-stone-800 dark:text-stone-100" : "text-stone-600 hover:bg-stone-100 hover:text-stone-950 dark:text-stone-300 dark:hover:bg-stone-800 dark:hover:text-stone-100",
                            )}
                        >
                            <Icon className="size-5" />
                            <span>{t(`navigation.${tool.slug}`)}</span>
                        </Link>
                    );
                })}
            </div>
            <div className="mt-4 space-y-1 border-t border-stone-200 pt-4 dark:border-stone-800" data-mobile-drawer-actions>
                {actions.map(({ key, icon: Icon, label, onClick }) => (
                    <button key={key} type="button" className={itemClass} onClick={() => (onClose(), onClick())}>
                        <Icon className="size-5" />
                        <span>{label}</span>
                    </button>
                ))}
            </div>
        </Drawer>
    );
}
