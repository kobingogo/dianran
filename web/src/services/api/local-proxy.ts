import { normalizeLocalProxyUrl, LOCAL_PROXY_PACKAGE } from "@/stores/use-config-store";
import { parseProxyPairing, saveProxyPairing, type ProxyPairing } from "@/stores/use-local-proxy-store";
import { authorizedProxyPairing, LOCAL_PROXY_NETWORK_HELP } from "./proxy-transport";
import { PROXY_PROTOCOL, PROXY_TOKEN_HEADER, normalizeProxyBase } from "../../../../canvas-proxy/policy.js";

async function probe(pairing: ProxyPairing) {
    let response: Response;
    try {
        response = await fetch(`${pairing.proxyUrl}/`, { cache: "no-store", credentials: "omit", redirect: "error", headers: { [PROXY_TOKEN_HEADER]: pairing.token } });
    } catch { throw new Error(LOCAL_PROXY_NETWORK_HELP); }
    const data = await response.json().catch(() => null);
    if (!response.ok) throw new Error(data?.error || "代理拒绝连接，请核对网页来源与配对文件");
    if (data?.proxy !== LOCAL_PROXY_PACKAGE || data.protocol !== PROXY_PROTOCOL || !Array.isArray(data.targets)) throw new Error("代理协议不匹配，请将代理与网页成对更新到配对版本后重试");
    return data as { proxy: string; version: string; targets: string[] };
}
export async function pairLocalProxy(text: string) {
    const pairing = parseProxyPairing(text);
    if (!pairing.origins.includes(window.location.origin)) throw new Error("配对文件未授权当前网页来源，请在启动命令中添加当前站点的 --origin");
    const identity = await probe(pairing);
    saveProxyPairing({ ...pairing, targets: identity.targets });
    return pairing.proxyUrl;
}
export async function testLocalProxy(proxyUrl: string) {
    const base = normalizeProxyBase(normalizeLocalProxyUrl(proxyUrl));
    const pairing = authorizedProxyPairing(base);
    const identity = await probe(pairing);
    return `${identity.proxy} v${identity.version}`;
}
