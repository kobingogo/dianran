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
/** npm package users run locally to bypass CORS (published from canvas-proxy/ under the @kobinflow scope). */
export const LOCAL_PROXY_PACKAGE: string = env.VITE_LOCAL_PROXY_PACKAGE || "@kobinflow/canvas-proxy";
/** npm package for the optional local Codex / Claude Code Agent (published from canvas-proxy/ under the @kobinflow scope). */
export const LOCAL_AGENT_PACKAGE: string = env.VITE_LOCAL_AGENT_PACKAGE || "@kobinflow/canvas-agent";

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

// ---- [dianran] Phase 2: preset model providers for the first-run guide ----
// Base URLs only. Never put API keys here (this file ships to every browser).
export type PresetProviderRegion = "cn" | "global" | "any";
export type PresetProvider = {
    id: string;
    name: { "zh-CN": string; "en-US": string };
    /** Empty = user must type the base URL (OpenAI-compatible relays such as new-api / one-api). */
    baseUrl: string;
    apiFormat: "openai" | "gemini";
    region: PresetProviderRegion;
    /** Where the user gets an API key. */
    keyUrl?: string;
    /** Short capability / compatibility note shown on the card. */
    note: { "zh-CN": string; "en-US": string };
    /** Preferred defaults, tried in order against the fetched model list. */
    recommended?: Partial<Record<"image" | "video" | "text" | "audio", string[]>>;
    /** Allow the user to switch protocol in the guide (custom/relay only). */
    customizable?: boolean;
    /**
     * Text endpoint. "responses" (default) = POST /v1/responses; "chat" = POST /v1/chat/completions for providers without
     * the Responses API. Unknown providers start with "responses" and fall back to "chat" automatically on 404 / unsupported.
     */
    textApi?: "responses" | "chat";
    /**
     * Image endpoint. "openai" (default) = /v1/images/generations + /v1/images/edits; "siliconflow" = /v1/images/generations with
     * SiliconFlow's body (image_size / batch_size / image); "chat" = /v1/chat/completions with modalities ["image","text"] (OpenRouter).
     */
    imageApi?: "openai" | "siliconflow" | "chat";
};

/** Optional "official" provider injected at build time (e.g. your own new-api relay), shown first in the guide. */
const featuredBaseUrl: string = env.VITE_FEATURED_PROVIDER_BASE_URL || "";
const featuredProvider: PresetProvider[] = featuredBaseUrl
    ? [
          {
              id: "featured",
              name: { "zh-CN": env.VITE_FEATURED_PROVIDER_NAME || `${BRAND.nameZh}官方服务`, "en-US": env.VITE_FEATURED_PROVIDER_NAME || `${BRAND.nameEn} official` },
              baseUrl: featuredBaseUrl,
              apiFormat: "openai",
              region: "any",
              keyUrl: env.VITE_FEATURED_PROVIDER_KEY_URL || undefined,
              note: { "zh-CN": "推荐 · 生图、视频、文本一站式", "en-US": "Recommended · images, video and text in one place" },
          },
      ]
    : [];

export const PRESET_PROVIDERS: PresetProvider[] = [
    ...featuredProvider,
    {
        id: "relay",
        name: { "zh-CN": "OpenAI 兼容中转", "en-US": "OpenAI-compatible relay" },
        baseUrl: "",
        apiFormat: "openai",
        region: "any",
        note: { "zh-CN": "new-api / one-api 等中转站，填它给你的接口地址", "en-US": "new-api / one-api style relays: paste the base URL they gave you" },
        recommended: { image: ["gpt-image-2", "gpt-image-1", "nano-banana-pro", "gemini-3-pro-image-preview", "seedream-4.0"], video: ["sora-2", "veo-3.1", "kling-v2"], text: ["gpt-5.5", "gpt-5", "gpt-4.1", "gpt-4o"], audio: ["gpt-4o-mini-tts", "tts-1"] },
        customizable: true,
    },
    {
        id: "openai",
        name: { "zh-CN": "OpenAI 官方", "en-US": "OpenAI" },
        baseUrl: "https://api.openai.com",
        apiFormat: "openai",
        region: "global",
        keyUrl: "https://platform.openai.com/api-keys",
        note: { "zh-CN": "生图、视频、文本、语音全能力 · 需海外网络", "en-US": "Images, video, text and speech" },
        recommended: { image: ["gpt-image-2", "gpt-image-1"], video: ["sora-2"], text: ["gpt-5.5", "gpt-5", "gpt-4.1"], audio: ["gpt-4o-mini-tts", "tts-1"] },
    },
    {
        id: "gemini",
        name: { "zh-CN": "Google Gemini", "en-US": "Google Gemini" },
        baseUrl: "https://generativelanguage.googleapis.com",
        apiFormat: "gemini",
        region: "global",
        keyUrl: "https://aistudio.google.com/apikey",
        note: { "zh-CN": "Nano Banana 生图 + Gemini 文本 · 需海外网络", "en-US": "Nano Banana images + Gemini text" },
        recommended: { image: ["gemini-3-pro-image-preview", "gemini-2.5-flash-image"], text: ["gemini-2.5-flash", "gemini-2.5-pro"] },
    },
    {
        id: "siliconflow",
        name: { "zh-CN": "硅基流动 SiliconFlow", "en-US": "SiliconFlow" },
        baseUrl: "https://api.siliconflow.cn/v1",
        apiFormat: "openai",
        region: "cn",
        keyUrl: "https://cloud.siliconflow.cn/account/ak",
        note: { "zh-CN": "国内直连 · 以生图模型为主（Kolors、Qwen-Image 等）", "en-US": "China mainland · mostly image models" },
        recommended: { image: ["Kwai-Kolors/Kolors", "Qwen/Qwen-Image"], text: ["deepseek-ai/DeepSeek-V3", "Qwen/Qwen3-32B"] },
        textApi: "chat",
        imageApi: "siliconflow",
    },
    {
        id: "openrouter",
        name: { "zh-CN": "OpenRouter", "en-US": "OpenRouter" },
        baseUrl: "https://openrouter.ai/api/v1",
        apiFormat: "openai",
        region: "global",
        keyUrl: "https://openrouter.ai/keys",
        note: { "zh-CN": "海量文本模型，适合画布助手 · 需海外网络", "en-US": "Hundreds of text models for the canvas assistant" },
        recommended: { image: ["google/gemini-2.5-flash-image"], text: ["openai/gpt-5", "anthropic/claude-sonnet-4.5", "google/gemini-2.5-flash"] },
        textApi: "chat",
        imageApi: "chat",
    },
];

/** Endpoint flags of the preset whose base URL host matches (works for channels created before the flags existed). */
export function presetApiFlags(baseUrl: string): Pick<PresetProvider, "textApi" | "imageApi"> {
    const host = (value: string) => {
        try {
            return new URL(value).host.toLowerCase();
        } catch {
            return "";
        }
    };
    const target = host(baseUrl.trim());
    const preset = target ? PRESET_PROVIDERS.find((item) => item.baseUrl && host(item.baseUrl) === target) : undefined;
    return { textApi: preset?.textApi, imageApi: preset?.imageApi };
}
