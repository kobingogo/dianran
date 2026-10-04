/// <reference types="vite/client" />

declare const __APP_VERSION__: string;
declare const __APP_RELEASES__: import("@/lib/release").ReleaseInfo[];

interface ImportMetaEnv {
    // Comma-separated local development plugin URLs, refetched on every startup without caching or persistence.
    readonly VITE_DEV_PLUGINS?: string;
    // Optional build-time analytics configuration, with one independent variable per provider.
    // GA4 measurement ID (G-XXXX)
    readonly VITE_ANALYTICS_GA4_ID?: string;
    // Baidu Analytics site ID
    readonly VITE_ANALYTICS_BAIDU_ID?: string;
    // [dianran] Brand / link configuration, see src/constant/brand.ts
    readonly VITE_HOMEPAGE_URL?: string;
    readonly VITE_DOC_URL?: string;
    readonly VITE_VERSION_CHECK_URL?: string;
    readonly VITE_CHANGELOG_URL?: string;
    readonly VITE_PLUGIN_REGISTRY_URL?: string;
    readonly VITE_LOCAL_PROXY_PACKAGE?: string;
    readonly VITE_LOCAL_AGENT_PACKAGE?: string;
    // Optional featured provider shown first in the onboarding guide (base URL only, never a key)
    readonly VITE_FEATURED_PROVIDER_BASE_URL?: string;
    readonly VITE_FEATURED_PROVIDER_NAME?: string;
    readonly VITE_FEATURED_PROVIDER_KEY_URL?: string;
}
