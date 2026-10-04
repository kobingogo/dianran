// [dianran] Single source of truth for product branding.
// Keep brand-specific values here (and in i18n/brand-overrides.ts, index.html, public/) so upstream merges stay small.

export const BRAND = {
    id: "dianran",
    nameZh: "点染",
    nameEn: "Dianran",
    taglineZh: "一点灵感，染成画面",
    taglineEn: "Dot an idea, dye it into images",
    descriptionZh: "点染 Dianran：节点式 AI 创作画布，在一张画布上完成生图、视频与文本的连续推演。",
    descriptionEn: "Dianran is a node-based AI creative canvas for images, video and text.",
    owner: "KobinFlow",
    primaryColor: "#E8572A",
    secondaryColor: "#2F4A7A",
} as const;

const env = import.meta.env;

/** Product homepage / about link. Empty = not shown. */
export const HOMEPAGE_URL: string = env.VITE_HOMEPAGE_URL || "";
/** Help / docs link shown in the header and canvas menu. Empty = button hidden. */
export const DOCS_URL: string = env.VITE_DOC_URL || "";
/** Remote plain-text VERSION file for "new version" checks. Empty = no remote check (local CHANGELOG only). */
export const VERSION_CHECK_URL: string = env.VITE_VERSION_CHECK_URL || "";
/** Remote CHANGELOG.md matching VERSION_CHECK_URL. Empty = local CHANGELOG bundled at build time. */
export const CHANGELOG_URL: string = env.VITE_CHANGELOG_URL || "";
/**
 * Official node-plugin registry. Defaults to the copy bundled in public/plugin-market (self-hosted, works in mainland China).
 * Set VITE_PLUGIN_REGISTRY_URL to another URL, or to "none" to disable the official market.
 */
const registryEnv: string = env.VITE_PLUGIN_REGISTRY_URL || "";
export const PLUGIN_REGISTRY_URL: string = registryEnv === "none" ? "" : registryEnv || `${env.BASE_URL || "/"}plugin-market/official-plugins.json`;
/** npm package users run locally to bypass CORS (upstream package until we publish our own). */
export const LOCAL_PROXY_PACKAGE = "@basketikun/canvas-proxy";
/** npm package for the optional local Codex / Claude Code Agent (upstream package until we publish our own). */
export const LOCAL_AGENT_PACKAGE = "@basketikun/canvas-agent";

// ---- Storage / ABI names: DO NOT CHANGE without a migration (existing user data lives under these). ----
/** IndexedDB database name and localStorage key prefix inherited from upstream. */
export const STORAGE_NS = "infinite-canvas";
/** IndexedDB database used for per-plugin storage. */
export const PLUGIN_STORAGE_DB = `${STORAGE_NS}-plugins`;
/** Build a namespaced storage key, e.g. storageKey("canvas_store") -> "infinite-canvas:canvas_store". */
export const storageKey = (name: string) => `${STORAGE_NS}:${name}`;

// ---- Import / export file formats ----
/** App id written into new export files. */
export const EXPORT_APP_ID = BRAND.id;
/** App ids accepted when importing (new + legacy upstream files). */
export const ACCEPTED_APP_IDS = [BRAND.id, "infinite-canvas"] as const;
export type AppFileId = (typeof ACCEPTED_APP_IDS)[number];
export const isAcceptedAppId = (value: unknown): value is AppFileId => typeof value === "string" && (ACCEPTED_APP_IDS as readonly string[]).includes(value);
/** Default WebDAV directory for new users (saved values are kept). */
export const DEFAULT_WEBDAV_DIRECTORY = BRAND.id;
