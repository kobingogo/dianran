const configuredBase = (import.meta.env.VITE_MODEL_GATEWAY_URL || "").trim().replace(/\/+$/, "");

function gatewayBase() {
    const base = new URL(configuredBase);
    if (base.protocol !== "https:" || base.username || base.password || base.search || base.hash) throw Object.assign(new Error("云端网关地址配置无效，请联系站点维护者"), { outcome: "not-submitted" });
    return base.href.replace(/\/+$/, "");
}

export function isModelGatewayRequest(input: string) {
    return Boolean(configuredBase && input.startsWith(gatewayBase() + "/whatstoken/v1/"));
}

/** Deployment-owned route: never send a different provider's Token to this gateway. */
export function modelGatewayUrl(input: string) {
    if (!configuredBase) return "";
    if (isModelGatewayRequest(input)) return input;
    let target: URL;
    try { target = new URL(input); } catch { return ""; }
    if (target.origin !== "https://www.whatstoken.ai" || target.username || target.password || target.search || target.hash || !target.pathname.startsWith("/v1/")) return "";
    return `${gatewayBase()}/whatstoken${target.pathname}`;
}
