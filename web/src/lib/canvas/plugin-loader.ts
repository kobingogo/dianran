import { registerNodeDefinitions, unregisterPluginNodes } from "@/lib/canvas/node-registry";
import { getPluginRuntime } from "@/lib/canvas/plugin-runtime";
import { usePluginStore, type InstalledPlugin } from "@/stores/canvas/use-plugin-store";
import type { CanvasPlugin } from "@/types/canvas-plugin";
import i18n from "@/i18n";
import { assertBusinessWriter } from "@/lib/write-ownership";
import { imageToolsPlugin } from "./image-tools-plugin";

export type PluginReview = { url: string; source: string; digest: string; previousDigest?: string };
export type AuthorizePlugin = (review: PluginReview) => Promise<boolean>;
async function digestSource(source: string) {
    return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(source))), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

const cleanups = new Map<string, () => void>();

// A remote plugin may export CanvasPlugin directly or a factory that receives runtime and returns CanvasPlugin.
// The factory uses runtime.React so the bundle does not need its own React copy.
async function evaluatePluginSource(source: string): Promise<CanvasPlugin> {
    const blob = new Blob([source], { type: "text/javascript" });
    const url = URL.createObjectURL(blob);
    try {
        const mod = (await import(/* @vite-ignore */ url)) as { default?: unknown; plugin?: unknown };
        const exported = mod.default ?? mod.plugin;
        const plugin = typeof exported === "function" ? (exported as (runtime: unknown) => unknown)(getPluginRuntime()) : exported;
        assertPlugin(plugin);
        return plugin;
    } finally {
        URL.revokeObjectURL(url);
    }
}

function assertPlugin(plugin: unknown): asserts plugin is CanvasPlugin {
    const value = plugin as Partial<CanvasPlugin> | null;
    if (!value || typeof value !== "object") throw new Error(i18n.t("canvas.pluginErrors.invalidExport"));
    if (!value.id || !Array.isArray(value.nodes) || !value.nodes.length) throw new Error(i18n.t("canvas.pluginErrors.missingFields"));
}

export function activatePlugin(plugin: CanvasPlugin) {
    if (plugin.id === imageToolsPlugin.id && plugin !== imageToolsPlugin) throw new Error("内置素材工具不能被外部插件覆盖");
    registerNodeDefinitions(plugin.nodes, plugin.id);
    const runtime = getPluginRuntime();
    const disposers: Array<() => void> = [];
    // Inject declared styles when enabled and remove them when disabled or uninstalled.
    if (plugin.css) disposers.push(runtime.injectCSS(plugin.css, plugin.id));
    const cleanup = plugin.setup?.(runtime);
    if (typeof cleanup === "function") disposers.push(cleanup);
    if (disposers.length) cleanups.set(plugin.id, () => disposers.forEach((dispose) => dispose()));
}

export function deactivatePlugin(pluginId: string) {
    cleanups.get(pluginId)?.();
    cleanups.delete(pluginId);
    unregisterPluginNodes(pluginId);
}

async function fetchPluginSource(url: string) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(i18n.t("canvas.pluginErrors.downloadFailed", { status: response.status }));
    return response.text();
}

// Add a cache-busting parameter so watch builds load the latest output.
function withCacheBust(url: string) {
    return `${url}${url.includes("?") ? "&" : "?"}t=${Date.now()}`;
}

// Download and review the exact snapshot before evaluating any JavaScript.
export async function installPluginFromUrl(url: string, opts: { authorize: AuthorizePlugin; official?: boolean; bustCache?: boolean; record?: InstalledPlugin }) {
    assertBusinessWriter();
    opts = { ...opts, record: opts.record || usePluginStore.getState().plugins.find((item) => item.url === url) };
    const source = await fetchPluginSource(opts.bustCache ? withCacheBust(url) : url);
    const digest = await digestSource(source);
    if (!await opts.authorize({ url, source, digest, previousDigest: opts.record?.sourceDigest })) return null;
    assertBusinessWriter();
    const plugin = await evaluatePluginSource(source);
    if (plugin.id === imageToolsPlugin.id) throw new Error("内置素材工具随应用更新，不能用外部插件覆盖");
    if (opts.record && plugin.id !== opts.record.id && !opts.record.local) throw new Error("更新后的插件 ID 已改变，请作为新插件安装");
    deactivatePlugin(plugin.id);
    if (opts.record && opts.record.id !== plugin.id) usePluginStore.getState().remove(opts.record.id);
    usePluginStore.getState().upsert({ id: plugin.id, name: plugin.name || plugin.id, version: plugin.version || "0.0.0", description: plugin.description, url, source, sourceDigest: digest, enabled: true, official: opts.official, local: opts.record?.local });
    activatePlugin(plugin);
    return plugin;
}

