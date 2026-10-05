import { nanoid } from "nanoid";
import { presetApiFlags } from "@/constant/brand";
import { collectImageAdjustments, collectVideoAdjustments, getImageCaps, imageChannelFormatOf, normalizeImageQuality, planImageRequest, planVideoRequest } from "@/lib/model-capabilities";
import { modelOptionName, resolveModelRequestConfig, resolveVideoSize, type AiConfig } from "@/stores/use-config-store";
import type { ReferenceImage } from "@/types/image";

export type ComposerMode = "image" | "video";
export type ComposerParameters = Pick<AiConfig, "imageModel" | "videoModel" | "size" | "videoSize" | "quality" | "background" | "count" | "vquality" | "videoSeconds" | "videoGenerateAudio" | "videoWatermark" | "videoMode">;
export type CreationSnapshot = {
    id: string;
    mode: ComposerMode;
    prompt: string;
    parameters: ComposerParameters;
    actual: Record<string, string | number>;
    referenceIds: string[];
    references?: ReferenceImage[];
    composerContent?: string;
};
export type ComposerSubmission = CreationSnapshot & { references: ReferenceImage[]; canvas: boolean; canvasProjectId?: string };

export function composerPlans(config: AiConfig) {
    const imageModel = config.imageModel || config.model;
    const imageRequest = resolveModelRequestConfig(config, imageModel);
    const channel = imageChannelFormatOf({ apiFormat: imageRequest.apiFormat, imageApi: presetApiFlags(imageRequest.baseUrl).imageApi });
    const videoRequest = resolveModelRequestConfig(config, config.videoModel);
    return {
        channel,
        imageCaps: getImageCaps(modelOptionName(imageModel), channel),
        image: planImageRequest({ model: modelOptionName(imageModel), channel, size: config.size, quality: config.quality, background: config.background }),
        video: planVideoRequest({ model: modelOptionName(config.videoModel), apiFormat: videoRequest.apiFormat, videoSize: resolveVideoSize(config), vquality: config.vquality, seconds: config.videoSeconds }),
    };
}

export function normalizeComposerConfig(config: AiConfig, mode: ComposerMode, imageCountLimit = 10) {
    const plans = composerPlans(config);
    const next = { ...config };
    const notes: string[] = [];
    if (mode === "image") {
        next.count = String(Math.max(1, Math.min(imageCountLimit, Number(config.count) || 1)));
        for (const item of collectImageAdjustments({ model: modelOptionName(config.imageModel || config.model), channel: plans.channel, size: config.size, quality: config.quality, count: config.count, background: config.background })) {
            if (item.kind === "count") continue; // Workbench: one request per slot, existing limit remains 10.
            if (item.kind === "transparent") {
                next.background = "";
                notes.push("透明背景 → 关闭");
            } else {
                next[item.write.key] = item.write.value;
                notes.push(item.kind === "quality" ? "画质 → 标准" : `尺寸 ${item.from} → ${item.to}`);
            }
        }
        if (!plans.imageCaps.quality) {
            next.quality = "standard";
            if (normalizeImageQuality(config.quality) === "hd") notes.push("画质 高清 → 由模型决定");
        }
    } else {
        if (!plans.video.caps.modes.includes(config.videoMode as "frames" | "reference")) {
            next.videoMode = plans.video.caps.modes[0];
            notes.push("参考方式 → 单图/首帧");
        }
        const request = resolveModelRequestConfig(config, config.videoModel);
        for (const item of collectVideoAdjustments({ model: modelOptionName(config.videoModel), apiFormat: request.apiFormat, videoSize: resolveVideoSize(config), vquality: config.vquality, seconds: config.videoSeconds })) {
            next[item.key] = item.value;
            notes.push(item.note);
        }
    }
    return { config: next, notes };
}

export function uniqueReferences(references: ReferenceImage[]) {
    const ids = new Set<string>();
    const seen = new Set<string>();
    return references.filter((ref) => {
        const key = ref.storageKey || ref.dataUrl || ref.id;
        if (ids.has(ref.id) || seen.has(key)) return false;
        ids.add(ref.id);
        seen.add(key);
        return true;
    });
}

