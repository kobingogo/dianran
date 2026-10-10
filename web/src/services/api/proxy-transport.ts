import axios from "axios";
import { readProxyPairing } from "@/stores/use-local-proxy-store";
import { PROXY_TOKEN_HEADER, isAuthorizedProxyTarget, normalizeProxyBase } from "../../../../canvas-proxy/policy.js";

export const LOCAL_PROXY_NETWORK_HELP = "无法访问本地代理。请确认代理正在运行、启动命令已授权当前网页来源，并在浏览器站点设置中允许“本地网络访问”后重新测试连接。";
export function authorizedProxyPairing(base: string, target?: string) {
    try {
    const proxyUrl = normalizeProxyBase(base);
    const pairing = readProxyPairing();
    if (!pairing || pairing.proxyUrl !== proxyUrl || !pairing.origins.includes(window.location.origin)) throw new Error("本地代理尚未为此地址与站点配对，请到设置 → 本地代理导入当前配对文件");
    if (target && !isAuthorizedProxyTarget(target, pairing.targets)) throw new Error("目标服务未授权，请在代理启动命令添加对应 --target 并重新配对");
    return pairing;
    } catch (error) { throw Object.assign(error instanceof Error ? error : new Error(String(error)), { outcome: "not-submitted" }); }
}
function proxyError(data: { code: string; error: string }) {
    // Forwarding failures and redirects can happen after the upstream accepted a paid request.
    const unsent = ["PROXY_HOST_DENIED", "PROXY_ORIGIN_DENIED", "PROXY_TARGET_INVALID", "PROXY_TARGET_DENIED", "PROXY_METHOD_DENIED", "PROXY_PAIRING_REQUIRED"].includes(data.code);
    return Object.assign(new Error(data.error), { outcome: unsent ? "not-submitted" : "unknown" });
}
function proxyRequest(input: string) {
    let url: URL;
    try { url = new URL(input); } catch { return null; }
    if (!/^\/https?:\/\//.test(url.pathname)) return null;
    // An ordinary provider URL with /https:// in its path must not receive the pairing credential.
    if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) return null;
    return { url, target: url.pathname.slice(1) + url.search };
}
export function proxyRequestHeaders(url: string, original?: HeadersInit) {
    const headers = new Headers(original);
    headers.delete(PROXY_TOKEN_HEADER);
    const request = proxyRequest(url);
    if (request) headers.set(PROXY_TOKEN_HEADER, authorizedProxyPairing(request.url.origin, request.target).token);
    return headers;
}
export async function proxyFetch(input: RequestInfo | URL, init?: RequestInit) {
    const url = input instanceof Request ? input.url : String(input);
    const request = proxyRequest(url);
    const headers = proxyRequestHeaders(url, init?.headers || (input instanceof Request ? input.headers : undefined));
    try {
        const response = await fetch(input, { ...init, headers, ...(request ? { credentials: "omit", redirect: "error" } : {}) });
        if (request && !response.ok) {
            const data = await response.clone().json().catch(() => null);
            if (typeof data?.code === "string" && data.code.startsWith("PROXY_")) throw proxyError(data);
        }
        return response;
    } catch (error) {
        if (request && error instanceof TypeError) throw new Error(LOCAL_PROXY_NETWORK_HELP);
        throw error;
    }
}
let installed = false;
export function installProxyTransport() {
    if (installed) return;
    installed = true;
    axios.interceptors.request.use((config) => {
        const original = config.headers.toJSON();
        const headers = proxyRequestHeaders(config.url || "", original as Record<string, string>);
        config.headers.delete(PROXY_TOKEN_HEADER);
        headers.forEach((value, key) => config.headers.set(key, value));
        if (proxyRequest(config.url || "")) config.withCredentials = false;
        return config;
    });
    axios.interceptors.response.use((response) => response, async (error) => {
        if (proxyRequest(error.config?.url || "")) {
            const data = error.response?.data;
            let payload = data;
            if (data instanceof Blob) { try { payload = JSON.parse(await data.text()); } catch { payload = null; } }
            if (typeof payload?.code === "string" && payload.code.startsWith("PROXY_")) throw proxyError(payload);
            if (error.code === "ERR_NETWORK") throw new Error(LOCAL_PROXY_NETWORK_HELP);
        }
        throw error;
    });
}
