// [dianran] Friendly error toast: every user-facing error goes through toFriendlyError(); the raw provider text is only
// shown inside a collapsed 「详情」 block (and logged to the console), never as the toast headline.
import { useState } from "react";
import { ChevronDown } from "lucide-react";
import type { MessageInstance } from "antd/es/message/interface";

import i18n from "@/i18n";
import { toFriendlyError, type FriendlyError } from "@/lib/friendly-error";

/** Short, already-readable Chinese sentence (our own validation copy or a relay's Chinese message) without English jargon. */
const isReadableChinese = (text: string) => /[\u4e00-\u9fff]/.test(text) && !/[A-Za-z_]{4,}/.test(text) && text.length <= 60;

export function friendlyToastInfo(error: unknown, fallback?: string, status?: number): FriendlyError {
    const info = toFriendlyError(error, status);
    if (info.kind !== "unknown") return info;
    const readable = isReadableChinese(info.raw);
    return {
        ...info,
        title: fallback || info.title,
        hint: readable ? info.raw : info.raw ? (i18n.t("friendlyError.seeDetails") as string) : "",
        raw: readable ? "" : info.raw,
    };
}

function ErrorToastContent({ info }: { info: FriendlyError }) {
    const [open, setOpen] = useState(false);
    const showRaw = Boolean(info.raw && info.raw !== info.title && info.raw !== info.hint);
    return (
        <span className="inline-flex max-w-[min(420px,80vw)] flex-col items-start gap-0.5 text-left align-top" data-friendly-error={info.kind}>
            <span className="font-medium">{info.title}</span>
            {info.hint ? <span className="text-xs leading-5 text-stone-500 dark:text-stone-400">{info.hint}</span> : null}
            {showRaw ? (
                <button type="button" className="inline-flex items-center gap-0.5 text-[11px] text-stone-400 transition hover:text-stone-600 dark:hover:text-stone-200" onClick={() => setOpen((value) => !value)}>
                    {i18n.t("friendlyError.raw") as string}
                    <ChevronDown className={`size-3 transition ${open ? "rotate-180" : ""}`} />
                </button>
            ) : null}
            {showRaw && open ? <span className="max-h-24 w-full overflow-auto break-all rounded bg-black/5 px-2 py-1 font-mono text-[11px] leading-4 text-stone-500 dark:bg-white/5">{info.raw}</span> : null}
        </span>
    );
}

/** Show a friendly error toast. `fallback` is the Chinese headline used when the error can't be classified. */
export function showErrorToast(message: MessageInstance, error: unknown, fallback?: string, options?: { status?: number; warning?: boolean }) {
    const info = friendlyToastInfo(error, fallback, options?.status);
    if (info.kind === "canceled") return;
    if (info.raw) console.warn("[dianran]", info.title, "-", info.raw);
    const open = options?.warning ? message.warning : message.error;
    void open({ key: `friendly-error:${info.title}`, content: <ErrorToastContent info={info} />, duration: info.raw ? 6 : 4 });
}
