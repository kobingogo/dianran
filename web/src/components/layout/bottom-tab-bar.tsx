import { useEffect, useState } from "react";
import { BookOpen, FileText, History, Images, Languages, ListChecks, Moon, Settings, Sparkles, Sun, UserRound, Wand2 } from "lucide-react";
import { Link, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";

import { DOCS_URL } from "@/constant/env";
import { VersionReleaseModal } from "@/components/layout/version-release-modal";
import { shellNavItems } from "@/components/layout/app-rail";
import { AnimatedThemeToggler } from "@/components/ui/animated-theme-toggler";
import { useOnboardingStore } from "@/features/onboarding/onboarding-store";
import { useActiveTaskCount, useTaskStore } from "@/features/tasks/task-store";
import { useIsMobile } from "@/hooks/use-is-mobile";
import { changeAppLocale, type AppLocale } from "@/i18n";
import { cn } from "@/lib/utils";
import { useAgentStore } from "@/stores/use-agent-store";
import { useThemeStore } from "@/stores/use-theme-store";

const TAB_OFFSET = "calc(57px + env(safe-area-inset-bottom, 0px))";
const PRIMARY = shellNavItems.filter((item) => item.labelKey === "home" || item.labelKey === "canvas" || item.labelKey === "image" || item.labelKey === "video");

function rowClass(active = false) {
    return cn(
        "flex min-h-11 w-full items-center gap-3 rounded-xl px-3 text-left text-base text-[#3A362F] transition hover:bg-[#ECE4D5] dark:text-[#D9D1C3] dark:hover:bg-[#2A2621]",
        active && "bg-[#ECE4D5] font-medium text-[#1B1916] dark:bg-[#2A2621] dark:text-[#F1EBE0]",
    );
}

export function BottomTabBar() {
    const mobile = useIsMobile();
    const { t, i18n } = useTranslation();
    const { pathname } = useLocation();
    const [mineOpen, setMineOpen] = useState(false);
    const activeCount = useActiveTaskCount();
    const setCenterOpen = useTaskStore((state) => state.setCenterOpen);
    const toggleAgent = useAgentStore((state) => state.togglePanel);
    const agentOpen = useAgentStore((state) => state.panelOpen);
    const theme = useThemeStore((state) => state.theme);
    const setTheme = useThemeStore((state) => state.setTheme);
    const showOnboarding = useOnboardingStore((state) => state.show);
    const mineActive = mineOpen || pathname.startsWith("/assets") || pathname.startsWith("/prompts") || pathname.startsWith("/config");
    const locale = (i18n.resolvedLanguage === "en-US" ? "en-US" : "zh-CN") as AppLocale;
    const nextLocale: AppLocale = locale === "zh-CN" ? "en-US" : "zh-CN";

    useEffect(() => {
        setMineOpen(false);
    }, [pathname]);

    useEffect(() => {
        if (!mineOpen) return;
        const onKey = (event: KeyboardEvent) => {
            if (event.key === "Escape") setMineOpen(false);
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [mineOpen]);

    if (!mobile) return null;

    const closeMine = () => setMineOpen(false);

    return (
        <>
            <nav aria-label={t("topNav.navigation")} className="flex shrink-0 border-t border-[#E3DACA] bg-[rgba(251,248,242,0.96)] pb-[env(safe-area-inset-bottom,0px)] dark:border-[#332E28] dark:bg-[rgba(23,21,18,0.96)]">
                <div className="flex min-h-14 w-full">
                    {PRIMARY.map((item) => {
                        const Icon = item.icon;
                        const active = item.isActive(pathname);
                        const label = t(`navigation.${item.labelKey}`);
                        return (
                            <Link
                                key={item.to}
                                to={item.to}
                                aria-label={label}
                                aria-current={active ? "page" : undefined}
                                className={cn("flex min-h-14 min-w-11 flex-1 flex-col items-center justify-center gap-0.5 text-[11px]", active ? "font-semibold text-[#1B1916] dark:text-[#F1EBE0]" : "text-[#6B645A] dark:text-[#A69D8F]")}
                            >
                                <Icon className={cn("size-[22px]", active && "text-[#C8402A] dark:text-[#D9573D]")} strokeWidth={1.7} />
                                <span>{label}</span>
                            </Link>
                        );
                    })}
                    <button
                        type="button"
                        className={cn("relative flex min-h-14 min-w-11 flex-1 flex-col items-center justify-center gap-0.5 text-[11px]", mineActive ? "font-semibold text-[#1B1916] dark:text-[#F1EBE0]" : "text-[#6B645A] dark:text-[#A69D8F]")}
                        aria-label={t("navigation.mine")}
                        aria-expanded={mineOpen}
                        aria-controls="app-mine-sheet"
                        aria-haspopup="dialog"
                        onClick={() => setMineOpen((open) => !open)}
                    >
                        <span className="relative">
                            <UserRound className={cn("size-[22px]", mineActive && "text-[#C8402A] dark:text-[#D9573D]")} strokeWidth={1.7} />
                            {activeCount > 0 ? <span className="absolute -right-2 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-[#C8402A] px-1 text-[10px] font-medium leading-none text-white tabular-nums dark:bg-[#D9573D]">{activeCount > 99 ? "99+" : activeCount}</span> : null}
                        </span>
                        <span>{t("navigation.mine")}</span>
                    </button>
                </div>
            </nav>

            <VersionReleaseModal
                renderTrigger={({ open: openVersion, hasNewVersion, version }) =>
                    mineOpen ? (
                        <>
                            <button type="button" tabIndex={-1} className="fixed inset-x-0 top-0 z-[51] cursor-default bg-[rgba(27,25,22,0.28)]" style={{ bottom: TAB_OFFSET }} aria-label={t("common.cancel")} onClick={closeMine} />
                            <div id="app-mine-sheet" role="dialog" aria-label={t("navigation.mine")} className="fixed inset-x-0 z-[52] flex max-h-[min(70vh,520px)] flex-col rounded-t-[20px] bg-[#FBF8F2] px-4 pb-4 pt-2.5 shadow-[0_-10px_30px_rgba(27,25,22,0.15)] dark:bg-[#211E1A]" style={{ bottom: TAB_OFFSET }}>
                                <div className="mx-auto mb-2 h-1 w-10 shrink-0 rounded-full bg-[#CFC3AE] dark:bg-[#4A433A]" aria-hidden />
                                <div className="mb-1 font-semibold text-[#1B1916] dark:text-[#F1EBE0]" style={{ fontFamily: '"Noto Serif SC","Source Han Serif SC","Songti SC",serif' }}>
                                    {t("navigation.mine")}
                                </div>
                                <div className="min-h-0 flex-1 space-y-1 overflow-y-auto">
                                    <Link to="/assets" className={rowClass(pathname.startsWith("/assets"))} aria-label={t("navigation.assets")} onClick={closeMine}>
                                        <Images className="size-5 shrink-0" strokeWidth={1.7} />
                                        <span>{t("navigation.assets")}</span>
                                    </Link>
                                    <Link to="/prompts" className={rowClass(pathname.startsWith("/prompts"))} aria-label={t("navigation.prompts")} onClick={closeMine}>
                                        <FileText className="size-5 shrink-0" strokeWidth={1.7} />
                                        <span>{t("navigation.prompts")}</span>
                                    </Link>
                                    <Link to="/config" className={rowClass(pathname.startsWith("/config"))} aria-label={t("navigation.config")} onClick={closeMine}>
                                        <Settings className="size-5 shrink-0" strokeWidth={1.7} />
                                        <span>{t("navigation.config")}</span>
                                    </Link>
                                    <button
                                        type="button"
                                        className={rowClass()}
                                        aria-label={activeCount > 0 ? t("tasks.running", { count: activeCount }) : t("navigation.tasks")}
                                        onClick={() => {
                                            closeMine();
                                            setCenterOpen(true);
                                        }}
                                    >
                                        <ListChecks className="size-5 shrink-0" strokeWidth={1.7} />
                                        <span className="flex-1">{t("navigation.tasks")}</span>
                                        {activeCount > 0 ? <span className="rounded-full bg-[#C8402A] px-2 text-xs font-medium text-white dark:bg-[#D9573D]">{activeCount > 99 ? "99+" : activeCount}</span> : null}
                                    </button>
                                    <button
                                        type="button"
                                        className={rowClass(agentOpen)}
                                        aria-label={t(agentOpen ? "topNav.closeAgent" : "topNav.openAgent")}
                                        aria-pressed={agentOpen}
                                        onClick={() => {
                                            closeMine();
                                            toggleAgent();
                                        }}
                                    >
                                        <Sparkles className="size-5 shrink-0" strokeWidth={1.7} />
                                        <span>Agent</span>
                                    </button>
                                    <div className="my-1 border-t border-[#E3DACA] dark:border-[#332E28]" />
                                    <AnimatedThemeToggler theme={theme} onThemeChange={setTheme} aria-label={t(theme === "dark" ? "topNav.lightTheme" : "topNav.darkTheme")} className={rowClass()}>
                                        {theme === "dark" ? <Sun className="size-5 shrink-0" strokeWidth={1.7} /> : <Moon className="size-5 shrink-0" strokeWidth={1.7} />}
                                        <span>{t(theme === "dark" ? "topNav.lightTheme" : "topNav.darkTheme")}</span>
                                    </AnimatedThemeToggler>
                                    <button
                                        type="button"
                                        className={rowClass()}
                                        aria-label={t("topNav.switchLanguage", { language: t(nextLocale === "zh-CN" ? "locale.zhCN" : "locale.enUS") })}
                                        onClick={() => {
                                            closeMine();
                                            void changeAppLocale(nextLocale);
                                        }}
                                    >
                                        <Languages className="size-5 shrink-0" strokeWidth={1.7} />
                                        <span>{t("topNav.switchLanguage", { language: t(nextLocale === "zh-CN" ? "locale.zhCN" : "locale.enUS") })}</span>
                                    </button>
                                    <button
                                        type="button"
                                        className={rowClass()}
                                        aria-label={t("topNav.setupGuide")}
                                        onClick={() => {
                                            closeMine();
                                            showOnboarding({ reason: "manual" });
                                        }}
                                    >
                                        <Wand2 className="size-5 shrink-0" strokeWidth={1.7} />
                                        <span>{t("topNav.setupGuide")}</span>
                                    </button>
                                    {DOCS_URL ? (
                                        <button
                                            type="button"
                                            className={rowClass()}
                                            aria-label={t("topNav.docs")}
                                            onClick={() => {
                                                closeMine();
                                                window.open(DOCS_URL, "_blank", "noopener,noreferrer");
                                            }}
                                        >
                                            <BookOpen className="size-5 shrink-0" strokeWidth={1.7} />
                                            <span>{t("topNav.docs")}</span>
                                        </button>
                                    ) : null}
                                    <button
                                        type="button"
                                        className={rowClass()}
                                        aria-label={t("topNav.versionLog")}
                                        onClick={() => {
                                            openVersion();
                                            closeMine();
                                        }}
                                    >
                                        <History className="size-5 shrink-0" strokeWidth={1.7} />
                                        <span className="flex-1">{t("topNav.versionLog")}</span>
                                        <span className="text-xs text-[#8C8478]">{version}</span>
                                        {hasNewVersion ? <span className="size-1.5 rounded-full bg-green-500" /> : null}
                                    </button>
                                </div>
                            </div>
                        </>
                    ) : null
                }
            />
        </>
    );
}
