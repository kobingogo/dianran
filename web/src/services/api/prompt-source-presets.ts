import { nanoid } from "nanoid";

export type PromptSource = {
    id: string;
    name: string;
    url: string;
    homepage: string;
    enabled: boolean;
    builtIn: boolean;
};

export const PROMPT_REGISTRY_HOMEPAGE = "https://github.com/yukkcat/image-prompts";
// [dianran] Built-in sources are snapshots served from our own domain (web/public/prompt-sources, refreshed by
// brand/sync-prompts.mjs), so the app never fetches raw.githubusercontent.com in the background.
const PROMPT_REGISTRY_SOURCE_BASE = `${import.meta.env.BASE_URL || "/"}prompt-sources`;

export function createPromptSource(source?: Partial<PromptSource>): PromptSource {
    return {
        id: source?.id?.trim() || nanoid(),
        name: source?.name?.trim() || "",
        url: source?.url?.trim() || "",
        homepage: source?.homepage?.trim() || "",
        enabled: source?.enabled ?? true,
        builtIn: source?.builtIn ?? false,
    };
}

export const DEFAULT_PROMPT_SOURCES: PromptSource[] = [
    // [dianran] Own curated starter prompts (covers are bundled locally).
    registrySource("dianran-picks", "点染精选", "", true),
    // All covers are bundled under /prompt-sources/covers (brand/sync-prompt-covers.mjs); no external image hosts at runtime.
    registrySource("youmind-gpt-image-2", "YouMind GPT Image 2", "https://github.com/YouMind-OpenLab/awesome-gpt-image-2", true),
    registrySource("youmind-nano-banana-pro", "YouMind Nano Banana Pro", "https://github.com/YouMind-OpenLab/awesome-nano-banana-pro-prompts", true),
    registrySource("awesome-gpt4o-image-prompts", "Awesome GPT-4o", "https://github.com/ImgEdify/Awesome-GPT4o-Image-Prompts", true),
    // Large / partly cover-less sources stay off by default to keep the list focused; users can enable them.
    registrySource("banana-prompt-quicker", "Banana Prompt Quicker", "https://glidea.github.io/banana-prompt-quicker/", false),
    registrySource("freestylefly-gpt-image-2", "Freestylefly GPT Image 2", "https://github.com/freestylefly/awesome-gpt-image-2", false),
    registrySource("awesome-gpt-image", "Awesome GPT Image", "https://github.com/ZeroLu/awesome-gpt-image", false),
    // davidwu-gpt-image2-prompts was dropped: its repository has no license, so it cannot be redistributed.
];

function registrySource(id: string, name: string, homepage: string, enabled = true): PromptSource {
    return { id, name, url: `${PROMPT_REGISTRY_SOURCE_BASE}/${id}.json`, homepage, enabled, builtIn: true };
}
