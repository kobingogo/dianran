import { imageSizePresets, parseAspectRatio, parsePixelSize } from "@/lib/media-size";

/**
 * Model capability table (PLAN §8).
 *
 * Numbers follow the code that actually sends requests today and the public docs
 * cited on each preset. Unknown models stay loose (`known: false`) so the UI can
 * say the parameters may be ignored.
 *
 * Channel argument uses the names already in the app:
 * - `apiFormat`: "openai" | "gemini" (`use-config-store`)
 * - image endpoint `imageApi`: "siliconflow" | "chat" (`constant/brand.ts`, `services/api/image.ts`)
 */

export type ImageQualityName = "standard" | "hd" | "low" | "medium" | "high";
export type ImageChannelFormat = "openai" | "gemini" | "siliconflow" | "chat";
export type VideoChannelFormat = "openai" | "gemini";
export type VideoResolution = "480p" | "720p" | "1080p";
export type VideoParamStyle = "openai-sora" | "veo" | "relay-extended";

export type ImageCaps = {
    /** "any" = pixels are not a fixed enum (Gemini still only sends aspectRatio). Empty list = do not send size. */
    sizes: "any" | string[];
    ratios: string[];
    quality?: { values: ImageQualityName[]; param: "quality" | "imageSize" };
    maxCount: number;
    transparent: boolean;
    tiers?: ("1k" | "2k" | "4k")[];
    /** False when the model was not recognized. UI should say parameters may be ignored. */
    known: boolean;
};

export type VideoCaps = {
    ratios: string[];
    seconds: number[] | { min: number; max: number };
    resolutions: VideoResolution[];
    /** "16:9@720p" -> "1280x720". Veo uses this only as a preview; the request sends aspectRatio + resolution. */
    sizeMap?: Record<string, string>;
    paramStyle: VideoParamStyle;
    modes: ("frames" | "reference")[];
    audio: boolean;
    /** Advanced width/height. Official Veo / Sora do not accept arbitrary pixels. */
    customSize?: boolean;
    known: boolean;
};

export type SnapResult<T> = { value: T; changed: boolean };

/** 16:9 at 720p. Used when a legacy `size` is not a legal video dimension. */
export const DEFAULT_VIDEO_SIZE = "1280x720";

const COMMON_IMAGE_RATIOS = ["1:1", "2:3", "3:2", "4:3", "3:4", "16:9", "9:16", "21:9", "9:21"];
/** Same list as `GEMINI_SUPPORTED_RATIOS` in `services/api/image.ts`. */
const GEMINI_RATIOS = ["1:1", "1:4", "1:8", "2:3", "3:2", "3:4", "4:1", "4:3", "4:5", "5:4", "8:1", "9:16", "16:9", "21:9"];
/** Current video ratio chips, minus "auto" (`videoRatioOptions` in `lib/media-size.ts`). */
const RELAY_VIDEO_RATIOS = ["1:1", "3:4", "4:3", "16:9", "9:16", "21:9"];
const LEGAL_VIDEO_RATIOS = RELAY_VIDEO_RATIOS;
/** Legacy pixel sizes above this short side are the image-page 4K leak, not a video choice. */
const MAX_LEGACY_VIDEO_SHORT_SIDE = 1080;

/**
 * gpt-image-1 / 1.5 / 1-mini.
 * Source: OpenAI Images API — sizes 1024x1024 | 1536x1024 | 1024x1536, quality low|medium|high,
 * background transparent, n = 1..10. (dall-e quality/size table in the same reference.)
 */
const GPT_IMAGE_1: ImageCaps = {
    sizes: ["1024x1024", "1536x1024", "1024x1536"],
    ratios: ["1:1", "3:2", "2:3"],
    quality: { values: ["low", "medium", "high"], param: "quality" },
    maxCount: 10,
    transparent: true,
    known: true,
};

/**
 * gpt-image-2 and 2.x snapshots, including the app's default image model.
 * Source: OpenAI Images API reference (2026-10) — these models accept arbitrary WIDTHxHEIGHT,
 * plus the gpt-image quality values low|medium|high. 2.5 sunburst/flare also accept xhigh|max;
 * those extra tiers are not exposed here.
 */
const GPT_IMAGE_2: ImageCaps = {
    sizes: "any",
    ratios: COMMON_IMAGE_RATIOS,
    quality: { values: ["low", "medium", "high"], param: "quality" },
    maxCount: 10,
    transparent: true,
    known: true,
};

/**
 * Source: OpenAI Images API — dall-e-3 sizes 1024x1024 | 1792x1024 | 1024x1792,
 * quality standard|hd, n = 1. 16:9 maps to 1792x1024, 9:16 to 1024x1792.
 */
