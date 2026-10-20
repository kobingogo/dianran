// [dianran] Turn a fetched model list into channel models + sensible defaults per capability.
import { guessCapability, type ChannelModel, type ModelCapability } from "@/stores/use-config-store";
import type { PresetProvider } from "@/constant/brand";

const CAPS: ModelCapability[] = ["image", "video", "text", "audio"];
/** Models that look like text but are not chat models. */
const NON_CHAT = /embed|whisper|moderation|transcri|realtime|search|rerank|similarity|davinci|babbage|-instruct|audio-preview|computer-use|ocr|bge-|aqa/i;
const MAX_TEXT_MODELS = 40;

export type PickedDefaults = Partial<Record<ModelCapability, string>>;

export function buildChannelModels(names: string[], preset?: PresetProvider): { models: ChannelModel[]; defaults: PickedDefaults; counts: Record<ModelCapability, number>; total: number } {
    const unique = Array.from(new Set(names.map((name) => name.trim()).filter(Boolean)));
    const typed = unique.map((name) => ({ name, capability: guessCapability(name) }));
    const usable = typed.filter((model) => model.capability !== "text" || !NON_CHAT.test(model.name));
    const recommendedText = new Set(preset?.recommended?.text || []);
    const nonText = usable.filter((model) => model.capability !== "text");
    const text = usable.filter((model) => model.capability === "text").sort((a, b) => Number(recommendedText.has(b.name)) - Number(recommendedText.has(a.name)));
    const models = [...nonText, ...text.slice(0, MAX_TEXT_MODELS)];
    const defaults: PickedDefaults = {};
    for (const cap of CAPS) {
        const ofCap = models.filter((model) => model.capability === cap);
        if (!ofCap.length) continue;
        const preferred =
            (preset?.recommended?.[cap] || []).find((name) => ofCap.some((model) => model.name === name)) ||
            (preset?.recommended?.[cap] || []).map((name) => ofCap.find((model) => model.name.toLowerCase().includes(name.toLowerCase()))?.name).find(Boolean);
        defaults[cap] = preferred || ofCap[0].name;
    }
    const counts = CAPS.reduce((acc, cap) => ({ ...acc, [cap]: models.filter((model) => model.capability === cap).length }), {} as Record<ModelCapability, number>);
    return { models, defaults, counts, total: unique.length };
}
