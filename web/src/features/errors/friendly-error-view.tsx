// [dianran] Friendly error block: short Chinese title + next step, raw provider message folded underneath.
import { useState, type CSSProperties, type SyntheticEvent } from "react";
import { AlertTriangle, ChevronDown, PlugZap, RefreshCw, Settings2 } from "lucide-react";
import { useTranslation } from "react-i18next";

import { toFriendlyError } from "@/lib/friendly-error";
import { useConfigStore } from "@/stores/use-config-store";

type Props = {
    error: unknown;
    status?: number;
    onRetry?: () => void;
    /** Canvas theme colors; falls back to Tailwind red palette. */
    color?: string;
    mutedColor?: string;
    buttonStyle?: CSSProperties;
    compact?: boolean;
};

export function FriendlyErrorView({ error, status, onRetry, color, mutedColor, buttonStyle, compact }: Props) {
    const { t } = useTranslation();
    const [showRaw, setShowRaw] = useState(false);
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);
    const info = toFriendlyError(error, status);
    const stop = (event: SyntheticEvent) => event.stopPropagation();
    const btn = "inline-flex h-7 items-center gap-1 rounded-full border px-2.5 text-[11px] font-medium transition hover:scale-[1.02]";
    const btnStyle = buttonStyle || undefined;
    const btnClass = buttonStyle ? btn : `${btn} border-stone-300 bg-white text-stone-700 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-200`;
    const showRawToggle = info.raw && info.raw !== info.title;

    return (
        <div className="flex max-w-[300px] flex-col items-center gap-2 text-center" onMouseDown={stop} data-friendly-error={info.kind}>
            <div className="flex items-center gap-1.5 text-xs font-semibold" style={{ color: color }}>
                <AlertTriangle className={`size-3.5 shrink-0 ${color ? "" : "text-red-500"}`} />
                <span className={color ? "" : "text-red-600 dark:text-red-300"}>{info.title}</span>
            </div>
            {!compact ? (
                <div className={`text-[11px] leading-[18px] ${mutedColor ? "" : "text-stone-500 dark:text-stone-400"}`} style={{ color: mutedColor }}>
                    {info.hint}
                </div>
            ) : null}
            <div className="flex flex-wrap items-center justify-center gap-1.5">
                {info.actions.includes("openConfig") ? (
                    <button type="button" className={btnClass} style={btnStyle} onClick={(event) => (stop(event), openConfigDialog(false, "channels"))}>
                        <Settings2 className="size-3" />
                        {t("friendlyError.actions.openConfig")}
                    </button>
                ) : null}
                {info.actions.includes("openProxy") ? (
                    <button type="button" className={btnClass} style={btnStyle} onClick={(event) => (stop(event), openConfigDialog(false, "local-proxy"))}>
                        <PlugZap className="size-3" />
                        {t("friendlyError.actions.openProxy")}
                    </button>
                ) : null}
                {onRetry ? (
                    <button type="button" className={btnClass} style={btnStyle} onClick={(event) => (stop(event), onRetry())}>
                        <RefreshCw className="size-3" />
                        {t("friendlyError.actions.retry")}
                    </button>
                ) : null}
            </div>
            {showRawToggle ? (
                <button type="button" className="inline-flex items-center gap-0.5 text-[10px] opacity-60 transition hover:opacity-100" style={{ color: mutedColor }} onClick={(event) => (stop(event), setShowRaw((value) => !value))}>
                    {t("friendlyError.raw")}
                    <ChevronDown className={`size-3 transition ${showRaw ? "rotate-180" : ""}`} />
                </button>
            ) : null}
            {showRaw ? (
                <div className="max-h-24 w-full overflow-auto break-all rounded bg-black/5 px-2 py-1 text-left font-mono text-[10px] leading-4 dark:bg-white/5" style={{ color: mutedColor }}>
                    {info.raw}
                </div>
            ) : null}
        </div>
    );
}
