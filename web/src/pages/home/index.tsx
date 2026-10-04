import { ArrowRight, Copy, ExternalLink } from "lucide-react";
import { useEffect, useState } from "react";
import { App, Button, Image, Tag } from "antd";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";

import copy from "copy-to-clipboard";

import { showcaseItems } from "@/pages/home/showcase";
import { InkButton } from "@/components/ui/ink-button";
import { InkChip } from "@/components/ui/chip";
import { hasUsableChannel, useOnboardingStore } from "@/features/onboarding/onboarding-store";
import { normalizeImageQuality } from "@/lib/model-capabilities";
import { modelOptionName, resolveVideoSize, useConfigStore } from "@/stores/use-config-store";
import { useThemeStore } from "@/stores/use-theme-store";
import { useWorkbenchAgentStore } from "@/stores/use-workbench-agent-store";
import { TemplateGallery } from "@/pages/home/template-gallery";
import { BRAND } from "@/constant/brand";

const base = import.meta.env.BASE_URL || "/";
const ALBUM = [
    { src: `${base}showcase/ink-mountains.webp`, caption: "晨雾山水 · 3:4", style: "left-[6%] top-0 h-[340px] w-[250px] -rotate-2" },
    { src: `${base}showcase/library/ink-cats.webp`, caption: "墨猫 · 1:1", style: "left-[44%] top-10 h-[300px] w-[230px] rotate-[2.5deg]" },
    { src: `${base}showcase/lotus-moon.webp`, caption: "荷月 · 16:9", style: "left-[16%] top-[300px] h-[220px] w-[330px] -rotate-[0.5deg]" },
];
const HOME_RATIOS = ["1:1", "3:4", "4:3", "9:16", "16:9"];
const TRY_PROMPTS = [
    { label: "水墨山水", prompt: "水墨山水，晨雾缭绕，远山层叠，大面积留白，竖幅构图，宣纸质感" },
    { label: "产品海报", prompt: "极简产品海报：一只素白陶瓷杯，柔和侧光，浅色背景，大量留白" },
    { label: "夜行百鬼", prompt: "民俗插画：夜行百鬼队列，深蓝水彩夜空，朱红与金色点缀，版画质感" },
];
type HomeMode = "image" | "video" | "canvas";
type RecentCanvas = { id: string; title: string; updatedAt: string; cover?: string };

function useRecentCanvases() {
    const [items, setItems] = useState<RecentCanvas[]>([]);
    useEffect(() => {
        let cancelled = false;
        // Lazy: the canvas store stays out of the home chunk. Read-only, no data structure change.
        void import("@/stores/canvas/use-canvas-store").then(({ useCanvasStore }) => {
            const read = () => {
                const projects = [...useCanvasStore.getState().projects].sort((x, y) => String(y.updatedAt).localeCompare(String(x.updatedAt))).slice(0, 5);
                if (!cancelled)
                    setItems(
                        projects.map((project) => {
                            const image = project.nodes.find((node) => node.type === "image" && typeof (node as { content?: unknown }).content === "string" && /^(https?:|data:image|blob:)/.test(String((node as { content?: unknown }).content)));
                            return { id: project.id, title: project.title, updatedAt: project.updatedAt, cover: image ? String((image as { content?: unknown }).content) : undefined };
                        }),
                    );
            };
            read();
            const unsubscribe = useCanvasStore.subscribe(read);
            if (cancelled) unsubscribe();
        });
        return () => {
            cancelled = true;
        };
    }, []);
    return items;
}

