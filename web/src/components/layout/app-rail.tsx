import type { LucideIcon } from "lucide-react";
import { FileText, Home, Image as ImageIcon, Images, ListChecks, Moon, Settings, Sparkles, Sun, Video, Waypoints } from "lucide-react";
import { Link, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";

import { BRAND } from "@/constant/brand";
import { AnimatedThemeToggler } from "@/components/ui/animated-theme-toggler";
import { UserStatusActions } from "@/components/layout/user-status-actions";
import { useIsMobile } from "@/hooks/use-is-mobile";
import { cn } from "@/lib/utils";
import { useActiveTaskCount, useTaskStore } from "@/features/tasks/task-store";
import { useAgentStore } from "@/stores/use-agent-store";
import { useThemeStore } from "@/stores/use-theme-store";

const SERIF = '"Noto Serif SC","Source Han Serif SC","Songti SC","STSong",serif';

export function isCanvasEditorPath(pathname: string) {
    return /^\/canvas\/[^/]+/.test(pathname);
}

export type ShellNavItem = {
    to: string;
    labelKey: "home" | "canvas" | "image" | "video" | "prompts" | "assets";
    icon: LucideIcon;
    isActive: (pathname: string) => boolean;
};

export const shellNavItems: ShellNavItem[] = [
    { to: "/", labelKey: "home", icon: Home, isActive: (pathname) => pathname === "/" },
    { to: "/canvas", labelKey: "canvas", icon: Waypoints, isActive: (pathname) => pathname === "/canvas" || pathname.startsWith("/canvas/") },
    { to: "/image", labelKey: "image", icon: ImageIcon, isActive: (pathname) => pathname.startsWith("/image") },
    { to: "/video", labelKey: "video", icon: Video, isActive: (pathname) => pathname.startsWith("/video") },
    { to: "/prompts", labelKey: "prompts", icon: FileText, isActive: (pathname) => pathname.startsWith("/prompts") },
    { to: "/assets", labelKey: "assets", icon: Images, isActive: (pathname) => pathname.startsWith("/assets") },
];

function itemClass(active: boolean, collapsed: boolean) {
    return cn(
        "relative flex shrink-0 flex-col items-center justify-center rounded-xl text-[#6B645A] transition-colors hover:text-[#1B1916] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#C8402A] dark:text-[#A69D8F] dark:hover:text-[#F1EBE0]",
        collapsed ? "size-10" : "w-16 gap-[3px] px-0 pb-1.5 pt-2 text-xs leading-none",
        active && "bg-[#ECE4D5] text-[#1B1916] hover:text-[#1B1916] dark:bg-[#2A2621] dark:text-[#F1EBE0] dark:hover:text-[#F1EBE0]",
    );
}

function ActiveMark({ collapsed }: { collapsed: boolean }) {
    return <span aria-hidden className={cn("pointer-events-none absolute w-[3px] rounded-[3px] bg-[#C8402A] dark:bg-[#D9573D]", collapsed ? "-left-2 top-2 bottom-2" : "-left-2.5 top-3 bottom-3")} />;
}

function CountBadge({ count, collapsed }: { count: number; collapsed: boolean }) {
    if (count <= 0) return null;
    return (
        <span className={cn("absolute flex h-4 min-w-4 items-center justify-center rounded-full bg-[#C8402A] px-1 text-[10px] font-medium leading-none text-white tabular-nums dark:bg-[#D9573D]", collapsed ? "left-5 top-0" : "right-1 top-0.5")}>
            {count > 99 ? "99+" : count}
        </span>
    );
}

export function AppRail() {
    const mobile = useIsMobile();
    const { t } = useTranslation();
    const { pathname } = useLocation();
    const collapsed = isCanvasEditorPath(pathname);
    const theme = useThemeStore((state) => state.theme);
    const setTheme = useThemeStore((state) => state.setTheme);
    const togglePanel = useAgentStore((state) => state.togglePanel);
    const panelOpen = useAgentStore((state) => state.panelOpen);
    const activeCount = useActiveTaskCount();
    const centerOpen = useTaskStore((state) => state.centerOpen);
    const setCenterOpen = useTaskStore((state) => state.setCenterOpen);
    if (mobile) return null;

    const zhu = theme === "dark" ? "#D9573D" : "#C8402A";
    const taskLabel = t("navigation.tasks");
    const agentLabel = "Agent";
    const themeLabel = t("rail.theme");

    return (
        <aside
            className={cn(
                "flex h-full min-h-0 shrink-0 flex-col items-center border-r border-[#E3DACA] bg-[rgba(251,248,242,0.7)] py-[18px] pb-3.5 dark:border-[#332E28] dark:bg-[rgba(23,21,18,0.7)]",
                collapsed ? "w-14 gap-1" : "w-[84px] gap-1",
            )}
        >
            <Link
                to="/"
                aria-label={t("rail.seal")}
                title={t("navigation.home")}
                className={cn(
                    "grid shrink-0 place-items-center bg-[#C8402A] font-bold leading-none text-[#FFF6EE] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#C8402A] dark:bg-[#D9573D]",
                    collapsed ? "mb-2.5 size-9 rounded-md text-[11px]" : "mb-[18px] size-11 rounded-[7px] text-[15px]",
                )}
                style={{
                    writingMode: "vertical-rl",
                    letterSpacing: collapsed ? "1px" : "2px",
                    fontFamily: SERIF,
                    boxShadow: `inset 0 0 0 ${collapsed ? "1.5px" : "2px"} rgba(255,240,230,.35), inset 0 0 0 ${collapsed ? "3px" : "4px"} ${zhu}, inset 0 0 0 ${collapsed ? "4px" : "5px"} rgba(255,240,230,.55)`,
                }}
            >
                {BRAND.nameZh}
            </Link>

            <nav className="thin-scrollbar flex min-h-0 w-full flex-1 flex-col items-center gap-2 overflow-y-auto" aria-label={t("topNav.navigation")}>
                {shellNavItems.map((item) => {
                    const Icon = item.icon;
                    const active = item.isActive(pathname);
                    const label = t(`navigation.${item.labelKey}`);
                    return (
                        <Link key={item.to} to={item.to} aria-label={label} aria-current={active ? "page" : undefined} title={label} className={itemClass(active, collapsed)}>
                            {active ? <ActiveMark collapsed={collapsed} /> : null}
                            <Icon className="size-[22px] shrink-0" strokeWidth={1.7} />
                            {collapsed ? null : <span>{label}</span>}
                        </Link>
                    );
                })}
            </nav>

            <div className="mt-2 flex w-full shrink-0 flex-col items-center gap-2">
                <button
                    type="button"
                    className={itemClass(centerOpen, collapsed)}
                    aria-label={activeCount > 0 ? t("tasks.running", { count: activeCount }) : taskLabel}
                    aria-expanded={centerOpen}
                    title={taskLabel}
                    onClick={() => setCenterOpen(!centerOpen)}
                >
                    {centerOpen ? <ActiveMark collapsed={collapsed} /> : null}
                    <ListChecks className="size-[22px] shrink-0" strokeWidth={1.7} />
                    {collapsed ? null : <span>{taskLabel}</span>}
                    <CountBadge count={activeCount} collapsed={collapsed} />
                </button>
                <button
                    type="button"
                    className={itemClass(panelOpen, collapsed)}
                    aria-label={t(panelOpen ? "topNav.closeAgent" : "topNav.openAgent")}
                    aria-pressed={panelOpen}
                    title={agentLabel}
                    onClick={togglePanel}
                >
                    {panelOpen ? <ActiveMark collapsed={collapsed} /> : null}
                    <Sparkles className="size-[22px] shrink-0" strokeWidth={1.7} />
                    {collapsed ? null : <span>{agentLabel}</span>}
                </button>
                <Link to="/config" aria-label={t("navigation.config")} aria-current={pathname.startsWith("/config") ? "page" : undefined} title={t("navigation.config")} className={itemClass(pathname.startsWith("/config"), collapsed)}>
                    {pathname.startsWith("/config") ? <ActiveMark collapsed={collapsed} /> : null}
                    <Settings className="size-[22px] shrink-0" strokeWidth={1.7} />
                    {collapsed ? null : <span>{t("navigation.config")}</span>}
                </Link>
                <AnimatedThemeToggler theme={theme} onThemeChange={setTheme} aria-label={t(theme === "dark" ? "topNav.lightTheme" : "topNav.darkTheme")} title={themeLabel} className={itemClass(false, collapsed)}>
                    {theme === "dark" ? <Sun className="size-[22px] shrink-0" strokeWidth={1.7} /> : <Moon className="size-[22px] shrink-0" strokeWidth={1.7} />}
                    {collapsed ? null : <span>{themeLabel}</span>}
                </AnimatedThemeToggler>
                {collapsed ? null : <UserStatusActions variant="rail" className={itemClass(false, false)} />}
            </div>
        </aside>
    );
}
