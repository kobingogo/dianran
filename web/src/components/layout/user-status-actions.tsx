import type { CSSProperties } from "react";
import { Dropdown } from "antd";
import type { MenuProps } from "antd";
import { BookOpen, Ellipsis, History, Keyboard, Languages, Puzzle, Settings2, Wand2 } from "lucide-react";
import { useTranslation } from "react-i18next";

import { AnimatedThemeToggler } from "@/components/ui/animated-theme-toggler";
import { VersionReleaseModal } from "@/components/layout/version-release-modal";
import { DOCS_URL } from "@/constant/env";
import { useOnboardingStore } from "@/features/onboarding/onboarding-store";
import { changeAppLocale, type AppLocale } from "@/i18n";
import { canvasThemes } from "@/lib/canvas-theme";
import { useConfigStore } from "@/stores/use-config-store";
import { useThemeStore } from "@/stores/use-theme-store";

type UserStatusActionsProps = {
    showConfig?: boolean;
    variant?: "default" | "canvas" | "rail";
    className?: string;
    onOpenShortcuts?: () => void;
    onOpenPlugins?: () => void;
};

// [dianran] Header simplified: Settings (labelled) + theme + one "More" menu for secondary actions
// (plugins, shortcuts, language, setup guide, docs, version). Every item keeps a text label.
export function UserStatusActions({ showConfig = true, variant = "default", className, onOpenShortcuts, onOpenPlugins }: UserStatusActionsProps) {
    const { i18n, t } = useTranslation();
    const theme = useThemeStore((state) => state.theme);
    const setTheme = useThemeStore((state) => state.setTheme);
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);
    const showOnboarding = useOnboardingStore((state) => state.show);
    const canvasTheme = canvasThemes[theme];
    const naturalIconClass =
        "inline-flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-stone-600 transition-colors hover:bg-black/5 hover:text-stone-950 dark:text-stone-300 dark:hover:bg-white/10 dark:hover:text-white [&_svg]:size-4";
    const labelButtonClass =
        "inline-flex h-7 shrink-0 cursor-pointer items-center gap-1.5 rounded-md px-2 text-xs font-medium text-stone-600 transition-colors hover:bg-black/5 hover:text-stone-950 dark:text-stone-300 dark:hover:bg-white/10 dark:hover:text-white [&_svg]:size-4";
    const iconStyle: CSSProperties | undefined = variant === "canvas" ? { color: canvasTheme.node.text } : undefined;
    const locale = i18n.resolvedLanguage as AppLocale;
    const nextLocale = locale === "zh-CN" ? "en-US" : "zh-CN";
    const languageLabel = t("topNav.switchLanguage", { language: t(nextLocale === "zh-CN" ? "locale.zhCN" : "locale.enUS") });

    const moreMenu = (
        <VersionReleaseModal
            renderTrigger={({ open: openVersion, hasNewVersion, version }) => {
                const items: MenuProps["items"] = [
                    ...(onOpenPlugins ? [{ key: "plugins", icon: <Puzzle className="size-4" />, label: t("topNav.plugins"), onClick: onOpenPlugins }] : []),
                    ...(onOpenShortcuts ? [{ key: "shortcuts", icon: <Keyboard className="size-4" />, label: <MenuLabel text={t("topNav.shortcuts")} hint="?" />, onClick: onOpenShortcuts }] : []),
                    { key: "language", icon: <Languages className="size-4" />, label: <MenuLabel text={languageLabel} hint={locale === "zh-CN" ? "中 → EN" : "EN → 中"} />, onClick: () => void changeAppLocale(nextLocale) },
                    { key: "guide", icon: <Wand2 className="size-4" />, label: t("topNav.setupGuide"), onClick: () => showOnboarding({ reason: "manual" }) },
                    ...(DOCS_URL ? [{ key: "docs", icon: <BookOpen className="size-4" />, label: t("topNav.docs"), onClick: () => window.open(DOCS_URL, "_blank", "noopener,noreferrer") }] : []),
                    { type: "divider" as const },
                    { key: "version", icon: <History className="size-4" />, label: <MenuLabel text={t("topNav.versionLog")} hint={version} dot={hasNewVersion} />, onClick: openVersion },
                ];
                return (
                    <Dropdown trigger={["click"]} placement={variant === "rail" ? "topLeft" : "bottomRight"} menu={{ items }}>
                        <button type="button" className={variant === "rail" ? className : `${naturalIconClass} relative max-md:size-10`} style={iconStyle} aria-label={t("topNav.more")} title={t("topNav.more")} data-header-more>
                            <Ellipsis className={variant === "rail" ? "size-[22px] shrink-0" : "size-4"} strokeWidth={variant === "rail" ? 1.7 : undefined} />
                            {variant === "rail" ? <span>{t("topNav.more")}</span> : null}
                            {hasNewVersion ? <span className="absolute right-1 top-1 size-1.5 rounded-full bg-green-500" /> : null}
                        </button>
                    </Dropdown>
                );
            }}
        />
    );

    if (variant === "rail") return moreMenu;

    return (
        <div className="inline-flex shrink-0 items-center gap-1" data-header-actions>
            {showConfig ? (
                <button type="button" className={variant === "canvas" ? labelButtonClass : `${naturalIconClass} max-md:hidden`} style={iconStyle} onClick={() => openConfigDialog(false)} aria-label={t("navigation.config")} title={t("navigation.config")}>
                    <Settings2 className="size-4" />
                    {/* main pages already show a labelled 设置 nav item; the canvas bar has no nav, so label it there */}
                    {variant === "canvas" ? <span className="hidden sm:inline">{t("navigation.config")}</span> : null}
                </button>
            ) : null}
            <AnimatedThemeToggler
                theme={theme}
                onThemeChange={setTheme}
                className={variant === "canvas" ? naturalIconClass : `${naturalIconClass} max-md:hidden`}
                style={iconStyle}
                aria-label={t(theme === "dark" ? "topNav.lightTheme" : "topNav.darkTheme")}
                title={t(theme === "dark" ? "topNav.lightTheme" : "topNav.darkTheme")}
            />
            {moreMenu}
        </div>
    );
}

function MenuLabel({ text, hint, dot }: { text: string; hint?: string; dot?: boolean }) {
    return (
        <span className="flex min-w-40 items-center justify-between gap-6">
            <span className="relative">
                {text}
                {dot ? <span className="absolute -right-2 top-0 size-1.5 rounded-full bg-green-500" /> : null}
            </span>
            {hint ? <span className="text-xs opacity-45">{hint}</span> : null}
        </span>
    );
}
