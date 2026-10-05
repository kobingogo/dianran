import { ArrowRight } from "lucide-react";
import { type ReactNode, useState } from "react";
import { App, Button, Image, Tag } from "antd";
import { useNavigate } from "react-router-dom";
import { Trans, useTranslation } from "react-i18next";

import copy from "copy-to-clipboard";

import { showcaseItems } from "@/pages/home/showcase";
import { TemplateGallery } from "@/pages/home/template-gallery";
import { BRAND } from "@/constant/brand";
import { navigationTools } from "@/constant/navigation-tools";
import { cn } from "@/lib/utils";

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

                <div className="relative flex min-h-[620px] flex-col items-center justify-center pt-10 text-center">
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
                    <div className="grid auto-rows-[210px] gap-4 md:grid-cols-4">
                        {promptShowcase.map((item, index) => (
                            <button
                                key={item.id}
                                type="button"
                                onClick={() => {
                                    setPreviewIndex(index);
                                    setPreviewOpen(true);
                                }}
                                className={cn(
                                    "group relative cursor-pointer overflow-hidden border border-stone-200 bg-stone-100 text-left dark:border-stone-800 dark:bg-stone-900",
                                    index === 0 && "md:col-span-2 md:row-span-2",
                                    index === 3 && "md:col-span-2",
                                )}
                            >
                                <img src={item.coverUrl} alt={item.title} className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.03]" />
                                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 via-black/35 to-transparent p-4 text-white">
                                    <div className="mb-2 flex flex-wrap gap-1.5">
                                        {item.tags.slice(0, 2).map((tag) => (
                                            <Tag key={tag} variant="filled" className="m-0 bg-white/15 text-[11px] text-white backdrop-blur">
                                                {tag}
                                            </Tag>
                                        ))}
                                    </div>
                                    <h3 className="text-sm font-medium">{item.title}</h3>
                                    <p className="mt-1 line-clamp-2 text-xs leading-5 text-white/75">{item.prompt}</p>
                                </div>
                                <div
                                    role="button"
                                    tabIndex={0}
                                    onClick={(event) => {
                                        event.stopPropagation();
                                        copyPrompt(item.prompt);
                                    }}
                                    onKeyDown={(event) => {
                                        if (event.key !== "Enter" && event.key !== " ") return;
                                        event.preventDefault();
                                        event.stopPropagation();
                                        copyPrompt(item.prompt);
                                    }}
                                    className="absolute right-3 top-3 rounded-full bg-black/45 px-2.5 py-1 text-[11px] text-white opacity-0 backdrop-blur transition group-hover:opacity-100 focus:opacity-100"
                                >
                                    {t("home.copyPrompt")}
                                </div>
                            </button>
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
