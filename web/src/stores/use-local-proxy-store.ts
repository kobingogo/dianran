import { create } from "zustand";
import { storageKey } from "@/constant/brand";
import { assertBusinessWriter } from "@/lib/write-ownership";
import { PROXY_PROTOCOL, normalizeProxyBase, normalizeProxyOrigin, normalizeProxyTarget } from "../../../canvas-proxy/policy.js";

export type ProxyPairing = { protocol: number; proxyUrl: string; token: string; origins: string[]; targets: string[] };
const key = storageKey("local_proxy_pairing");
export function parseProxyPairing(text: string): ProxyPairing {
    let value: ProxyPairing;
    try { value = JSON.parse(text); } catch { throw new Error("配对文件不是有效 JSON，请重新选择代理生成的文件"); }
    if (!value || value.protocol !== PROXY_PROTOCOL || typeof value.proxyUrl !== "string" || typeof value.token !== "string" || !/^[A-Za-z0-9_-]+$/.test(value.token) || !Array.isArray(value.origins) || !value.origins.length || !Array.isArray(value.targets) || !value.targets.length || [...value.origins, ...value.targets].some((item) => typeof item !== "string")) throw new Error("配对文件格式或协议不匹配，请使用 0.2.0 或更新的代理重新配对");
    return { protocol: PROXY_PROTOCOL, proxyUrl: normalizeProxyBase(value.proxyUrl), token: value.token, origins: value.origins.map(normalizeProxyOrigin), targets: value.targets.map(normalizeProxyTarget) };
}
export function readProxyPairing() {
    if (typeof window === "undefined") return null;
    const raw = window.localStorage.getItem(key);
    return raw ? parseProxyPairing(raw) : null;
}
export const useLocalProxyStore = create<{ pairing: ProxyPairing | null; error: string }>(() => ({ pairing: null, error: "" }));
export function reloadProxyPairing() {
    try { useLocalProxyStore.setState({ pairing: readProxyPairing(), error: "" }); }
    catch { useLocalProxyStore.setState({ pairing: null, error: "本地配对信息无法读取，请移除配对后重新导入文件" }); }
}
export function saveProxyPairing(pairing: ProxyPairing) {
    assertBusinessWriter();
    window.localStorage.setItem(key, JSON.stringify(pairing));
    useLocalProxyStore.setState({ pairing, error: "" });
}
export function forgetProxyPairing() {
    assertBusinessWriter();
    window.localStorage.removeItem(key);
    useLocalProxyStore.setState({ pairing: null, error: "" });
}
