import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { App, ConfigProvider, Switch } from "antd";
import { ChevronDown } from "lucide-react";

import { CapabilityNote } from "@/components/ui/capability-note";
import { RatioPicker, ratioName } from "@/components/ui/ratio-picker";
import { InkSegmented } from "@/components/ui/segmented";
import { InkStepper } from "@/components/ui/stepper";
import { type CanvasTheme } from "@/lib/canvas-theme";
import { inferMediaRatio, mediaRatioOptions, parsePixelSize } from "@/lib/media-size";
import {
    collectImageAdjustments,
    extraImageRatios,
    getImageCaps,
    imageChannelFormatOf,
    imageQualitySupportsHd,
    imageTierSize,
    normalizeImageQuality,
    planImageRequest,
    primaryImageRatios,
    type ImageCaps,
    type ImageChannelFormat,
    type ImageSendPlan,
} from "@/lib/model-capabilities";
import { presetApiFlags } from "@/constant/brand";
import { modelOptionName, resolveModelRequestConfig, type AiConfig } from "@/stores/use-config-store";

const DIMENSION_STEP = 16;

/** 画质只有两档。旧值 auto/high/medium/low 读取时映射（auto/medium/low → 标准，high → 高清），不回写。 */
export const imageQualityOptions = [
    { value: "standard", label: "标准" },
    { value: "hd", label: "高清" },
];
export const imageAspectOptions = mediaRatioOptions.map((item) => ({ value: item.value, label: item.value === "auto" ? "自动" : item.value }));
export const imageScaleOptions = ["1k", "2k", "4k"].map((value) => ({ value, label: value.toUpperCase() }));

type ImageSettingsPanelProps = {
    config: AiConfig;
    onConfigChange: (key: "quality" | "size" | "count" | "background", value: string) => void;
    theme: CanvasTheme;
    /** 实际使用的模型（生图页传 imageModel；画布节点用 config.model）。 */
    model?: string;
    showTitle?: boolean;
    className?: string;
    maxCount?: number;
    quickCount?: number;
    /** 在面板内显示张数步进器（生图页工作台自己渲染时可关掉）。 */
    showCount?: boolean;
};

/** 请求所走的生图渠道：Gemini / SiliconFlow / Chat 图像接口 / OpenAI 格式。 */
export function imageChannelForModel(config: AiConfig, model: string): ImageChannelFormat {
    if (!model) return "openai";
    const request = resolveModelRequestConfig(config, model);
    return imageChannelFormatOf({ apiFormat: request.apiFormat, imageApi: presetApiFlags(request.baseUrl).imageApi });
}

export function useImageCapabilities(config: AiConfig, model: string) {
    return useMemo(() => {
        const channel = imageChannelForModel(config, model);
        const caps = getImageCaps(modelOptionName(model || ""), channel);
        const plan = planImageRequest({ model: modelOptionName(model || ""), size: config.size || "auto", quality: config.quality, background: config.background, channel });
        return { channel, caps, plan };
    }, [config, model]);
}

/** 「将发送 size=1024×1024」：界面上展示真实请求值。 */
export function describeImagePlan(plan: ImageSendPlan) {
    const value = plan.sizeValue?.replace("x", "×");
    if (plan.sizeField === "size") return value === "auto" ? "将发送 size=auto（由模型决定尺寸）" : `将发送 size=${value}`;
    if (plan.sizeField === "image_size") return `将发送 image_size=${value}`;
    if (plan.sizeField === "aspectRatio") return `将发送 aspectRatio=${plan.sizeValue}${plan.quality?.param === "imageSize" ? ` · imageSize=${plan.quality.value}` : "（像素由模型决定）"}`;
    return "不发送尺寸，由模型决定";
}

export function imageQualityHint(caps: ImageCaps, level: "standard" | "hd") {
    if (caps.quality?.param === "imageSize") return level === "hd" ? "2K · 较慢 · 约 2×" : "1K · 快 · 约 1×";
    return level === "hd" ? "较慢 · 约 2–4×" : "快 · 约 1×";
}

export function capsSummary(caps: ImageCaps) {
    if (!caps.known) return "能力未知，参数可能被忽略";
    const parts = [caps.ratios.length ? `${caps.ratios.length} 种比例` : "不支持尺寸", caps.quality && imageQualitySupportsHd(caps) ? "标准/高清" : null, caps.transparent ? "透明背景" : null];
    return parts.filter(Boolean).join(" / ");
}

