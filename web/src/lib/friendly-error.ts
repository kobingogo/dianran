// [dianran] Map raw HTTP / network / provider errors to short, actionable copy.
import i18n from "@/i18n";

export type FriendlyErrorKind = "network" | "auth" | "balance" | "rateLimit" | "timeout" | "notFound" | "badRequest" | "server" | "safety" | "canceled" | "unknown";
export type FriendlyErrorAction = "openConfig" | "openProxy" | "retry";

export type FriendlyError = {
    kind: FriendlyErrorKind;
    title: string;
    hint: string;
    actions: FriendlyErrorAction[];
    raw: string;
};

const t = (key: string, options?: Record<string, unknown>) => i18n.t(`friendlyError.${key}`, options) as string;

const NETWORK_PATTERNS = [/failed to fetch/i, /networkerror/i, /network error/i, /load failed/i, /err_network/i, /cors/i, /net::err/i, /请求失败$/];
const AUTH_PATTERNS = [/\b401\b/, /\b403\b/, /invalid[_ ]?api[_ ]?key/i, /incorrect api key/i, /unauthori[sz]ed/i, /api key not valid/i, /鉴权失败/, /无效的令牌/, /令牌.*(无效|过期)/, /permission/i];
const BALANCE_PATTERNS = [/insufficient[_ ]?(quota|balance|funds)/i, /\b402\b/, /余额不足/, /额度不足/, /quota exceeded/i, /billing/i, /credit/i];
const RATE_PATTERNS = [/\b429\b/, /rate[ _-]?limit/i, /too many requests/i, /限流/, /resource[_ ]exhausted/i];
const TIMEOUT_PATTERNS = [/timeout/i, /timed out/i, /超时/, /\b504\b/, /econnaborted/i];
const NOT_FOUND_PATTERNS = [/\b404\b/, /not found/i, /model.*(does not exist|not exist|not supported)/i, /模型.*不存在/, /no available channel/i, /无可用渠道/];
const SAFETY_PATTERNS = [/safety/i, /moderation/i, /content[_ ]?policy/i, /blocked/i, /安全审核/, /违规/];
const SERVER_PATTERNS = [/\b50[0-3]\b/, /bad gateway/i, /service unavailable/i, /internal server error/i, /服务繁忙/, /网关错误/];
const CANCEL_PATTERNS = [/canceled/i, /cancelled/i, /aborted/i, /已取消/];

export function classifyError(raw: string, status?: number): FriendlyErrorKind {
    if (status === 401 || status === 403) return "auth";
    if (status === 402) return "balance";
    if (status === 429) return BALANCE_PATTERNS.some((p) => p.test(raw)) ? "balance" : "rateLimit";
    if (status === 404) return "notFound";
    if (status === 408 || status === 504) return "timeout";
    if (status && status >= 500) return "server";
    if (status === 400 && SAFETY_PATTERNS.some((p) => p.test(raw))) return "safety";
    if (CANCEL_PATTERNS.some((p) => p.test(raw))) return "canceled";
    if (BALANCE_PATTERNS.some((p) => p.test(raw))) return "balance";
    if (AUTH_PATTERNS.some((p) => p.test(raw))) return "auth";
    if (RATE_PATTERNS.some((p) => p.test(raw))) return "rateLimit";
    if (TIMEOUT_PATTERNS.some((p) => p.test(raw))) return "timeout";
    if (SAFETY_PATTERNS.some((p) => p.test(raw))) return "safety";
    if (NOT_FOUND_PATTERNS.some((p) => p.test(raw))) return "notFound";
    if (SERVER_PATTERNS.some((p) => p.test(raw))) return "server";
    if (NETWORK_PATTERNS.some((p) => p.test(raw.trim()))) return "network";
    if (status === 400) return "badRequest";
    return "unknown";
}

const ACTIONS: Record<FriendlyErrorKind, FriendlyErrorAction[]> = {
    network: ["openProxy", "retry"],
    auth: ["openConfig"],
    balance: ["openConfig"],
    rateLimit: ["retry"],
    timeout: ["retry"],
    notFound: ["openConfig"],
    badRequest: ["retry"],
    server: ["retry"],
    safety: ["retry"],
    canceled: ["retry"],
    unknown: ["retry"],
};

export function toFriendlyError(error: unknown, status?: number): FriendlyError {
    const raw = (error instanceof Error ? error.message : typeof error === "string" ? error : "") || "";
    const kind = classifyError(raw, status);
    return { kind, title: t(`${kind}.title`), hint: t(`${kind}.hint`), actions: ACTIONS[kind], raw };
}