const DALLE_3: ImageCaps = {
    sizes: ["1024x1024", "1792x1024", "1024x1792"],
    ratios: ["1:1", "16:9", "9:16"],
    quality: { values: ["standard", "hd"], param: "quality" },
    maxCount: 1,
    transparent: false,
    known: true,
};

/**
 * Source: OpenAI Images API — dall-e-2 sizes 256x256 | 512x512 | 1024x1024, n = 1..10,
 * quality only "standard". No transparent background.
 */
const DALLE_2: ImageCaps = {
    sizes: ["256x256", "512x512", "1024x1024"],
    ratios: ["1:1"],
    quality: { values: ["standard"], param: "quality" },
    maxCount: 10,
    transparent: false,
    known: true,
};

/**
 * Gemini 3 / 3.1 / 3-pro image models.
 * Source: `image.ts` `supportsGeminiImageSize` + `imageConfig.imageSize` 1K/2K/4K.
 * The request sends aspectRatio only (`sizes: "any"`). 画质 标准/高清 map to 1K/2K, not 4K.
 */
const GEMINI_3_IMAGE: ImageCaps = {
    sizes: "any",
    ratios: GEMINI_RATIOS,
    quality: { values: ["standard", "hd"], param: "imageSize" },
    maxCount: 1,
    transparent: false,
    tiers: ["1k", "2k", "4k"],
    known: true,
};

/** Other Gemini image models: aspectRatio only, quality is ignored (`image.ts`). */
const GEMINI_IMAGE: ImageCaps = {
    sizes: "any",
    ratios: GEMINI_RATIOS,
    maxCount: 1,
    transparent: false,
    known: true,
};

/**
 * SiliconFlow image endpoint.
 * Source: `image.ts` `requestSiliconFlowImages` — `batch_size` capped at 4, `image_size` only when WxH,
 * quality and transparent background are not sent.
 */
const SILICONFLOW_IMAGE: ImageCaps = {
    sizes: "any",
    ratios: COMMON_IMAGE_RATIOS,
    maxCount: 4,
    transparent: false,
    known: true,
};

/**
 * Chat image endpoint (`/chat/completions` + modalities).
 * Source: `image.ts` `requestChatImages` — quality, size, and background are all dropped.
 * Empty `sizes` means "do not send size".
 */
const CHAT_IMAGE: ImageCaps = {
    sizes: [],
    ratios: [],
    maxCount: 1,
    transparent: false,
    known: true,
};

/** Unrecognized model, including grok image names. Loose options, flagged unknown. */
const UNKNOWN_IMAGE: ImageCaps = {
    sizes: "any",
    ratios: COMMON_IMAGE_RATIOS,
    quality: { values: ["low", "medium", "high"], param: "quality" },
    maxCount: 4,
    transparent: false,
    known: false,
};

/**
 * Veo via the Gemini video endpoint.
 * Source: `video.ts` `createGeminiVideoTask` and PLAN §1.3 — aspectRatio 16:9|9:16
 * (auto becomes 16:9), durationSeconds 4|6|8, resolution 720p|1080p.
 * sizeMap is a preview only; the request does not send WxH.
 */
const VEO: VideoCaps = {
    ratios: ["16:9", "9:16"],
    seconds: [4, 6, 8],
    resolutions: ["720p", "1080p"],
    sizeMap: {
        "16:9@720p": "1280x720",
        "9:16@720p": "720x1280",
        "16:9@1080p": "1920x1080",
        "9:16@1080p": "1080x1920",
    },
    paramStyle: "veo",
    modes: ["frames", "reference"],
    audio: true,
    customSize: false,
    known: true,
};

/**
 * Official Sora / sora-2.
 * Source: OpenAI Videos API — seconds 4|8|12, size 720x1280 | 1280x720 | 1024x1792 | 1792x1024.
 * The 1080p key is the official short-side-1024 pair (1792x1024 / 1024x1792), not 1920x1080.
 */
const SORA: VideoCaps = {
    ratios: ["16:9", "9:16"],
    seconds: [4, 8, 12],
    resolutions: ["720p", "1080p"],
    sizeMap: {
        "16:9@720p": "1280x720",
        "9:16@720p": "720x1280",
        "16:9@1080p": "1792x1024",
        "9:16@1080p": "1024x1792",
    },
    paramStyle: "openai-sora",
    modes: ["frames"],
    audio: false,
    customSize: false,
    known: true,
};

/**
 * grok-imagine-video and other OpenAI-shaped relays.
 * Source: `video.ts` `createOpenAIVideoTask` still sends size + resolution_name + seconds + mode.
 * Kept loose: common ratios, discrete seconds, 480p/720p/1080p, custom size allowed.
 * `known: false` — the relay may ignore or reject any of these.
 */