export function ImageSettingsPanel({ config, onConfigChange, theme, model: modelProp, showTitle = true, className = "w-[320px] space-y-4 rounded-2xl px-1 py-0.5", maxCount = 15, showCount = true }: ImageSettingsPanelProps) {
    const { message } = App.useApp();
    const model = modelProp ?? config.model;
    const modelName = modelOptionName(model || "");
    const { caps, plan, channel } = useImageCapabilities(config, model);
    const [adjustNote, setAdjustNote] = useState("");
    const [advancedOpen, setAdvancedOpen] = useState(false);
    const [snapDimensionToStep, setSnapDimensionToStep] = useState(true);
    const lastModelRef = useRef<string | null>(null);
    const quality = normalizeImageQuality(config.quality);
    const count = Math.max(1, Math.min(maxCount, Math.floor(Math.abs(Number(config.count)) || 1)));
    const storedSize = (config.size || "auto").trim();
    const isAuto = !storedSize || storedSize.toLowerCase() === "auto";
    const selectedRatio = isAuto ? "auto" : plan.ratio;
    const customPixels = parsePixelSize(storedSize);
    const showHd = Boolean(caps.quality) && imageQualitySupportsHd(caps);
    const canCustomPixels = caps.sizes === "any" && channel !== "gemini";

    // P0-2：切换模型时，把不支持的比例 / 像素 / 画质 / 透明背景吸附到合法值，提示一次。
    useEffect(() => {
        if (lastModelRef.current === model) return;
        const first = lastModelRef.current === null;
        lastModelRef.current = model;
        if (!model) return;
        const adjustments = collectImageAdjustments({ model: modelName, size: config.size || "auto", quality: config.quality, count: config.count, background: config.background, channel }).filter((item) => item.kind !== "count");
        if (!adjustments.length) {
            if (!first) setAdjustNote("");
            return;
        }
        const notes: string[] = [];
        for (const item of adjustments) {
            if (item.kind === "ratio" || item.kind === "pixels") {
                onConfigChange("size", item.write.value);
                notes.push(`尺寸 ${item.from} → ${item.to === "auto" ? "自动" : item.to}`);
            } else if (item.kind === "quality") {
                onConfigChange("quality", "standard");
                notes.push("画质 → 标准");
            } else if (item.kind === "transparent") {
                notes.push("透明背景不生效");
            }
        }
        const text = `已按 ${modelName} 能力调整：${notes.join("；")}`;
        setAdjustNote(text);
        if (!first) message.info(text);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [model]);

    const selectRatio = (ratio: string) => onConfigChange("size", ratio === "auto" ? "auto" : ratio);
    const dimensions = customPixels || parsePixelSize(plan.sizeValue && plan.sizeValue !== "auto" ? plan.sizeValue : imageTierSize(selectedRatio === "auto" ? "1:1" : selectedRatio, "1k")) || { width: 1024, height: 1024 };
    const updateDimension = (key: "width" | "height", value: number | null) => {
        const next = Math.max(1, Math.floor(value || dimensions[key] || 1024));
        const width = key === "width" ? next : dimensions.width;
        const height = key === "height" ? next : dimensions.height;
        onConfigChange("size", `${alignDimension(width, snapDimensionToStep)}x${alignDimension(height, snapDimensionToStep)}`);
    };
    const tier = plan.tier || "1k";

    return (
        <ImageSettingsTheme theme={theme}>
            <div
                className={className}
                style={{ color: "var(--ink-900)" }}
                onMouseDown={(event) => {
                    event.stopPropagation();
                    if (event.target instanceof HTMLInputElement) return;
                    if (document.activeElement instanceof HTMLInputElement && event.currentTarget.contains(document.activeElement)) document.activeElement.blur();
                }}
            >
                {showTitle ? <div className="font-[family-name:var(--font-serif)] text-lg font-semibold">生图设置</div> : null}
                {!caps.known && model ? <CapabilityNote>「{modelName}」能力未知，参数可能被忽略。</CapabilityNote> : null}
                {adjustNote ? <CapabilityNote>{adjustNote}</CapabilityNote> : null}

                <Field label="比例" hint={caps.ratios.length ? `常用 ${primaryImageRatios(caps).length} 种 · 均受该模型支持` : undefined}>
                    {caps.ratios.length ? (
                        <>
                            <RatioPicker value={selectedRatio} primary={primaryImageRatios(caps)} extra={extraImageRatios(caps)} allowAuto onChange={selectRatio} />
                            <div className="mt-1.5 font-[family-name:var(--font-mono)] text-[11.5px] text-[color:var(--ink-400)]" data-testid="image-size-preview">
                                {describeImagePlan(plan)}
                                {customPixels && canCustomPixels ? " · 自定义像素" : ""}
                            </div>
                        </>
                    ) : (
                        <CapabilityNote>当前接口不支持尺寸设置，已隐藏；尺寸由模型决定。</CapabilityNote>
                    )}
                </Field>

                <Field label="画质" hint="影响速度与费用">
                    {showHd ? (
                        <InkSegmented
                            ariaLabel="画质"
                            value={quality}
                            onChange={(value) => onConfigChange("quality", value)}
                            options={[
                                { value: "standard", label: "标准", hint: imageQualityHint(caps, "standard") },
                                { value: "hd", label: "高清", hint: imageQualityHint(caps, "hd") },
                            ]}
                        />
                    ) : (
                        <CapabilityNote>当前模型不支持画质设置，已隐藏。</CapabilityNote>
                    )}
                </Field>

                {showCount || caps.transparent ? (
                    <div className="flex items-end gap-3.5">
                        {showCount ? (
                            <div className="min-w-0 flex-1">
                                <FieldLabel label="张数" />
                                <InkStepper ariaLabel="张数" value={count} max={maxCount} onChange={(value) => onConfigChange("count", String(value))} />
                            </div>
                        ) : null}
                        {caps.transparent ? (
                            <div className="min-w-0 flex-[1.3]">
                                <FieldLabel label="透明背景" hint="PNG" />
                                <InkSegmented
                                    ariaLabel="透明背景"
                                    value={config.background === "transparent" ? "on" : "off"}
                                    onChange={(value) => onConfigChange("background", value === "on" ? "transparent" : "")}
                                    options={[
                                        { value: "off", label: "关" },
                                        { value: "on", label: "开" },
                                    ]}
                                />
                            </div>
                        ) : null}
                    </div>
                ) : null}
                {showCount && count > caps.maxCount ? <div className="-mt-2 text-xs text-[color:var(--ink-500)]">超过该模型单次上限 {caps.maxCount} 张，将分 {Math.ceil(count / caps.maxCount)} 次请求</div> : null}

                {canCustomPixels || caps.tiers?.length || Array.isArray(caps.sizes) ? (
                    <div className="border-t border-dashed border-[var(--line-strong)] pt-3">
                        <button type="button" className="flex w-full cursor-pointer items-center justify-between border-0 bg-transparent p-0 text-[13px] text-[color:var(--ink-500)] hover:text-[color:var(--ink-900)]" aria-expanded={advancedOpen} onClick={() => setAdvancedOpen(!advancedOpen)}>
                            <span>高级 · {canCustomPixels ? "自定义像素" : caps.tiers?.length ? "分辨率档" : "合法尺寸"}</span>
                            <ChevronDown className={`size-4 transition-transform ${advancedOpen ? "rotate-180" : ""}`} strokeWidth={1.7} />
                        </button>
                        {advancedOpen ? (
                            <div className="mt-3 space-y-3">
                                {canCustomPixels ? (
                                    <div className="space-y-2">
                                        <div className="flex items-center justify-between gap-3">
                                            <FieldLabel label="自定义像素" inline />
                                            <label className="flex items-center gap-2 text-xs text-[color:var(--ink-500)]">
                                                16 倍数对齐
                                                <Switch size="small" checked={snapDimensionToStep} onChange={setSnapDimensionToStep} />
                                            </label>
                                        </div>
                                        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2.5">
                                            <DimensionInput prefix="W" value={dimensions.width} alignToStep={snapDimensionToStep} onChange={(value) => updateDimension("width", value)} />
                                            <span className="text-[color:var(--ink-400)]">×</span>
                                            <DimensionInput prefix="H" value={dimensions.height} alignToStep={snapDimensionToStep} onChange={(value) => updateDimension("height", value)} />
                                        </div>
                                        <div className="text-[11.5px] text-[color:var(--ink-400)]">边长为 16 的倍数、最长边 ≤ 3840、长宽比 ≤ 3；选回上方比例即恢复预设。</div>
                                    </div>
                                ) : null}
                                {caps.tiers?.length ? (
                                    <div>
                                        <FieldLabel label="分辨率档" hint="仅该模型支持" />
                                        <InkSegmented
                                            ariaLabel="分辨率档"
                                            size="sm"
                                            value={plan.tier || "auto"}
                                            onChange={(value) => onConfigChange("size", value === "auto" ? (selectedRatio === "auto" ? "auto" : selectedRatio) : imageTierSize(selectedRatio === "auto" ? "1:1" : selectedRatio, value as "1k" | "2k" | "4k"))}
                                            options={[{ value: "auto", label: "跟随画质" }, ...caps.tiers.map((item) => ({ value: item, label: item.toUpperCase() }))]}
                                        />
                                        {plan.tier ? <div className="mt-1 text-[11.5px] text-[color:var(--ink-400)]">已选 {tier.toUpperCase()}，覆盖画质对应的档位</div> : null}
                                    </div>
                                ) : null}
                                {Array.isArray(caps.sizes) && caps.sizes.length ? <div className="text-[11.5px] text-[color:var(--ink-500)]">该模型只接受：{caps.sizes.map((item) => item.replace("x", "×")).join(" / ")}</div> : null}
                            </div>
                        ) : null}
                    </div>
                ) : null}
            </div>
        </ImageSettingsTheme>
    );
}

export function ImageSettingsTheme({ theme, children }: { theme: CanvasTheme; children: ReactNode }) {
    return (
        <ConfigProvider
            theme={{
                token: { colorBgContainer: theme.toolbar.panel, colorBgElevated: theme.toolbar.panel, colorBorder: theme.node.stroke, colorPrimary: theme.node.activeStroke, colorText: theme.node.text, colorTextLightSolid: theme.node.panel },
                components: {
                    Button: { defaultBg: theme.toolbar.panel, defaultBorderColor: theme.node.stroke, defaultColor: theme.node.text },
                    Slider: { railBg: theme.node.stroke, railHoverBg: theme.node.stroke, trackBg: theme.node.activeStroke, handleColor: theme.node.text, handleActiveColor: theme.node.text },
                },
            }}
        >
            {children}
        </ConfigProvider>
    );
}

export function imageQualityLabel(value: string) {
    return normalizeImageQuality(value) === "hd" ? "高清" : "标准";
}

export function imageSizeLabel(size: string) {
    if (!size || size === "auto") return "自动";
    const pixels = parsePixelSize(size);
    if (pixels) return `${pixels.width}×${pixels.height}`;
    const ratio = inferMediaRatio(size);
    return ratio === "auto" ? "自动" : ratioName(ratio).split(" ")[0];
}

export function FieldLabel({ label, hint, inline }: { label: string; hint?: ReactNode; inline?: boolean }) {
    return (
        <div className={`flex items-center justify-between gap-3 text-[13px] font-semibold text-[color:var(--ink-700)] ${inline ? "" : "mb-2"}`}>
            <span>{label}</span>
            {hint ? <small className="text-xs font-normal text-[color:var(--ink-400)]">{hint}</small> : null}
        </div>
    );
}

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
    return (
        <section className="min-w-0">
            <FieldLabel label={label} hint={hint} />
            {children}
        </section>
    );
}

