import type { ReactNode } from "react";

import { ModelPicker } from "@/components/model-picker";
import { modelOptionName, resolveModelChannel, type AiConfig, type ModelCapability } from "@/stores/use-config-store";

const PROVIDERS: Array<[RegExp, string, string]> = [
    [/gpt|dall-?e|sora|openai|o\d/i, "GPT", "#1b1916"],
    [/gemini|imagen|veo|nano-banana/i, "G", "#35575e"],
    [/grok/i, "X", "#3a362f"],
    [/flux|kolors|qwen|wan|siliconflow|kling|hunyuan|seed|doubao|jimeng/i, "AI", "#b7791f"],
];

function providerBadge(model: string) {
    const hit = PROVIDERS.find(([pattern]) => pattern.test(model));
    return hit ? { text: hit[1], color: hit[2] } : { text: model.slice(0, 2).toUpperCase() || "·", color: "#6b645a" };
}

/** PLAN 5.4 ModelCard：服务商色块头像 + 模型选择 + 渠道名 + 能力摘要。 */
export function ModelCard({ config, value, onChange, capability, summary, onMissingConfig }: { config: AiConfig; value: string; onChange: (model: string) => void; capability: ModelCapability; summary?: ReactNode; onMissingConfig?: () => void }) {
    const name = value ? modelOptionName(value) : "";
    const badge = providerBadge(name);
    const channelName = value ? resolveModelChannel(config, value).name : "";
    return (
        <div className="flex items-center gap-2.5 rounded-[var(--r-lg)] border border-[var(--line)] bg-[var(--paper-0)] px-3 py-2.5 shadow-[var(--sh-1)]">
            <span aria-hidden className="grid size-8 shrink-0 place-items-center rounded-[9px] text-xs font-bold text-[#fbf8f2]" style={{ background: badge.color }}>
                {badge.text}
            </span>
            <div className="min-w-0 flex-1">
                <ModelPicker config={config} value={value} onChange={onChange} capability={capability} fullWidth className="model-card-picker h-6 border-0 !bg-transparent px-0 text-sm font-semibold shadow-none" onMissingConfig={onMissingConfig} />
                <div className="truncate text-[11.5px] leading-4 text-[color:var(--ink-400)]">
                    {[channelName, summary].filter(Boolean).map((item, index) => (
                        <span key={index}>
                            {index ? " · " : ""}
                            {item}
                        </span>
                    ))}
                </div>
            </div>
        </div>
    );
}