const RELAY_VIDEO: VideoCaps = {
    ratios: RELAY_VIDEO_RATIOS,
    seconds: [5, 6, 8, 10],
    resolutions: ["480p", "720p", "1080p"],
    paramStyle: "relay-extended",
    modes: ["frames", "reference"],
    audio: true,
    customSize: true,
    known: false,
};

function bareModel(model: string) {
    const index = model.indexOf("::");
    return (index >= 0 ? model.slice(index + 2) : model).trim().toLowerCase();
}

function isGptImage1(name: string) {
    return /gpt-image-1(?:\.5)?(?:-mini)?\b/.test(name);
}

function isGptImage2(name: string) {
    return /gpt-image-2(?:\.\d+)?\b/.test(name);
}

function isGeminiFamily(name: string) {
    return /gemini|imagen|nano-banana/.test(name);
}

/** Mirrors `supportsGeminiImageSize` in `image.ts`, but requires an image-model name so "3.1" alone does not match. */
function isGemini3Image(name: string) {
    return isGeminiFamily(name) && (/gemini-3/.test(name) || /3\.1/.test(name) || /3-pro/.test(name));
}

export function getImageCaps(model: string, channelFormat?: ImageChannelFormat): ImageCaps {
    const format = channelFormat || "openai";
    if (format === "chat") return CHAT_IMAGE;
    if (format === "siliconflow") return SILICONFLOW_IMAGE;
    const name = bareModel(model);
    if (isGptImage1(name)) return GPT_IMAGE_1;
    if (isGptImage2(name)) return GPT_IMAGE_2;
    if (/dall-?e-3\b/.test(name)) return DALLE_3;
    if (/dall-?e-2\b/.test(name)) return DALLE_2;
    if (isGemini3Image(name)) return GEMINI_3_IMAGE;
    if (format === "gemini" || isGeminiFamily(name)) return GEMINI_IMAGE;
    return UNKNOWN_IMAGE;
}

export function getVideoCaps(model: string, apiFormat?: VideoChannelFormat): VideoCaps {
    const name = bareModel(model);
    // Gemini's video endpoint is Veo-shaped even when the model string is odd (`video.ts`).
    if (apiFormat === "gemini") return /veo/.test(name) ? VEO : { ...VEO, known: false };
    if (/veo/.test(name) && apiFormat !== "openai") return VEO;
    if (/sora/.test(name)) return SORA;
    return RELAY_VIDEO;
}

/** Read-time image quality. Does not write storage. auto/medium/low → standard, high → hd. */
export function normalizeImageQuality(old: string | undefined | null): "standard" | "hd" {
    const value = String(old || "").trim().toLowerCase();
    if (value === "hd" || value === "high" || value === "high-def") return "hd";
    return "standard";
}

export type MappedImageQuality = { send: false } | { send: true; param: "quality" | "imageSize"; value: string };

/**
 * Internal 标准/高清 → the field actually posted.
 * - no quality support → omit
 * - low/medium/high (gpt-image): 标准 omits quality (or the caller may send medium); 高清 → high
 * - dall-e-3 → standard/hd
 * - dall-e-2 → standard
 * - Gemini 3 imageSize → 1K / 2K
 */
export function mapImageQualityParam(quality: string, caps: ImageCaps): MappedImageQuality {
    const level = normalizeImageQuality(quality);
    const spec = caps.quality;
    if (!spec) return { send: false };
    if (spec.param === "imageSize") return { send: true, param: "imageSize", value: level === "hd" ? "2K" : "1K" };
    const values = new Set(spec.values);
    if (values.has("standard") && values.has("hd")) return { send: true, param: "quality", value: level === "hd" ? "hd" : "standard" };
    if (values.size === 1 && values.has("standard")) return { send: true, param: "quality", value: "standard" };
    if (level === "hd") {
        if (values.has("high")) return { send: true, param: "quality", value: "high" };
        if (values.has("hd")) return { send: true, param: "quality", value: "hd" };
        return { send: false };
    }
    // 标准：不发。显式 medium 会改变 gpt-image 的默认档，和旧的「自动不发 quality」不一致。
    return { send: false };
}

function ratioNumber(value: string) {
    const pixels = /^(\d+)x(\d+)$/i.exec(value.trim());
    if (pixels) {
        const width = Number(pixels[1]);
        const height = Number(pixels[2]);
        return width > 0 && height > 0 ? width / height : null;
    }
    const ratio = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(value.trim());
    if (!ratio) return null;
    const width = Number(ratio[1]);
    const height = Number(ratio[2]);
    return width > 0 && height > 0 ? width / height : null;
}

