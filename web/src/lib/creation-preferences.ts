import { normalizeComposerConfig, type ComposerMode, type ComposerParameters } from "@/lib/composer";
import type { AiConfig } from "@/stores/use-config-store";

export const parameterKeys: Record<ComposerMode, (keyof ComposerParameters)[]> = {
    image: ["imageModel", "size", "quality", "background", "count"],
    video: ["videoModel", "videoSize", "vquality", "videoSeconds", "videoGenerateAudio", "videoWatermark", "videoMode"],
};
export type CreationPreset = { id: string; title: string; mode: ComposerMode; parameters: Partial<ComposerParameters> };
export function presetParameters(config: AiConfig, mode: ComposerMode): Partial<ComposerParameters> {
    return Object.fromEntries(parameterKeys[mode].map((key) => [key, config[key]]));
}
export function applyCreationPreset(preset: CreationPreset, current: AiConfig, keepModel: boolean, limit: number) {
    const parameters = Object.fromEntries(parameterKeys[preset.mode].filter((key) => !keepModel || !key.endsWith("Model")).map((key) => [key, preset.parameters[key] ?? current[key]]));
    const next = normalizeComposerConfig({ ...current, ...parameters }, preset.mode, limit);
    if (preset.mode === "image" && parameters.count !== next.config.count) next.notes.push(`张数 ${parameters.count} → ${next.config.count}`);
    return next;
}
