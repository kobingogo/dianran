import { ListChecks } from "lucide-react";
import { Link, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useEffect, useRef } from "react";

import { BRAND } from "@/constant/brand";
import { isCanvasEditorPath } from "@/components/layout/app-rail";
import { LazyAppConfigModal as AppConfigModal } from "@/components/layout/lazy-shell";
import { useActiveTaskCount, useTaskStore } from "@/features/tasks/task-store";
import { cn } from "@/lib/utils";
import { useAgentStore } from "@/stores/use-agent-store";

const SERIF = '"Noto Serif SC","Source Han Serif SC","Songti SC","STSong",serif';

function mobileTitleKey(pathname: string) {
    if (pathname === "/") return "navigation.home";
    if (pathname.startsWith("/canvas")) return "navigation.canvas";
    if (pathname.startsWith("/image")) return "navigation.image";
    if (pathname.startsWith("/video")) return "navigation.video";
    if (pathname.startsWith("/prompts")) return "navigation.prompts";
    if (pathname.startsWith("/assets")) return "navigation.assets";
    if (pathname.startsWith("/config")) return "navigation.config";
    return "meta.title";
}

export function AppTopNav() {
    const { t } = useTranslation();
    const { pathname } = useLocation();
    const autoConnectRef = useRef(false);
    const agentToken = useAgentStore((state) => state.token);
    const agentEnabled = useAgentStore((state) => state.enabled);
    const agentConnected = useAgentStore((state) => state.connected);
    const connectAgent = useAgentStore((state) => state.connectAgent);
    const activeCount = useActiveTaskCount();
    const setCenterOpen = useTaskStore((state) => state.setCenterOpen);
    const onCanvasEditor = isCanvasEditorPath(pathname);

    useEffect(() => {
        if (autoConnectRef.current || agentEnabled || agentConnected || !agentToken.trim()) return;
        autoConnectRef.current = true;
        connectAgent({ silent: true });
    }, [agentConnected, agentEnabled, agentToken, connectAgent]);

    return (
        <>
            {onCanvasEditor ? null : (
                <header className="flex h-14 shrink-0 items-center gap-2.5 border-b border-[#E3DACA] bg-[rgba(251,248,242,0.92)] px-4 dark:border-[#332E28] dark:bg-[rgba(23,21,18,0.92)] md:hidden">
                    <Link
                        to="/"
                        aria-label={t("rail.seal")}
                        className="grid size-[30px] shrink-0 place-items-center rounded-md bg-[#C8402A] text-[10.5px] font-bold leading-none text-[#FFF6EE] dark:bg-[#D9573D]"
                        style={{ writingMode: "vertical-rl", letterSpacing: "1px", fontFamily: SERIF }}
                    >
                        {BRAND.nameZh}
                    </Link>
                    <div className="min-w-0 flex-1 truncate text-lg font-semibold text-[#1B1916] dark:text-[#F1EBE0]" style={{ fontFamily: SERIF }}>
                        {t(mobileTitleKey(pathname))}
                    </div>
                    <button
                        type="button"
                        className={cn(
                            "inline-flex h-11 shrink-0 items-center gap-1 rounded-full border px-3 text-xs",
                            activeCount > 0 ? "border-[#C8402A] bg-[#F6E3DC] font-medium text-[#B8321E] dark:border-[#D9573D] dark:bg-[#3A221C] dark:text-[#EE7A60]" : "border-[#E3DACA] text-[#3A362F] dark:border-[#332E28] dark:text-[#D9D1C3]",
                        )}
                        aria-label={activeCount > 0 ? t("tasks.running", { count: activeCount }) : t("tasks.title")}
                        onClick={() => setCenterOpen(true)}
                    >
                        <ListChecks className="size-3.5" strokeWidth={1.7} />
                        {activeCount > 0 ? t("tasks.badge", { count: activeCount }) : t("navigation.tasks")}
                    </button>
                </header>
            )}
            <AppConfigModal />
        </>
    );
}
