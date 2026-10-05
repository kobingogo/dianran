import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { App, Switch } from "antd";
import { ChevronDown } from "lucide-react";
import { useTranslation } from "react-i18next";

import i18n from "@/i18n";
import { Field, FieldLabel, ImageSettingsTheme } from "@/components/image-settings-panel";
import { CapabilityNote } from "@/components/ui/capability-note";
import { InkChip } from "@/components/ui/chip";
import { RatioPicker, ratioName } from "@/components/ui/ratio-picker";
import { InkSegmented } from "@/components/ui/segmented";
import { type CanvasTheme } from "@/lib/canvas-theme";
import { inferVideoRatio, parseAspectRatio, parsePixelSize, parseVideoResolution, VIDEO_SECONDS_MAX, VIDEO_SECONDS_MIN, videoRatioOptions } from "@/lib/media-size";
import { collectVideoAdjustments, planVideoRequest, videoPresetSize, videoSecondsOptions, type VideoSendPlan } from "@/lib/model-capabilities";
import { boolConfig, modelOptionName, resolveModelRequestConfig, resolveVideoSize, type AiConfig } from "@/stores/use-config-store";

export const videoResolutionOptions = [
    { value: "480", label: "480p" },
    { value: "720", label: "720p" },
    { value: "1080", label: "1080p" },
];
export const videoSizeOptions = videoRatioOptions.map((item) => ({ value: item.value, get label() { return item.value === "auto" ? i18n.t("settingsPanels.common.auto") : item.value; } }));
export const videoSecondsRange = { min: VIDEO_SECONDS_MIN, max: VIDEO_SECONDS_MAX };

const RESOLUTION_HINT: Record<string, string> = { "480p": "快", "720p": "标准", "1080p": "约 2×" };
const MODE_HINT: Record<string, string> = { frames: "首帧 / 尾帧控制起止画面", reference: "多张图作为角色 / 风格参考" };

type VideoConfigKey = "vquality" | "videoSize" | "videoSeconds" | "videoGenerateAudio" | "videoWatermark" | "videoMode";

type VideoSettingsPanelProps = {
    config: AiConfig;
    onConfigChange: (key: VideoConfigKey, value: string) => void;
    theme: CanvasTheme;
    /** 实际使用的视频模型（视频页传 videoModel；画布节点用 config.model）。 */
    model?: string;
    showTitle?: boolean;
    className?: string;
    /** Video model is empty. Shows the configure hint; does not guess from the image model. */
    modelUnset?: boolean;
    /** 生图页工作台自己渲染参考方式时可隐藏。 */
    showMode?: boolean;
};

export function VideoModelUnsetHint({ color, className }: { color?: string; className?: string }) {
    const { t } = useTranslation();
    return (
        <Link to="/config" className={className || "text-sm underline-offset-2 hover:underline"} style={color ? { color } : undefined} onMouseDown={(event) => event.stopPropagation()} onClick={(event) => event.stopPropagation()}>
            {t("settingsPanels.video.unset")}
        </Link>
    );
}

export function useVideoPlan(config: AiConfig, model: string): VideoSendPlan {
    return useMemo(() => {
        const request = model ? resolveModelRequestConfig(config, model) : config;
        return planVideoRequest({ model: modelOptionName(model || ""), apiFormat: request.apiFormat === "gemini" ? "gemini" : "openai", videoSize: resolveVideoSize(config), vquality: config.vquality, seconds: config.videoSeconds });
    }, [config, model]);
}

/** 「将发送 …」：界面上展示真实请求值。 */
export function describeVideoPlan(plan: VideoSendPlan) {
    const parts = Object.entries(plan.fields).map(([key, value]) => `${key}=${String(value).replace(/^(\d+)x(\d+)$/, "$1×$2")}`);
    return `将发送 ${parts.join(" · ")}`;
}