function closestByNumber(target: number, allowed: readonly { value: string; score: number }[]) {
    return allowed.reduce((best, item) => (Math.abs(item.score - target) < Math.abs(best.score - target) ? item : best));
}

function snapRatio(value: string, allowed: readonly string[]): SnapResult<string> {
    const exact = allowed.find((item) => item.toLowerCase() === value.trim().toLowerCase());
    if (exact) return { value: exact, changed: exact !== value };
    const target = ratioNumber(value);
    const scored = allowed.map((item) => ({ value: item, score: ratioNumber(item) })).filter((item): item is { value: string; score: number } => item.score != null);
    if (!scored.length) return { value: allowed[0] || value, changed: (allowed[0] || value) !== value };
    const anchor = target ?? 1;
    const next = closestByNumber(anchor, scored).value;
    return { value: next, changed: next !== value };
}

function snapSeconds(value: number | string, allowed: readonly number[]): SnapResult<number> {
    const current = Math.round(Number(value));
    if (!allowed.length || !Number.isFinite(current)) return { value: Number.isFinite(current) ? current : 0, changed: false };
    let best = allowed[0];
    for (const item of allowed) {
        if (Math.abs(item - current) < Math.abs(best - current)) best = item;
    }
    return { value: best, changed: best !== current };
}

function resolutionPixels(value: string) {
    const raw = value.trim().toLowerCase();
    if (raw === "low") return 480;
    if (raw === "auto" || raw === "medium" || raw === "high") return 720;
    const pixels = Number(raw.replace(/p$/, ""));
    return Number.isFinite(pixels) && pixels > 0 ? pixels : 720;
}

function snapResolution(value: string, allowed: readonly string[]): SnapResult<string> {
    const exact = allowed.find((item) => item.toLowerCase() === value.trim().toLowerCase());
    if (exact) return { value: exact, changed: exact !== value };
    if (!allowed.length) return { value, changed: false };
    const target = resolutionPixels(value);
    const next = closestByNumber(target, allowed.map((item) => ({ value: item, score: resolutionPixels(item) }))).value;
    return { value: next, changed: next.toLowerCase() !== value.trim().toLowerCase() };
}

function snapQuality(value: string, allowed: readonly string[]): SnapResult<string> {
    const raw = value.trim().toLowerCase();
    const exact = allowed.find((item) => item.toLowerCase() === raw);
    if (exact) return { value: exact, changed: exact !== value };
    if (!allowed.length) {
        const level = normalizeImageQuality(value);
        return { value: level, changed: level !== value };
    }
    const level = normalizeImageQuality(value);
    const prefer = level === "hd" ? ["hd", "high", "high-def", "2k", "4k"] : ["standard", "medium", "low", "1k", "auto"];
    const next = prefer.map((item) => allowed.find((candidate) => candidate.toLowerCase() === item)).find(Boolean) || allowed[0];
    return { value: next, changed: next.toLowerCase() !== raw };
}

/** Snap a ratio, a duration, a resolution, or a quality value to the closest allowed option. */
export function snapToClosest(kind: "ratio", value: string, allowed: readonly string[]): SnapResult<string>;
export function snapToClosest(kind: "seconds", value: number | string, allowed: readonly number[]): SnapResult<number>;
export function snapToClosest(kind: "resolution", value: string, allowed: readonly string[]): SnapResult<string>;
export function snapToClosest(kind: "quality", value: string, allowed: readonly string[]): SnapResult<string>;
export function snapToClosest(kind: "ratio" | "seconds" | "resolution" | "quality", value: string | number, allowed: readonly (string | number)[]): SnapResult<string | number> {
    if (kind === "seconds") return snapSeconds(value, allowed as readonly number[]);
    const text = String(value);
    const options = allowed as readonly string[];
    if (kind === "ratio") return snapRatio(text, options);
    if (kind === "resolution") return snapResolution(text, options);
    return snapQuality(text, options);
}

function isLegalVideoRatio(value: string) {
    return (LEGAL_VIDEO_RATIOS as readonly string[]).includes(value);
}

/** True when a legacy shared `size` is a video ratio and its pixels are not an image-page 4K leak. */
export function isAdoptableLegacyVideoSize(value: string) {
    const trimmed = value.trim();
    if (!trimmed || trimmed.toLowerCase() === "auto") return false;
    if (isLegalVideoRatio(trimmed)) return true;
    const pixels = /^(\d+)x(\d+)$/i.exec(trimmed);
    if (!pixels) return false;
    const width = Number(pixels[1]);
    const height = Number(pixels[2]);
    if (!width || !height) return false;
    if (Math.min(width, height) > MAX_LEGACY_VIDEO_SHORT_SIDE) return false;
    const target = width / height;
    return LEGAL_VIDEO_RATIOS.some((ratio) => {
        const [w, h] = ratio.split(":").map(Number);
        const score = w / h;
        return Math.abs(target - score) / score <= 0.03;
    });
}

