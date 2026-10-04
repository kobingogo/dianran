// [dianran] Starter template canvases on the home page. Data = web/public/templates/*.json (fetched on demand);
// the builder + canvas store are imported lazily on click so the home chunk stays small.
import { useEffect, useState } from "react";
import { App, Tag } from "antd";
import { LayoutTemplate, LoaderCircle } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";

import { showErrorToast } from "@/features/errors/error-toast";
import type { CanvasTemplate } from "@/lib/canvas/canvas-templates";

const TEMPLATE_BASE = `${import.meta.env.BASE_URL || "/"}templates`;

async function loadTemplates(): Promise<CanvasTemplate[]> {
    const index = (await (await fetch(`${TEMPLATE_BASE}/index.json`)).json()) as { templates: string[] };
    return Promise.all(index.templates.map(async (id) => (await (await fetch(`${TEMPLATE_BASE}/${id}.json`)).json()) as CanvasTemplate));
}

/** Tiny layout preview drawn from the template's own nodes (no images). */
function TemplatePreview({ template }: { template: CanvasTemplate }) {
    const boxes = template.nodes.map((node) => ({ ...node, w: node.w || 340, h: node.h || 240 }));
    const left = Math.min(...boxes.map((box) => box.x)) - 40;
    const top = Math.min(...boxes.map((box) => box.y)) - 40;
    const width = Math.max(...boxes.map((box) => box.x + box.w)) - left + 40;
    const height = Math.max(...boxes.map((box) => box.y + box.h)) - top + 40;
    const center = (key: string) => {
        const box = boxes.find((item) => item.key === key)!;
        return { x: box.x + box.w / 2, y: box.y + box.h / 2 };
    };
    return (
        <svg viewBox={`${left} ${top} ${width} ${height}`} className="h-full w-full" preserveAspectRatio="xMidYMid meet" aria-hidden>
            {template.connections.map(([from, to]) => {
                const a = center(from);
                const b = center(to);
                return <path key={`${from}-${to}`} d={`M${a.x},${a.y} C${(a.x + b.x) / 2},${a.y} ${(a.x + b.x) / 2},${b.y} ${b.x},${b.y}`} fill="none" stroke={template.accent} strokeOpacity={0.35} strokeWidth={6} />;
            })}
            {boxes.map((box) => (
                <g key={box.key}>
                    <rect x={box.x} y={box.y} width={box.w} height={box.h} rx={22} fill={box.type === "text" ? "currentColor" : template.accent} fillOpacity={box.type === "text" ? 0.06 : 0.14} stroke={template.accent} strokeOpacity={box.type === "text" ? 0.3 : 0.6} strokeWidth={4} />
                    {box.type === "text" ? [0, 1, 2, 3].map((line) => <rect key={line} x={box.x + 28} y={box.y + 40 + line * 44} width={(box.w - 56) * (line === 3 ? 0.55 : 1)} height={16} rx={8} fill="currentColor" fillOpacity={0.14} />) : <rect x={box.x + box.w / 2 - 40} y={box.y + box.h / 2 - 30} width={80} height={60} rx={12} fill={template.accent} fillOpacity={0.45} />}
                </g>
            ))}
        </svg>
    );
}