function DimensionInput({ prefix, value, alignToStep, onChange }: { prefix: string; value: number; alignToStep: boolean; onChange: (value: number | null) => void }) {
    const commit = (input: HTMLInputElement) => {
        const next = alignDimension(Math.max(1, Math.floor(Number(input.value) || value || 1024)), alignToStep);
        input.value = String(next);
        onChange(next);
    };
    return (
        <label className="flex h-9 overflow-hidden rounded-[var(--r-md)] border border-[var(--line)] bg-[var(--paper-0)] text-sm text-[color:var(--ink-900)]">
            <span className="grid w-8 place-items-center text-[color:var(--ink-400)]">{prefix}</span>
            <input
                type="number"
                min={1}
                aria-label={prefix === "W" ? "宽度" : "高度"}
                className="min-w-0 flex-1 bg-transparent px-1 font-[family-name:var(--font-mono)] outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                defaultValue={value || ""}
                key={`${prefix}-${value}`}
                onBlur={(event) => commit(event.currentTarget)}
                onKeyDown={(event) => {
                    if (event.key === "Enter") event.currentTarget.blur();
                }}
                onMouseDown={(event) => event.stopPropagation()}
            />
        </label>
    );
}

function alignDimension(value: number, enabled: boolean) {
    return enabled ? Math.ceil(value / DIMENSION_STEP) * DIMENSION_STEP : value;
}