/**
 * Read-time video size. Keeps an existing `videoSize`. Otherwise copies a legal legacy `size`
 * and leaves that field untouched. Anything else (image 4K, non-video ratio) becomes 1280x720.
 */
export function deriveVideoSize(videoSize: string | undefined, legacySize: string | undefined) {
    const current = videoSize?.trim();
    if (current) return current;
    const legacy = legacySize?.trim() || "";
    if (isAdoptableLegacyVideoSize(legacy)) return legacy;
    return DEFAULT_VIDEO_SIZE;
}

export function imageChannelFormatOf(input: { apiFormat?: string | null; imageApi?: string | null }): ImageChannelFormat {
    if (input.apiFormat === "gemini") return "gemini";
    if (input.imageApi === "siliconflow" || input.imageApi === "chat") return input.imageApi;
    return "openai";
}

/** True when 高清 is a distinct request (high / hd / imageSize 2K), not a second label for the same payload. */
export function imageQualitySupportsHd(caps: ImageCaps) {
    const spec = caps.quality;
    if (!spec) return false;
    if (spec.param === "imageSize") return true;
    const values = new Set(spec.values.map((item) => item.toLowerCase()));
    return values.has("hd") || values.has("high");
}

const PRIMARY_IMAGE_RATIOS = ["1:1", "3:4", "4:3", "9:16", "16:9"];

export function primaryImageRatios(caps: ImageCaps) {
    // 合法比例不多（gpt-image-1：1:1 / 3:2 / 2:3；dall-e-3：1:1 / 16:9 / 9:16）时全部直接展示。
    if (caps.ratios.length <= 5) return caps.ratios;
    return PRIMARY_IMAGE_RATIOS.filter((ratio) => caps.ratios.includes(ratio));
}

export function extraImageRatios(caps: ImageCaps) {
    if (caps.ratios.length <= 5) return [];
    return caps.ratios.filter((ratio) => !PRIMARY_IMAGE_RATIOS.includes(ratio));
}

export type ImageSendField = "size" | "image_size" | "aspectRatio" | "none";

export type ImageSendPlan = {
    /** Ratio the picker should show. "auto" when size is auto or the model lists no ratios. */
    ratio: string;
    sizeField: ImageSendField;
    sizeValue?: string;
    quality?: { param: "quality" | "imageSize"; value: string };
    background?: "transparent";
    /** Set when stored pixels are exactly a tier preset the model can send. */
    tier?: "1k" | "2k" | "4k";
    /** Pixel value is one of caps.sizes, so generic edge/pixel checks do not apply (dall-e-2 256). */
    fixedSize: boolean;
    /** Stored size is not auto, a ratio, or WxH, and this channel would have to send a size. */
    invalid: boolean;
};

export type ImageAdjustment =
    | { kind: "ratio"; from: string; to: string; write: { key: "size"; value: string } }
    | { kind: "pixels"; from: string; to: string; write: { key: "size"; value: string } }
    | { kind: "count"; from: number; to: number; write: { key: "count"; value: string } }
    | { kind: "quality"; write: { key: "quality"; value: "standard" } }
    | { kind: "transparent" };

function isGptImageFamily(model: string) {
    return /gpt-image/.test(bareModel(model));
}

function pixelCount(value: string) {
    const pixels = parsePixelSize(value);
    return pixels ? pixels.width * pixels.height : 0;
}

function closestFixedSize(value: string, sizes: readonly string[]) {
    const target = ratioNumber(value) ?? 1;
    let best = sizes[0] || value;
    let bestScore = Number.POSITIVE_INFINITY;
    let bestPixels = -1;
    for (const size of sizes) {
        const score = Math.abs((ratioNumber(size) ?? 1) - target);
        const pixels = pixelCount(size);
        if (score < bestScore - 1e-6 || (Math.abs(score - bestScore) < 1e-6 && pixels > bestPixels)) {
            best = size;
            bestScore = score;
            bestPixels = pixels;
        }
    }
    return best;
}