export function TemplateGallery() {
    const { t, i18n } = useTranslation();
    const { message } = App.useApp();
    const navigate = useNavigate();
    const [templates, setTemplates] = useState<CanvasTemplate[]>([]);
    const [opening, setOpening] = useState("");
    const en = i18n.resolvedLanguage === "en-US";

    useEffect(() => {
        let alive = true;
        loadTemplates()
            .then((items) => alive && setTemplates(items))
            .catch((error) => alive && showErrorToast(message, error, t("home.templates.loadFailed")));
        return () => {
            alive = false;
        };
    }, [message, t]);

    const openTemplate = async (template: CanvasTemplate) => {
        if (opening) return;
        setOpening(template.id);
        try {
            const [{ buildTemplateProject }, { useCanvasStore }, { useCanvasSidePanelStore }] = await Promise.all([import("@/lib/canvas/canvas-templates"), import("@/stores/canvas/use-canvas-store"), import("@/stores/use-canvas-side-panel-store")]);
            if (!useCanvasStore.getState().hydrated) await new Promise<void>((resolve) => { const stop = useCanvasStore.persist.onFinishHydration(() => (stop(), resolve())); });
            const side = useCanvasSidePanelStore.getState();
            const desktop = window.innerWidth >= 768;
            const screen = { width: window.innerWidth - (desktop && side.panelOpen ? side.width : 0), height: window.innerHeight };
            const id = useCanvasStore.getState().importProject(buildTemplateProject(template, screen, en ? template.titleEn || template.title : template.title));
            navigate(`/canvas/${id}`);
        } catch (error) {
            showErrorToast(message, error, t("home.templates.loadFailed"));
            setOpening("");
        }
    };

    if (!templates.length) return null;

    return (
        <section className="relative mx-auto mb-16 max-w-6xl border-t border-stone-200 pt-12 dark:border-stone-800" data-template-gallery>
            <div className="mb-8 text-center">
                <h2 className="inline-flex items-center gap-2 text-2xl font-semibold text-stone-950 sm:text-3xl dark:text-stone-100">
                    <LayoutTemplate className="size-6 text-[#E8572A]" />
                    {t("home.templates.title")}
                </h2>
                <p className="mx-auto mt-3 max-w-2xl text-sm leading-6 text-stone-500 sm:text-base sm:leading-7 dark:text-stone-400">{t("home.templates.description")}</p>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-5">
                {templates.map((template) => (
                    <button
                        key={template.id}
                        type="button"
                        onClick={() => void openTemplate(template)}
                        disabled={Boolean(opening)}
                        className="group flex min-h-[44px] flex-col overflow-hidden rounded-xl border border-stone-200 bg-white/80 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md disabled:cursor-wait dark:border-stone-800 dark:bg-stone-900/70"
                        data-template-id={template.id}
                    >
                        <div className="relative aspect-[16/10] w-full p-3 text-stone-700 dark:text-stone-300" style={{ background: `${template.accent}0d` }}>
                            <TemplatePreview template={template} />
                            {opening === template.id ? (
                                <div className="absolute inset-0 grid place-items-center bg-white/60 text-xs text-stone-600 backdrop-blur-sm dark:bg-stone-950/60 dark:text-stone-300">
                                    <span className="inline-flex items-center gap-1.5"><LoaderCircle className="size-3.5 animate-spin" />{t("home.templates.opening")}</span>
                                </div>
                            ) : null}
                        </div>
                        <div className="flex flex-1 flex-col p-3 sm:p-3.5">
                            <div className="flex items-center justify-between gap-2">
                                <h3 className="text-sm font-semibold text-stone-900 dark:text-stone-100">{en ? template.titleEn || template.title : template.title}</h3>
                                <span className="hidden shrink-0 text-[11px] text-stone-400 sm:inline">{t("home.templates.nodes", { count: template.nodes.length })}</span>
                            </div>
                            <p className="mt-1.5 line-clamp-2 text-xs leading-5 text-stone-500 dark:text-stone-400">{en ? template.descriptionEn || template.description : template.description}</p>
                            <div className="mt-auto flex items-center justify-between gap-2 pt-3">
                                <div className="hidden flex-wrap gap-1 sm:flex">
                                    {template.tags.map((tag) => <Tag key={tag} className="m-0 text-[11px]">{tag}</Tag>)}
                                </div>
                                <span className="shrink-0 text-xs font-medium transition group-hover:translate-x-0.5" style={{ color: template.accent }}>{t("home.templates.open")} →</span>
                            </div>
                        </div>
                    </button>
                ))}
            </div>
        </section>
    );
}