export default function IndexPage() {
    const { message } = App.useApp();
    const { t, i18n } = useTranslation();
    const navigate = useNavigate();
    const [previewIndex, setPreviewIndex] = useState(0);
    const [previewOpen, setPreviewOpen] = useState(false);
    const [mode, setMode] = useState<HomeMode>("image");
    const [prompt, setPrompt] = useState("");
    const [setupOpen, setSetupOpen] = useState(false);
    const config = useConfigStore((state) => state.config);
    const updateConfig = useConfigStore((state) => state.updateConfig);
    const theme = useThemeStore((state) => state.theme);
    const setTheme = useThemeStore((state) => state.setTheme);
    const recent = useRecentCanvases();
    const connected = hasUsableChannel(config);
    const channelName = config.channels.find((channel) => channel.baseUrl.trim() && channel.apiKey.trim() && channel.models.length)?.name;
    const imageModel = modelOptionName(config.imageModel || config.model || "");
    const videoModel = modelOptionName(config.videoModel || "");
    const imageRatio = HOME_RATIOS.includes(config.size) ? config.size : config.size === "auto" ? "自动" : "1:1";
    const videoSize = resolveVideoSize(config);
    const videoRatio = HOME_RATIOS.includes(videoSize) ? videoSize : "16:9";
    // [dianran] Local showcase instead of remote prompt sources (raw.githubusercontent.com is unreliable in mainland China).
    const locale = i18n.resolvedLanguage === "en-US" ? "en-US" : "zh-CN";
    const promptShowcase = showcaseItems.map((item) => ({ ...item, title: item.title[locale], coverUrl: item.cover }));
    const copyPrompt = (value: string) => {
        copy(value);
        message.success(t("home.copied"));
    };
    const cycleRatio = () => {
        const current = mode === "video" ? videoRatio : imageRatio;
        const next = HOME_RATIOS[(HOME_RATIOS.indexOf(current) + 1) % HOME_RATIOS.length];
        updateConfig(mode === "video" ? "videoSize" : "size", next);
    };
    const submit = () => {
        if (mode === "canvas") {
            navigate("/canvas?mode=new");
            return;
        }
        const text = prompt.trim();
        if (!text) {
            message.info("先写一句想要的画面");
            return;
        }
        // PLAN 6.2：首访不再弹配置；第一次点生成且未配置 Key 时在输入框下方展开内联配置卡。
        if (!connected) {
            setSetupOpen(true);
            return;
        }
        const store = useWorkbenchAgentStore.getState();
        if (mode === "video") store.dispatchVideo({ prompt: text, run: Boolean(videoModel) });
        else store.dispatchImage({ prompt: text, run: true });
        navigate(mode === "video" ? "/video" : "/image");
    };

    return (
        <main className="relative h-full overflow-y-auto bg-[var(--paper-1)] text-[color:var(--ink-900)]" style={{ backgroundImage: "var(--paper-noise)" }}>
            <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-[520px] bg-[radial-gradient(420px_260px_at_22%_18%,color-mix(in_srgb,var(--ink-900)_7%,transparent),transparent_70%),radial-gradient(300px_200px_at_30%_30%,color-mix(in_srgb,var(--dai-600)_6%,transparent),transparent_70%)]" />
            <section className="relative mx-auto min-h-full max-w-[1280px] px-5 sm:px-10 lg:px-16">
                <div className="flex h-14 items-center justify-end gap-2.5 sm:h-16">
                    {connected ? (
                        <span className="inline-flex h-7 items-center gap-1.5 rounded-full border border-[var(--line)] bg-[var(--paper-0)] px-3 text-[12.5px] text-[color:var(--ink-700)]">
                            <span className="size-2 rounded-full bg-[var(--ok)]" />
                            已连接 · {channelName}
                        </span>
                    ) : (
                        <InkChip onClick={() => useOnboardingStore.getState().show({ reason: "manual" })}>
                            <span className="size-2 rounded-full bg-[var(--warn)]" />
                            未配置模型 · 去配置
                        </InkChip>
                    )}
                    <InkChip onClick={() => setTheme(theme === "dark" ? "light" : "dark")} aria-label="切换浅色 / 深色">
                        <span className={theme === "light" ? "font-semibold text-[color:var(--ink-900)]" : ""}>浅</span> · <span className={theme === "dark" ? "font-semibold text-[color:var(--ink-900)]" : ""}>深</span>
                    </InkChip>
                </div>

                <div className="grid gap-10 pb-10 pt-2 lg:grid-cols-[1.05fr_.95fr] lg:gap-12">
                    <div className="min-w-0">
                        <div className="flex items-center gap-2.5 text-[12.5px] tracking-[0.2em] text-[color:var(--ink-500)] before:h-px before:w-7 before:bg-[var(--ink-400)]">DIANRAN · AI 创作工作室</div>
                        <h1 className="relative isolate mb-3.5 mt-5 inline-block font-[family-name:var(--font-serif)] text-[54px] font-bold leading-none tracking-[0.08em] sm:text-[96px]">
                            <span aria-hidden className="absolute -left-3.5 -top-2 size-[34px] rounded-full bg-[radial-gradient(circle_at_40%_40%,var(--zhu-500),transparent_70%)] opacity-85 blur-[1px]" />
                            点
                            <em className="relative not-italic">
                                染
                                <span aria-hidden className="absolute -right-[2%] bottom-1.5 left-[4%] -z-10 h-4 rounded-[40%_60%_50%_50%] bg-[color-mix(in_srgb,var(--zhu-500)_18%,transparent)]" />
                            </em>
                        </h1>
                        <div className="font-[family-name:var(--font-serif)] text-lg tracking-[0.12em] text-[color:var(--ink-700)] sm:text-[22px]">{t("home.tagline", { defaultValue: BRAND.taglineZh })}</div>
                        <p className="mt-3 max-w-[520px] text-[15px] leading-7 text-[color:var(--ink-500)]">写下一句话，先出图；满意了，拖进画布继续串联图片、视频与文字。所有密钥与作品只存在你的浏览器里。</p>

                        <div className="mt-7 max-w-[600px] rounded-[18px] border border-[var(--line)] bg-[var(--paper-0)] px-3.5 pb-3 pt-3.5 shadow-[var(--sh-1)]">
                            <div role="tablist" className="mb-2.5 flex gap-1">
                                {(
                                    [
                                        ["image", "生图"],
                                        ["video", "视频"],
                                        ["canvas", "在画布中打开"],
                                    ] as const
                                ).map(([value, label]) => (
                                    <button key={value} type="button" role="tab" aria-selected={mode === value} onClick={() => setMode(value)} className={`cursor-pointer rounded-lg border-0 px-3 py-[5px] text-[13px] ${mode === value ? "bg-[var(--paper-2)] font-semibold text-[color:var(--ink-900)]" : "bg-transparent text-[color:var(--ink-500)] hover:text-[color:var(--ink-900)]"}`}>
                                        {label}
                                    </button>
                                ))}
                            </div>
                            <textarea
                                value={prompt}
                                onChange={(event) => setPrompt(event.target.value)}
                                onKeyDown={(event) => {
                                    if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && !event.nativeEvent.isComposing) {
                                        event.preventDefault();
                                        submit();
                                    }
                                }}
                                rows={2}
                                aria-label="提示词"
                                placeholder={mode === "video" ? "想拍什么？例如：镜头缓慢推进，晨雾中的竹林，光束穿过叶隙" : mode === "canvas" ? "直接打开一张新画布，在画布里继续创作" : "想画什么？例如：水墨山水，晨雾缭绕，大面积留白，竖幅构图"}
                                disabled={mode === "canvas"}
                                className="block min-h-[58px] w-full resize-none border-0 bg-transparent px-1 py-0.5 text-[15.5px] leading-7 text-[color:var(--ink-900)] outline-none placeholder:text-[color:var(--ink-400)] disabled:cursor-default"
                            />
                            <div className="mt-1 flex flex-wrap items-center gap-2">
                                {mode !== "canvas" ? (
                                    <>
                                        <InkChip onClick={() => navigate(mode === "video" ? "/video" : "/image")} title="在工作台切换模型">
                                            {(mode === "video" ? videoModel : imageModel) || "未设置模型"} ▾
                                        </InkChip>
                                        <InkChip onClick={cycleRatio} title="切换比例">
                                            ▯ {mode === "video" ? videoRatio : imageRatio}
                                        </InkChip>
                                        {mode === "image" ? (
                                            <InkChip onClick={() => updateConfig("quality", normalizeImageQuality(config.quality) === "hd" ? "standard" : "hd")} title="切换画质">
                                                {normalizeImageQuality(config.quality) === "hd" ? "高清画质" : "标准画质"}
                                            </InkChip>
                                        ) : (
                                            <InkChip onClick={() => updateConfig("vquality", config.vquality === "1080" ? "720" : "1080")} title="切换清晰度">
                                                {config.vquality === "1080" ? "1080p" : "720p"}
                                            </InkChip>
                                        )}
                                    </>
                                ) : null}
                                <span className="flex-1" />
                                {mode !== "canvas" ? <span className="hidden text-xs text-[color:var(--ink-400)] sm:inline">约 1 次调用</span> : null}
                                <InkButton variant="zhu" size={40} className="h-[38px]" onClick={submit}>
                                    {mode === "canvas" ? "新建画布 →" : "落笔生成 →"}
                                </InkButton>
                            </div>
                        </div>
                        {setupOpen && !connected ? (
                            <div className="mt-3 max-w-[600px] rounded-[var(--r-lg)] border border-[var(--line)] bg-[var(--dai-100)] p-4 text-[color:var(--dai-600)]" role="region" aria-label="配置模型">
                                <div className="font-[family-name:var(--font-serif)] text-[15px] font-semibold">还差一步：配置一个模型服务</div>
                                <ol className="mt-2 grid gap-1 pl-0 text-[13px] sm:grid-cols-3">
                                    {["选择服务商", "填入 API Key", "自动拉取模型"].map((step, index) => (
                                        <li key={step} className="flex list-none items-center gap-2">
                                            <span className="grid size-5 place-items-center rounded-full border border-current font-[family-name:var(--font-serif)] text-[11px]">{["一", "二", "三"][index]}</span>
                                            {step}
                                        </li>
                                    ))}
                                </ol>
                                <div className="mt-3 flex flex-wrap items-center gap-2">
                                    <InkButton size={32} variant="ink" onClick={() => useOnboardingStore.getState().show({ reason: "missing-key" })}>
                                        开始配置（约 1 分钟）
                                    </InkButton>
                                    <span className="text-xs opacity-80">Key 只保存在本机浏览器；配置完回来再点「落笔生成」。</span>
                                </div>
                            </div>
                        ) : null}
                        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[color:var(--ink-400)]">
                            <span>试试：</span>
                            {TRY_PROMPTS.map((item) => (
                                <button key={item.label} type="button" onClick={() => setPrompt(item.prompt)} className="cursor-pointer border-0 bg-[linear-gradient(transparent_62%,color-mix(in_srgb,var(--zhu-500)_22%,transparent)_62%,color-mix(in_srgb,var(--zhu-500)_22%,transparent)_88%,transparent_88%)] p-0 text-xs text-[color:var(--ink-700)]">
                                    {item.label}
                                </button>
                            ))}
                        </div>
                    </div>

                    <div aria-hidden className="relative hidden h-[540px] lg:block">
                        {ALBUM.map((item) => (
                            <figure key={item.src} className={`absolute m-0 overflow-hidden rounded-md border border-[var(--line)] bg-[#fff] px-2 pb-[30px] pt-2 shadow-[var(--sh-2)] dark:bg-[var(--paper-0)] ${item.style}`}>
                                <img src={item.src} alt="" loading="lazy" className="block size-full rounded-[2px] object-cover" />
                                <figcaption className="absolute bottom-[7px] left-3 font-[family-name:var(--font-serif)] text-[11.5px] text-[color:var(--ink-500)]">{item.caption}</figcaption>
                                <i className="absolute bottom-[7px] right-2.5 size-4 rounded-[2px] bg-[var(--zhu-500)] opacity-85" />
                            </figure>
                        ))}
                    </div>
                </div>

                <div className="grid gap-3.5 pb-10 sm:grid-cols-3 lg:grid-cols-[1fr_1fr_1fr_1.2fr]">
                    {(
                        [
                            ["一", "生图", "一句话出图，选比例与画质", "/image"],
                            ["二", "视频", "首尾帧或参考图生成短片", "/video"],
                            ["三", "画布", "把结果串成可迭代的创作流", "/canvas"],
                        ] as const
                    ).map(([n, title, desc, to]) => (
                        <button key={to} type="button" onClick={() => navigate(to)} className="flex cursor-pointer items-start gap-3.5 rounded-[var(--r-lg)] border border-[var(--line)] bg-[var(--paper-0)] px-[18px] py-4 text-left shadow-[var(--sh-1)] transition-transform hover:-translate-y-px">
                            <span className="grid size-6 shrink-0 place-items-center rounded-full border border-[var(--zhu-500)] font-[family-name:var(--font-serif)] text-[13px] text-[color:var(--zhu-600)]">{n}</span>
                            <span>
                                <b className="block font-[family-name:var(--font-serif)] text-base">{title}</b>
                                <span className="mt-0.5 block text-[12.5px] text-[color:var(--ink-500)]">{desc}</span>
                            </span>
                        </button>
                    ))}
                    <div className="rounded-[var(--r-lg)] border border-[var(--line)] bg-[var(--paper-0)] px-4 py-3.5 shadow-[var(--sh-1)] sm:col-span-3 lg:col-span-1">
                        <div className="flex items-center justify-between text-[13px] font-semibold text-[color:var(--ink-700)]">
                            最近的画布
                            <button type="button" onClick={() => navigate("/canvas")} className="cursor-pointer border-0 bg-transparent p-0 text-xs font-normal text-[color:var(--ink-400)] hover:text-[color:var(--ink-900)]">
                                查看全部 →
                            </button>
                        </div>
                        {recent.length ? (
                            <div className="mt-2 flex gap-2 overflow-x-auto">
                                {recent.map((item) => (
                                    <button key={item.id} type="button" title={item.title} onClick={() => navigate(`/canvas/${item.id}`)} className="grid size-14 shrink-0 cursor-pointer place-items-center overflow-hidden rounded-lg border border-[var(--line)] bg-[var(--paper-2)] p-0 text-[11px] text-[color:var(--ink-500)]">
                                        {item.cover ? <img src={item.cover} alt="" className="size-full object-cover" /> : <span className="line-clamp-2 px-1 text-center leading-tight">{item.title}</span>}
                                    </button>
                                ))}
                            </div>
                        ) : (
                            <div className="mt-2 text-xs text-[color:var(--ink-400)]">还没有画布，从「在画布中打开」开始。</div>
                        )}
                    </div>
                </div>

                <TemplateGallery />

                <section className="relative mx-auto mb-20 border-t border-[var(--line)] pt-12">
                    <div className="mb-8 grid gap-4 md:grid-cols-[1fr_auto_1fr] md:items-start">
                        <div />
                        <div className="max-w-2xl text-center">
                            <h2 className="font-[family-name:var(--font-serif)] text-3xl font-semibold text-[color:var(--ink-900)]">{t("home.showcaseTitle")}</h2>
                            <p className="mt-3 text-base leading-7 text-[color:var(--ink-500)]">{t("home.showcaseDescription")}</p>
                        </div>
                        <Button type="link" onClick={() => navigate("/prompts")} className="justify-self-center md:justify-self-end" icon={<ArrowRight className="size-4" />} iconPlacement="end">
                            {t("home.viewPrompts")}
                        </Button>
                    </div>
                    <div className="columns-2 gap-3 sm:gap-4 md:columns-3 lg:columns-4">
                        {promptShowcase.map((item, index) => (
                            <figure key={item.id} className="group relative mb-3 break-inside-avoid overflow-hidden rounded-[var(--r-lg)] border border-[var(--line)] bg-[var(--paper-2)] sm:mb-4">
                                <button
                                    type="button"
                                    className="block w-full cursor-zoom-in"
                                    onClick={() => {
                                        setPreviewIndex(index);
                                        setPreviewOpen(true);
                                    }}
                                >
                                    <img src={item.coverUrl} alt={item.title} loading="lazy" className="block w-full object-cover transition duration-500 group-hover:scale-[1.03]" />
                                </button>
                                <figcaption className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent p-3 pt-10 text-left text-white sm:p-4 sm:pt-12">
                                    <div className="mb-1.5 flex flex-wrap gap-1.5">
                                        {item.tags.slice(0, 2).map((tag) => (
                                            <Tag key={tag} variant="filled" className="m-0 bg-white/15 text-[11px] text-white backdrop-blur">
                                                {tag}
                                            </Tag>
                                        ))}
                                    </div>
                                    <h3 className="text-sm font-medium">{item.title}</h3>
                                    <p className="mt-1 hidden text-xs leading-5 text-white/75 line-clamp-2 sm:[display:-webkit-box]">{item.prompt}</p>
                                    {/* attribution: original author + library, links to the source post */}
                                    <a
                                        href={item.sourceUrl}
                                        target="_blank"
                                        rel="noreferrer noopener"
                                        className="pointer-events-auto mt-1.5 inline-flex max-w-full items-center gap-1 truncate text-[11px] text-white/70 hover:text-white"
                                    >
                                        <span className="truncate">
                                            {item.author} · {item.source}
                                        </span>
                                        <ExternalLink className="size-3 shrink-0" />
                                    </a>
                                </figcaption>
                                <button
                                    type="button"
                                    onClick={() => copyPrompt(item.prompt)}
                                    aria-label={t("home.copyPrompt")}
                                    className="absolute right-2.5 top-2.5 inline-flex items-center gap-1 rounded-full bg-black/50 px-2.5 py-1 text-[11px] text-white backdrop-blur transition sm:opacity-0 sm:group-hover:opacity-100 sm:focus:opacity-100"
                                >
                                    <Copy className="size-3" />
                                    <span className="hidden sm:inline">{t("home.copyPrompt")}</span>
                                </button>
                            </figure>
                        ))}
                    </div>
                </section>
            </section>
            <Image.PreviewGroup
                preview={{
                    open: previewOpen,
                    current: previewIndex,
                    onOpenChange: setPreviewOpen,
                    onChange: setPreviewIndex,
                }}
            >
                <div className="hidden">
                    {promptShowcase.map((item) => (
                        <Image key={item.id} src={item.coverUrl} alt={item.title} />
                    ))}
                </div>
            </Image.PreviewGroup>
        </main>
    );
}