/** 1K/2K/4K pixels for a ratio. Does not read quality. */
export function imageTierSize(ratio: string, tier: "1k" | "2k" | "4k" = "1k") {
    const token = ratio === "auto" || !ratio ? "1:1" : ratio;
    const preset = imageSizePresets[tier]?.[token];
    if (preset) return preset;
    const parsed = parseAspectRatio(token);
    if (!parsed) return imageSizePresets["1k"]["1:1"];
    const shortSide = tier === "4k" ? 2880 : tier === "2k" ? 2048 : 1024;
    const landscape = parsed.width >= parsed.height;
    const longRatio = landscape ? parsed.width / parsed.height : parsed.height / parsed.width;
    // Extra ratios are Gemini aspect-only tier markers; these pixels are never sent.
    // Keep each tier distinct. Actual pixel requests still use image.ts size validation.
    const longSide = Math.round((shortSide * longRatio) / 16) * 16;
    const short = Math.round(shortSide / 16) * 16;
    const width = landscape ? longSide : short;
    const height = landscape ? short : longSide;
    return `${width}x${height}`;
}

function matchedTier(size: string, caps: ImageCaps): "1k" | "2k" | "4k" | undefined {
    if (!caps.tiers?.length) return undefined;
    const pixels = parsePixelSize(size);
    if (!pixels) return undefined;
    const key = `${pixels.width}x${pixels.height}`;
    return caps.tiers.find((tier) => caps.ratios.some((ratio) => imageTierSize(ratio, tier) === key));
}

function displayRatio(size: string, caps: ImageCaps) {
    const raw = size.trim();
    if (!raw || raw.toLowerCase() === "auto" || !caps.ratios.length) return "auto";
    const exact = caps.ratios.find((ratio) => ratio.toLowerCase() === raw.toLowerCase());
    if (exact) return exact;
    const pixels = parsePixelSize(raw);
    const source = pixels ? `${pixels.width}:${pixels.height}` : raw;
    if (!parseAspectRatio(source) && !pixels) return snapToClosest("ratio", "1:1", caps.ratios).value;
    return snapToClosest("ratio", source, caps.ratios).value;
}

function classifyStoredSize(size: string) {
    const raw = size.trim();
    if (!raw || raw.toLowerCase() === "auto") return { kind: "auto" } as const;
    const pixels = parsePixelSize(raw);
    if (pixels) return { kind: "pixels", ...pixels } as const;
    if (parseAspectRatio(raw)) return { kind: "ratio", value: raw } as const;
    return { kind: "other", value: raw } as const;
}

/**
 * What an image request should actually send. Quality never changes the pixel tier:
 * a ratio becomes the 1K preset, and 高清 only changes the quality / imageSize field.
 */
export function planImageRequest(input: { model: string; size: string; quality: string; background?: string; channel?: ImageChannelFormat }): ImageSendPlan {
    const channel = input.channel || "openai";
    const caps = getImageCaps(input.model, channel);
    const stored = classifyStoredSize(input.size || "");
    const ratio = displayRatio(input.size || "", caps);
    const tier = matchedTier(input.size || "", caps);
    const mapped = mapImageQualityParam(input.quality, caps);
    let quality = mapped.send ? { param: mapped.param, value: mapped.value } : undefined;
    if (tier && caps.quality?.param === "imageSize" && caps.tiers?.includes(tier)) {
        quality = { param: "imageSize", value: tier.toUpperCase() };
    }
    const background = caps.transparent && input.background?.trim().toLowerCase() === "transparent" ? "transparent" : undefined;
    const base = { ratio, quality, background, tier, fixedSize: false, invalid: false } satisfies Partial<ImageSendPlan>;

    if (channel === "chat" || (Array.isArray(caps.sizes) && caps.sizes.length === 0)) {
        return { ...base, sizeField: "none" };
    }

    if (channel === "gemini") {
        if (stored.kind === "auto") return { ...base, sizeField: "none" };
        if (stored.kind === "other") return { ...base, sizeField: "none", invalid: true };
        return { ...base, sizeField: "aspectRatio", sizeValue: ratio === "auto" ? caps.ratios[0] : ratio };
    }

    if (stored.kind === "auto") {
        if (channel === "openai" && isGptImageFamily(input.model)) return { ...base, sizeField: "size", sizeValue: "auto" };
        return { ...base, sizeField: "none" };
    }

    if (stored.kind === "other") {
        return { ...base, sizeField: "none", invalid: true };
    }

    if (Array.isArray(caps.sizes)) {
        const exact = stored.kind === "pixels" ? caps.sizes.find((item) => item.toLowerCase() === `${stored.width}x${stored.height}`) : undefined;
        const sizeValue = exact || closestFixedSize(stored.kind === "pixels" ? `${stored.width}x${stored.height}` : ratio, caps.sizes);
        return { ...base, sizeField: "size", sizeValue, fixedSize: true };
    }

    const pixels = stored.kind === "pixels" ? `${stored.width}x${stored.height}` : imageTierSize(ratio, "1k");
    if (channel === "siliconflow") return { ...base, sizeField: "image_size", sizeValue: pixels };
    return { ...base, sizeField: "size", sizeValue: pixels };
}

