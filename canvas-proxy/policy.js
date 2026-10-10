export const PROXY_PROTOCOL = 2;
export const PROXY_TOKEN_HEADER = "x-dianran-proxy-token";
const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]"]);

/** @param {string} value */
function httpUrl(value) {
    let url;
    try { url = new URL(value); } catch { throw new Error("地址无效，请填写完整的 HTTP 或 HTTPS 地址"); }
    if (!/^https?:$/.test(url.protocol) || url.username || url.password || url.hash) throw new Error("地址必须是无凭据、无片段的 HTTP 或 HTTPS URL");
    // Encoded separators and double decoding can escape a path-scoped grant at an upstream server.
    if (/%(?:2f|5c|25)/i.test(url.pathname) || url.pathname.includes("\\")) throw new Error("地址含不允许的路径转义");
    return url;
}
/** @param {string} value */
export function normalizeProxyOrigin(value) {
    const url = httpUrl(value);
    if (url.pathname !== "/" || url.search) throw new Error("网页来源只能包含协议、主机与端口");
    return url.origin;
}
/** @param {string} value */
export function normalizeProxyBase(value) {
    const origin = normalizeProxyOrigin(value);
    if (!LOOPBACK.has(new URL(origin).hostname)) throw new Error("本地代理只能使用 127.0.0.1、localhost 或 [::1]");
    return origin;
}
/** @param {string} value */
export function normalizeProxyTarget(value) {
    const url = httpUrl(value);
    if (url.search) throw new Error("授权服务地址不能包含查询参数，请填渠道或服务的基础地址");
    return url.origin + url.pathname.replace(/\/+$/, "");
}
/** @param {string} value @param {string[]} targets */
export function isAuthorizedProxyTarget(value, targets) {
    let url;
    try { url = httpUrl(value); } catch { return false; }
    return targets.some((base) => {
        const grant = new URL(base);
        const path = grant.pathname.replace(/\/+$/, "");
        return url.origin === grant.origin && (!path || url.pathname === path || url.pathname.startsWith(path + "/"));
    });
}