export async function updatePlugin(record: InstalledPlugin, authorize: AuthorizePlugin) {
    return installPluginFromUrl(record.url, { authorize, record, official: record.official, bustCache: true });
}

export async function setPluginEnabled(record: InstalledPlugin, enabled: boolean, authorize: AuthorizePlugin) {
    assertBusinessWriter();
    if (!enabled) {
        usePluginStore.getState().setEnabled(record.id, false);
        deactivatePlugin(record.id);
        return;
    }
    if (!record.sourceDigest) {
        return Boolean(await installPluginFromUrl(record.url, { authorize, record, official: record.official }));
    }
    if (await digestSource(record.source) !== record.sourceDigest) throw new Error("插件源码与授权摘要不一致，请重新审阅更新");
    const plugin = await evaluatePluginSource(record.source);
    usePluginStore.getState().setEnabled(record.id, true);
    activatePlugin(plugin);
    return true;
}

export function uninstallPlugin(id: string) {
    deactivatePlugin(id);
    usePluginStore.getState().remove(id);
}

let loaded = false;

// Load installed and enabled plugins at application startup.
export async function ensurePluginsLoaded() {
    if (loaded) return;
    loaded = true;
    activatePlugin(imageToolsPlugin);
    await usePluginStore.persist.rehydrate();
    await loadLocalPlugins(); // Discover disabled local plugins first, then activate all enabled records.
    for (const record of usePluginStore.getState().plugins) {
        if (record.enabled && !record.sourceDigest) usePluginStore.getState().setEnabled(record.id, false);
    }
    const records = usePluginStore.getState().plugins.filter((record) => record.enabled && record.sourceDigest);
    await Promise.all(
        records.map(async (record) => {
            try {
                // Local plugins use the latest output; other plugins use their cached source.
                if (await digestSource(record.source) !== record.sourceDigest) throw new Error("插件源码摘要不一致");
                activatePlugin(await evaluatePluginSource(record.source));
            } catch (error) {
                console.error(`[plugin] Failed to load: ${record.id}`, error);
            }
        }),
    );
    await loadDevPlugins();
}

// Discover local plugins from web/public/plugins, add them disabled, and expose them in the manager without a URL.
// Existing records retain their authorized snapshot until the user reviews an update.
async function loadLocalPlugins() {
    let urls: unknown;
    try {
        const response = await fetch("/plugins/index.json");
        if (!response.ok) return;
        urls = await response.json();
    } catch {
        return; // Skip when no local manifest exists, such as production builds without plugins.
    }
    if (!Array.isArray(urls) || !urls.length) return;
    const store = usePluginStore.getState();
    await Promise.all(
        urls.map(async (url: string) => {
            try {
                const source = await fetchPluginSource(withCacheBust(url));
                if (store.plugins.some((item) => item.url === url)) return;
                // Discovery never imports source, including disabled local plugins.
                store.upsert({ id: url, name: url.split("/").pop() || url, version: "未授权", url, source, enabled: false, local: true });
            } catch (error) {
                console.error(`[plugin] Failed to discover local plugin: ${url}`, error);
            }
        }),
    );
}

// During local development, refetch VITE_DEV_PLUGINS URLs without caching or persistence on every startup.
// Together with watch builds, refreshing the page loads code changes without reinstalling the plugin.
async function loadDevPlugins() {
    const raw = import.meta.env.VITE_DEV_PLUGINS;
    if (!raw) return;
    const urls = raw.split(",").map((item) => item.trim()).filter(Boolean);
    await Promise.all(
        urls.map(async (url) => {
            try {
                const source = await fetchPluginSource(withCacheBust(url));
                const plugin = await evaluatePluginSource(source);
                deactivatePlugin(plugin.id);
                activatePlugin(plugin);
                console.info(`[plugin] Dev plugin loaded: ${plugin.id} (${url})`);
            } catch (error) {
                console.error(`[plugin] Failed to load dev plugin: ${url}`, error);
            }
        }),
    );
}