/** Changes to persist when the selected model cannot honor the current settings. Does not rewrite legacy quality that still maps. */
export function collectImageAdjustments(input: { model: string; size: string; quality: string; count: string; background?: string; channel?: ImageChannelFormat; maxCount?: number }): ImageAdjustment[] {
    const channel = input.channel || "openai";
    const caps = getImageCaps(input.model, channel);
    const adjustments: ImageAdjustment[] = [];
    const stored = classifyStoredSize(input.size || "");
    const limit = Math.max(1, Math.min(caps.maxCount, input.maxCount ?? caps.maxCount));

    if (!caps.ratios.length) {
        if (stored.kind !== "auto") {
            const from = stored.kind === "pixels" ? `${stored.width}x${stored.height}` : stored.kind === "ratio" ? stored.value : stored.value;
            adjustments.push({ kind: "ratio", from, to: "auto", write: { key: "size", value: "auto" } });
        }
    } else if (stored.kind === "ratio") {
        const exact = caps.ratios.find((ratio) => ratio.toLowerCase() === stored.value.toLowerCase());
        if (!exact) {
            const snapped = snapToClosest("ratio", stored.value, caps.ratios).value;
            adjustments.push({ kind: "ratio", from: stored.value, to: snapped, write: { key: "size", value: snapped } });
        }
    } else if (stored.kind === "pixels" && Array.isArray(caps.sizes)) {
        const current = `${stored.width}x${stored.height}`;
        const exact = caps.sizes.find((item) => item.toLowerCase() === current.toLowerCase());
        if (!exact) {
            const legal = closestFixedSize(current, caps.sizes);
            adjustments.push({ kind: "pixels", from: current, to: legal, write: { key: "size", value: legal } });
        }
    } else if (stored.kind === "other") {
        const snapped = snapToClosest("ratio", "1:1", caps.ratios).value;
        adjustments.push({ kind: "ratio", from: stored.value, to: snapped, write: { key: "size", value: snapped } });
    }

    const count = Math.max(1, Math.floor(Math.abs(Number(input.count)) || 1));
    if (count > limit) adjustments.push({ kind: "count", from: count, to: limit, write: { key: "count", value: String(limit) } });

    if (caps.quality && !imageQualitySupportsHd(caps) && normalizeImageQuality(input.quality) === "hd") {
        adjustments.push({ kind: "quality", write: { key: "quality", value: "standard" } });
    }

    if (input.background?.trim().toLowerCase() === "transparent" && !caps.transparent) adjustments.push({ kind: "transparent" });
    return adjustments;
}

// ---- Video request plan (P0-5): one parameter form per paramStyle ----

export type VideoSendPlan = {
    caps: VideoCaps;
    /** "auto" only for relay models; Veo / Sora always resolve to a listed ratio. */
    ratio: string;
    resolution: VideoResolution;
    seconds: number;
    /** WxH the UI shows as「将发送 …」. Undefined when no size is sent. */
    size?: string;
    /** Custom pixels from 高级 · 自定义尺寸 (relay models only). */
    customSize?: string;
    fields: Record<string, string | number>;
};

function videoRatioOf(value: string) {
    const raw = (value || "").trim();
    if (!raw || raw.toLowerCase() === "auto") return "auto";
    const ratio = parseAspectRatio(raw);
    if (ratio) return raw;
    const pixels = parsePixelSize(raw);
    if (!pixels) return "auto";
    return snapToClosest("ratio", `${pixels.width}:${pixels.height}`, RELAY_VIDEO_RATIOS).value;
}

function evenPixels(value: number) {
    return Math.max(2, Math.round(value / 2) * 2);
}

/** Short side = resolution; e.g. 16:9@720p → 1280x720. */
export function videoPresetSize(ratio: string, resolution: string, caps?: VideoCaps) {
    const mapped = caps?.sizeMap?.[`${ratio}@${resolution}`];
    if (mapped) return mapped;
    const parsed = parseAspectRatio(ratio);
    if (!parsed) return undefined;
    const short = Number(resolution.replace(/p$/, "")) || 720;
    const landscape = parsed.width >= parsed.height;
    const width = evenPixels(landscape ? (short * parsed.width) / parsed.height : short);
    const height = evenPixels(landscape ? short : (short * parsed.height) / parsed.width);
    return `${width}x${height}`;
}