export function createComposerSubmission(mode: ComposerMode, prompt: string, references: ReferenceImage[], config: AiConfig, canvas = false, imageCountLimit = 10): ComposerSubmission {
    const normalized = normalizeComposerConfig(config, mode, imageCountLimit).config;
    const refs = uniqueReferences(references);
    const text = prompt
        .replace(/@\[ref:([^\]]+)\]/g, (_, id: string) => {
            const index = refs.findIndex((ref) => ref.id === id);
            if (index < 0) throw new Error("引用已失效，请移除正文中的引用或重新添加素材");
            return `参考图${index + 1}`;
        })
        .trim();
    if (!text) throw new Error("先写一句想要的画面");
    const plans = composerPlans(normalized);
    if (mode === "image" && plans.image.invalid) throw new Error("请调整为模型支持的尺寸");
    if (mode === "image" && plans.channel === "siliconflow" && refs.length > 1) throw new Error("此渠道编辑只使用第一张图，请保留一张参考图后提交");
    if (mode === "video" && refs.length > 7) throw new Error("视频沿用最多 7 张收集上限，请减少附件后提交");
    if (mode === "video" && plans.video.caps.paramStyle === "openai-sora" && refs.length > 1) throw new Error("Sora 当前仅接入单张参考图，尾帧未核实，请保留一张后提交");
    if (mode === "video" && normalized.videoMode === "frames" && plans.video.caps.paramStyle !== "openai-sora" && refs.length > 2) throw new Error("首尾帧模式只发送前两张；请移除多余图片或选择多图参考");
    const { imageModel, videoModel, size, videoSize, quality, background, count, vquality, videoSeconds, videoGenerateAudio, videoWatermark, videoMode } = normalized;
    const parameters = { imageModel, videoModel, size, videoSize, quality, background, count, vquality, videoSeconds, videoGenerateAudio, videoWatermark, videoMode };
    const actual =
        mode === "video"
            ? {
                  ...plans.video.fields,
                  ...(plans.video.caps.paramStyle === "veo"
                      ? { generateAudio: normalized.videoGenerateAudio, addWatermark: normalized.videoWatermark }
                      : plans.video.caps.paramStyle === "relay-extended"
                        ? { generate_audio: normalized.videoGenerateAudio, watermark: normalized.videoWatermark, mode: normalized.videoMode }
                        : {}),
              }
            : {
                  ...(plans.image.sizeField !== "none" && plans.image.sizeValue ? { [plans.image.sizeField]: plans.image.sizeValue } : {}),
                  ...(plans.image.quality ? { [plans.image.quality.param]: plans.image.quality.value } : {}),
                  ...(plans.image.background ? { background: plans.image.background } : {}),
                  ...(plans.channel === "openai" ? { n: 1, output_format: "png" } : plans.channel === "siliconflow" ? { batch_size: 1 } : {}),
              };
    return { id: nanoid(), mode, prompt: text, parameters, actual, composerContent: prompt, references: refs.map((ref) => ({ ...ref })), referenceIds: refs.map((ref) => ref.id), canvas };
}

export function creationSnapshot(submission: ComposerSubmission): CreationSnapshot {
    const { id, mode, prompt, parameters, actual, referenceIds, composerContent, references } = submission;
    return { id, mode, prompt, parameters: { ...parameters }, actual: { ...actual }, referenceIds: [...referenceIds], composerContent, references: references.map((ref) => ({ ...ref, dataUrl: ref.storageKey ? "" : ref.dataUrl, url: ref.storageKey ? undefined : ref.url })) };
}

/** Ctrl/⌘ + Enter in the prompt box triggers generation. */
export function isGenerateShortcut(event: { key: string; metaKey: boolean; ctrlKey: boolean; nativeEvent?: { isComposing?: boolean } }) {
    return event.key === "Enter" && (event.metaKey || event.ctrlKey) && !event.nativeEvent?.isComposing;
}