export function VideoSettingsPanel({ config, onConfigChange, theme, model: modelProp, showTitle = true, className = "w-[320px] space-y-4 rounded-2xl px-1 py-0.5", modelUnset = false, showMode = true }: VideoSettingsPanelProps) {
    const { t } = useTranslation();
    const { message } = App.useApp();
    const model = (modelProp ?? config.model).trim();
    const modelName = modelOptionName(model);
    const plan = useVideoPlan(config, model);
    const { caps } = plan;
    const [adjustNote, setAdjustNote] = useState("");
    const [advancedOpen, setAdvancedOpen] = useState(false);
    const lastModelRef = useRef<string | null>(null);
    const videoMode = normalizeVideoModeValue(config.videoMode);
    const storedSize = resolveVideoSize(config);

    // P0-2：切换模型时把比例 / 清晰度 / 时长吸附到合法值。
    useEffect(() => {
        if (lastModelRef.current === model) return;
        const first = lastModelRef.current === null;
        lastModelRef.current = model;
        if (!model) return;
        const request = resolveModelRequestConfig(config, model);
        const adjustments = collectVideoAdjustments({ model: modelName, apiFormat: request.apiFormat === "gemini" ? "gemini" : "openai", videoSize: storedSize, vquality: config.vquality, seconds: config.videoSeconds });
        if (!adjustments.length) {
            if (!first) setAdjustNote("");
            return;
        }
        adjustments.forEach((item) => onConfigChange(item.key, item.value));
        const text = `已按 ${modelName} 能力调整：${adjustments.map((item) => item.note).join("；")}`;
        setAdjustNote(text);
        if (!first) message.info(text);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [model]);

    const ratioOptions = caps.ratios;
    const seconds = videoSecondsOptions(caps);
    const custom = plan.customSize ? parsePixelSize(plan.customSize) : null;
    const presetPixels = parsePixelSize(plan.size || videoPresetSize(plan.ratio === "auto" ? "16:9" : plan.ratio, plan.resolution) || "1280x720") || { width: 1280, height: 720 };

    return (
        <ImageSettingsTheme theme={theme}>
            <div className={className} style={{ color: "var(--ink-900)" }} onMouseDown={(event) => event.stopPropagation()}>
                {showTitle ? <div className="font-[family-name:var(--font-serif)] text-lg font-semibold">{t("settingsPanels.video.title")}</div> : null}
                {modelUnset ? (
                    <CapabilityNote tone="warn">
                        <VideoModelUnsetHint className="font-medium underline underline-offset-2" />
                    </CapabilityNote>
                ) : null}
                {!caps.known && model ? <CapabilityNote>「{modelName}」能力未知，参数可能被忽略。</CapabilityNote> : null}
                {adjustNote ? <CapabilityNote>{adjustNote}</CapabilityNote> : null}

                {showMode && caps.modes.length > 1 ? (
                    <Field label="参考方式" hint={MODE_HINT[videoMode]}>
                        <InkSegmented
                            ariaLabel="参考方式"
                            value={videoMode}
                            onChange={(value) => onConfigChange("videoMode", value)}
                            options={caps.modes.map((mode) => ({ value: mode, label: t(`settingsPanels.video.modes.${mode}`) }))}
                        />
                    </Field>
                ) : null}

                <Field label="画面比例" hint={caps.known ? `该模型支持 ${ratioOptions.length} 种` : undefined}>
                    <RatioPicker value={plan.ratio} primary={ratioOptions} allowAuto={caps.paramStyle === "relay-extended"} onChange={(ratio) => onConfigChange("videoSize", ratio)} ariaLabel="画面比例" />
                </Field>

                <Field label="时长" hint="秒">
                    <div role="radiogroup" aria-label="时长" className="flex flex-wrap gap-1.5">
                        {seconds.map((value) => (
                            <InkChip key={value} role="radio" aria-checked={plan.seconds === value} selected={plan.seconds === value} onClick={() => onConfigChange("videoSeconds", String(value))}>
                                {value} 秒
                            </InkChip>
                        ))}
                    </div>
                </Field>

                <Field label="清晰度" hint="影响速度与费用">
                    <InkSegmented
                        ariaLabel="清晰度"
                        value={plan.resolution}
                        onChange={(value) => onConfigChange("vquality", value.replace(/p$/, ""))}
                        options={caps.resolutions.map((item) => ({ value: item, label: item, hint: RESOLUTION_HINT[item] }))}
                    />
                    <div className="mt-1.5 font-[family-name:var(--font-mono)] text-[11.5px] text-[color:var(--ink-400)]" data-testid="video-size-preview">
                        {describeVideoPlan(plan)}
                    </div>
                </Field>

                <div className="border-t border-dashed border-[var(--line-strong)] pt-3">
                    <button type="button" className="flex w-full cursor-pointer items-center justify-between border-0 bg-transparent p-0 text-[13px] text-[color:var(--ink-500)] hover:text-[color:var(--ink-900)]" aria-expanded={advancedOpen} onClick={() => setAdvancedOpen(!advancedOpen)}>
                        <span>高级 · {caps.audio ? "声音 / 水印" : "水印"}{caps.customSize ? " / 自定义尺寸" : ""}</span>
                        <ChevronDown className={`size-4 transition-transform ${advancedOpen ? "rotate-180" : ""}`} strokeWidth={1.7} />
                    </button>
                    {advancedOpen ? (
                        <div className="mt-3 space-y-3">
                            {caps.audio ? (
                                <label className="flex items-center justify-between text-[13px] text-[color:var(--ink-700)]">
                                    生成声音
                                    <Switch size="small" checked={boolConfig(config.videoGenerateAudio, true)} onChange={(checked) => onConfigChange("videoGenerateAudio", String(checked))} />
                                </label>
                            ) : null}
                            {caps.paramStyle !== "openai-sora" ? (
                                <label className="flex items-center justify-between text-[13px] text-[color:var(--ink-700)]">
                                    水印
                                    <Switch size="small" checked={boolConfig(config.videoWatermark, false)} onChange={(checked) => onConfigChange("videoWatermark", String(checked))} />
                                </label>
                            ) : (
                                <div className="text-xs text-[color:var(--ink-500)]">官方 Sora 不接受声音 / 水印参数，已隐藏。</div>
                            )}
                            {caps.customSize ? (
                                <div className="space-y-2">
                                    <FieldLabel label="自定义尺寸" hint="仅中转模型" inline />
                                    <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2.5">
                                        <PixelInput prefix="W" value={(custom || presetPixels).width} onCommit={(width) => onConfigChange("videoSize", `${width}x${(custom || presetPixels).height}`)} />
                                        <span className="text-[color:var(--ink-400)]">×</span>
                                        <PixelInput prefix="H" value={(custom || presetPixels).height} onCommit={(height) => onConfigChange("videoSize", `${(custom || presetPixels).width}x${height}`)} />
                                    </div>
                                    <div className="text-[11.5px] text-[color:var(--ink-400)]">{custom ? "正在使用自定义尺寸；点上方比例可恢复预设。" : "改动后按像素发送 size；中转站可能拒绝非常规尺寸。"}</div>
                                </div>
                            ) : null}
                        </div>
                    ) : null}
                </div>
            </div>
        </ImageSettingsTheme>
    );
}

export function videoResolutionLabel(value: string) {
    return `${parseVideoResolution(value)}p`;
}

export function videoSizeLabel(value: string) {
    const pixels = parsePixelSize(value);
    if (pixels && !videoRatioOptions.some((item) => item.value === value)) return inferVideoRatio(value);
    const ratio = inferVideoRatio(value);
    return ratio === "auto" ? i18n.t("settingsPanels.video.adaptive") : ratioName(ratio).split(" ")[0];
}

export function videoSecondsLabel(value: string) {
    if (String(value).trim() === "-1") return i18n.t("settingsPanels.video.smart");
    return `${value || "6"}s`;
}

export function videoModeLabel(value: string) {
    return i18n.t(`settingsPanels.video.modes.${normalizeVideoModeValue(value)}`);
}

export function normalizeVideoModeValue(value: string | undefined) {
    return value === "reference" ? "reference" : "frames";
}

/** Keeps ratios ("16:9") and pixels ("1280x720") as stored; the request plan resolves them per model. */
export function normalizeVideoSizeValue(value: string) {
    if (!value || value === "auto") return "auto";
    if (/^\d+x\d+$/.test(value) || parseAspectRatio(value)) return value;
    return inferVideoRatio(value);
}

export function normalizeVideoResolutionValue(value: string) {
    return parseVideoResolution(value);
}

function PixelInput({ prefix, value, onCommit }: { prefix: string; value: number; onCommit: (value: number) => void }) {
    return (
        <label className="flex h-9 overflow-hidden rounded-[var(--r-md)] border border-[var(--line)] bg-[var(--paper-0)] text-sm text-[color:var(--ink-900)]">
            <span className="grid w-8 place-items-center text-[color:var(--ink-400)]">{prefix}</span>
            <input
                type="number"
                min={2}
                aria-label={prefix === "W" ? "视频宽度" : "视频高度"}
                className="min-w-0 flex-1 bg-transparent px-1 font-[family-name:var(--font-mono)] outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                defaultValue={value}
                key={`${prefix}-${value}`}
                onBlur={(event) => {
                    const next = Math.max(2, Math.round((Number(event.currentTarget.value) || value) / 2) * 2);
                    if (next !== value) onCommit(next);
                }}
                onKeyDown={(event) => {
                    if (event.key === "Enter") event.currentTarget.blur();
                }}
                onMouseDown={(event) => event.stopPropagation()}
            />
        </label>
    );
}