export function videoSecondsOptions(caps: VideoCaps) {
    if (Array.isArray(caps.seconds)) return caps.seconds;
    const list: number[] = [];
    for (let value = caps.seconds.min; value <= caps.seconds.max; value += 1) list.push(value);
    return list;
}

/**
 * What a video request should send. Reads the stored `videoSize` (ratio, or legacy WxH),
 * `vquality` and `videoSeconds`, snaps them to the model, and returns the single field set:
 * - openai-sora → size (+ seconds)
 * - veo → aspectRatio + resolution (+ durationSeconds)
 * - relay-extended → size, or resolution_name when the ratio is 自动
 */
export function planVideoRequest(input: { model: string; apiFormat?: VideoChannelFormat; videoSize: string; vquality: string; seconds: string }): VideoSendPlan {
    const caps = getVideoCaps(input.model, input.apiFormat);
    const storedRatio = videoRatioOf(input.videoSize);
    const ratio = storedRatio === "auto" ? (caps.paramStyle === "relay-extended" ? "auto" : caps.ratios[0]) : caps.ratios.includes(storedRatio) ? storedRatio : snapToClosest("ratio", storedRatio, caps.ratios).value;
    const resolution = snapToClosest("resolution", /^\d+$/.test(input.vquality?.trim() || "") ? `${input.vquality.trim()}p` : input.vquality || "720p", caps.resolutions).value as VideoResolution;
    const seconds = snapToClosest("seconds", input.seconds || "6", videoSecondsOptions(caps)).value;
    const storedPixels = parsePixelSize(input.videoSize || "");
    const preset = ratio === "auto" ? undefined : videoPresetSize(ratio, resolution, caps);
    // Legacy WxH that equals a ratio@480/720/1080 preset is a preset, not a custom size.
    const storedKey = storedPixels ? `${storedPixels.width}x${storedPixels.height}` : "";
    const isLegacyPreset = Boolean(storedPixels && storedRatio !== "auto" && (["480p", "720p", "1080p"] as const).some((item) => videoPresetSize(storedRatio, item) === storedKey || videoPresetSize(storedRatio, item, caps) === storedKey));
    const isCustom = Boolean(caps.customSize && storedPixels && storedKey !== preset && !isLegacyPreset && ratio !== "auto");
    const customSize = isCustom && storedPixels ? `${storedPixels.width}x${storedPixels.height}` : undefined;
    if (caps.paramStyle === "veo") {
        return { caps, ratio, resolution, seconds, size: preset, fields: { aspectRatio: ratio, resolution, durationSeconds: seconds } };
    }
    if (caps.paramStyle === "openai-sora") {
        return { caps, ratio, resolution, seconds, size: preset, fields: { size: preset || DEFAULT_VIDEO_SIZE, seconds } };
    }
    const size = customSize || preset;
    return { caps, ratio, resolution, seconds, size, customSize, fields: size ? { size, seconds } : { resolution_name: resolution, seconds } };
}

export type VideoAdjustment = { key: "videoSize" | "vquality" | "videoSeconds"; value: string; note: string };

/** Values to write back when the selected video model cannot honor the stored ones. */
export function collectVideoAdjustments(input: { model: string; apiFormat?: VideoChannelFormat; videoSize: string; vquality: string; seconds: string }): VideoAdjustment[] {
    const plan = planVideoRequest(input);
    const list: VideoAdjustment[] = [];
    const storedRatio = videoRatioOf(input.videoSize);
    if (storedRatio !== plan.ratio && !(storedRatio === "auto" && plan.caps.paramStyle === "relay-extended")) list.push({ key: "videoSize", value: plan.ratio, note: `比例 ${storedRatio === "auto" ? "自动" : storedRatio} → ${plan.ratio}` });
    const storedResolution = /^\d+$/.test(input.vquality?.trim() || "") ? `${input.vquality.trim()}p` : input.vquality;
    const legacyAlias = ["", "auto", "high", "medium", "low"].includes((input.vquality || "").trim().toLowerCase());
    if (storedResolution !== plan.resolution && !(legacyAlias && plan.caps.resolutions.includes(plan.resolution) && snapToClosest("resolution", input.vquality || "auto", plan.caps.resolutions).value === plan.resolution)) list.push({ key: "vquality", value: plan.resolution.replace(/p$/, ""), note: `清晰度 → ${plan.resolution}` });
    if (input.seconds && String(Math.round(Number(input.seconds) || 0)) !== String(plan.seconds)) list.push({ key: "videoSeconds", value: String(plan.seconds), note: `时长 ${input.seconds || "-"} 秒 → ${plan.seconds} 秒` });
    return list;
}
