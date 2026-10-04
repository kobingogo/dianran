import { ArrowRight, Copy, ExternalLink } from "lucide-react";
import { type ReactNode, useState } from "react";
import { App, Button, Image, Tag } from "antd";
import { useNavigate } from "react-router-dom";
import { Trans, useTranslation } from "react-i18next";

import copy from "copy-to-clipboard";

import { heroStripItems, showcaseItems, type ShowcaseItem } from "@/pages/home/showcase";
import { TemplateGallery } from "@/pages/home/template-gallery";
import { BRAND } from "@/constant/brand";
import { navigationTools } from "@/constant/navigation-tools";

function Highlighter({ action, color, children }: { action: "highlight" | "underline"; color: string; children?: ReactNode }) {
    return (
        <span className="relative inline-block px-1">
            {action === "highlight" ? (
                <span className="absolute inset-x-0 bottom-0 top-1 rounded-sm opacity-45" style={{ backgroundColor: color }} />
            ) : (
                <span className="absolute inset-x-0 bottom-0 h-1 rounded-full opacity-80" style={{ backgroundColor: color }} />
            )}
            <span className="relative font-medium text-stone-800 dark:text-stone-200">{children}</span>
        </span>
    );
}

// [dianran] phase4: scrolling strip of library covers under the hero (pauses on hover, static with reduced motion).
function HeroStrip({ items, locale }: { items: ShowcaseItem[]; locale: "zh-CN" | "en-US" }) {
    const loop = [...items, ...items];
    return (
        <div className="relative -mx-6 mt-14 overflow-hidden py-4 [mask-image:linear-gradient(to_right,transparent,black_10%,black_90%,transparent)]" aria-hidden="true">
            <div className="dr-marquee flex w-max gap-4 px-2">
                {loop.map((item, index) => (
                    <figure
                        key={`${item.id}-${index}`}
                        className="relative h-52 w-36 shrink-0 overflow-hidden rounded-2xl border border-stone-200 bg-stone-100 shadow-lg shadow-stone-900/10 dark:border-stone-800 dark:bg-stone-900 sm:h-64 sm:w-44"
                        style={{ transform: `rotate(${((index % 5) - 2) * 1.5}deg) translateY(${(index % 3) * 6}px)` }}
                    >
                        <img src={item.cover} alt="" loading="lazy" className="size-full object-cover" />
                        <figcaption className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 to-transparent px-2.5 pb-2 pt-6 text-left">
                            <div className="truncate text-[11px] font-medium text-white">{item.title[locale]}</div>
                            <div className="truncate text-[10px] text-white/65">{item.author}</div>
                        </figcaption>
                    </figure>
                ))}
            </div>
        </div>
    );
}

export default function IndexPage() {
    const { message } = App.useApp();
    const { t, i18n } = useTranslation();
    const navigate = useNavigate();
    const [primaryTool] = navigationTools;
    const [previewIndex, setPreviewIndex] = useState(0);
    const [previewOpen, setPreviewOpen] = useState(false);
    // [dianran] Local showcase instead of remote prompt sources (raw.githubusercontent.com is unreliable in mainland China).
    const locale = i18n.resolvedLanguage === "en-US" ? "en-US" : "zh-CN";
    const promptShowcase = showcaseItems.map((item) => ({ ...item, title: item.title[locale], coverUrl: item.cover }));
    const copyPrompt = (prompt: string) => {
        copy(prompt);
        message.success(t("home.copied"));
    };

    return (
        <main className="relative h-full overflow-y-auto bg-background bg-[radial-gradient(#e5e7eb_1px,transparent_1px)] [background-size:16px_16px] text-stone-950 dark:bg-[radial-gradient(rgba(245,245,244,.18)_1px,transparent_1px)] dark:text-stone-100">
            <section className="relative mx-auto min-h-[calc(100vh-4rem)] max-w-7xl overflow-hidden px-6">
                <div className="pointer-events-none absolute left-[15%] top-24 size-20 rounded-full border border-dashed border-stone-200 dark:border-stone-800" />
                <div className="pointer-events-none absolute right-[23%] top-[48%] size-20 rounded-full border border-dashed border-stone-200 dark:border-stone-800" />

                <div className="relative flex min-h-[620px] flex-col items-center justify-center pt-12 text-center">
                    <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-[#E8572A]/30 bg-[#E8572A]/5 px-3 py-1 text-xs font-medium tracking-wide text-[#C4421B] dark:text-[#FF9A75]">
                        <img src={`${import.meta.env.BASE_URL}logo-color.svg`} alt="" className="size-4" />
                        {t("home.eyebrow")}
                    </div>
                    <h1 className="ai-title-aurora max-w-5xl text-balance text-5xl font-semibold tracking-normal sm:text-7xl lg:text-8xl">{t("meta.title")}</h1>
                    <p className="mt-5 text-xl font-medium tracking-wide text-[#C4421B] dark:text-[#FF9A75]">{t("home.tagline", { defaultValue: BRAND.taglineZh })}</p>
                    <p className="mt-6 max-w-3xl text-balance text-lg leading-8 text-stone-500 dark:text-stone-400">
                        <Trans i18nKey="home.description" components={{ canvas: <Highlighter action="underline" color="#E8572A" />, content: <Highlighter action="highlight" color="#9DB2DD" /> }} />
                    </p>
                    <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
                        <Button type="primary" size="large" onClick={() => navigate(`/${primaryTool.slug}`)} icon={<ArrowRight className="size-4" />} iconPlacement="end">
                            {t("home.start")}
                        </Button>
                        <Button size="large" onClick={() => navigate("/image")}>
                            {t("home.openCanvas")}
                        </Button>
                    </div>
                    <HeroStrip items={heroStripItems} locale={locale} />
                </div>

                <TemplateGallery />

                <section className="relative mx-auto mb-20 max-w-6xl border-t border-stone-200 pt-12 dark:border-stone-800">
                    <div className="mb-8 grid gap-4 md:grid-cols-[1fr_auto_1fr] md:items-start">
                        <div />
                        <div className="max-w-2xl text-center">
                            <h2 className="text-3xl font-semibold text-stone-950 dark:text-stone-100">{t("home.showcaseTitle")}</h2>
                            <p className="mt-3 text-base leading-7 text-stone-500 dark:text-stone-400">{t("home.showcaseDescription")}</p>
                        </div>
                        <Button type="link" onClick={() => navigate("/prompts")} className="justify-self-center md:justify-self-end" icon={<ArrowRight className="size-4" />} iconPlacement="end">
                            {t("home.viewPrompts")}
                        </Button>
                    </div>
                    <div className="columns-2 gap-3 sm:gap-4 md:columns-3 lg:columns-4">
                        {promptShowcase.map((item, index) => (
                            <figure key={item.id} className="group relative mb-3 break-inside-avoid overflow-hidden rounded-xl border border-stone-200 bg-stone-100 dark:border-stone-800 dark:bg-stone-900 sm:mb-4">
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
