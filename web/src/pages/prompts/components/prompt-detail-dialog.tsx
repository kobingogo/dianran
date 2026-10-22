import { ChevronDown, Copy, ExternalLink, FolderPlus } from "lucide-react";
import { useEffect, useState } from "react";
import { Button, Dropdown, Modal, Space, Tag } from "antd";
import { useTranslation } from "react-i18next";

import { PromptCover } from "@/components/prompts/prompt-card";
import { formatPromptDate, type Prompt } from "@/services/api/prompts";
import { trackPromptUsage } from "@/services/usage-stats";
import { useOpenCreationDraft } from "@/hooks/use-open-creation-draft";

export function PromptDetailDialog({ prompt, onClose, onCopy, onSaveAsset }: { prompt: Prompt | null; onClose: () => void; onCopy: (prompt: string) => void; onSaveAsset?: (prompt: Prompt) => void }) {
    const { i18n, t } = useTranslation();
    const openDraft = useOpenCreationDraft();
    const images = prompt ? Array.from(new Set([prompt.coverUrl, ...prompt.referenceImageUrls].filter(Boolean))) : [];
    const [activeImage, setActiveImage] = useState("");
    useEffect(() => setActiveImage(images[0] || ""), [prompt?.id, prompt?.coverUrl, prompt?.referenceImageUrls]);

    return (
        <Modal title={prompt?.title} open={Boolean(prompt)} onCancel={onClose} footer={null} width={720} centered styles={{ body: { height: "calc(85vh - 55px)", overflow: "hidden" } }}>
            {prompt ? (
                <div className="flex h-full min-h-0 flex-col">
                    <div className="shrink-0 space-y-3 pb-4">
                        <div className="flex max-h-[52vh] min-h-40 items-center justify-center overflow-hidden rounded-lg bg-stone-100 dark:bg-stone-900">
                            <PromptCover key={`${prompt.id}:${activeImage}`} src={activeImage} alt={prompt.title} loading="eager" className="max-h-[52vh] w-full" />
                        </div>
                        {images.length > 1 ? <div className="thin-scrollbar flex gap-2 overflow-x-auto pb-1">{images.slice(0, 12).map((url, index) => <button key={url} type="button" aria-label={`${prompt.title} ${index + 1}`} aria-pressed={activeImage === url} onClick={() => setActiveImage(url)} className={`h-16 w-20 shrink-0 overflow-hidden rounded-md border bg-stone-100 p-1 dark:bg-stone-900 ${activeImage === url ? "border-[var(--ant-color-primary)]" : "border-stone-200 dark:border-stone-700"}`}><img src={url} alt="" className="h-full w-full object-contain" loading="lazy" /></button>)}</div> : null}
                    </div>
                    <div className="min-h-0 min-w-0 flex-1 overflow-y-auto border-y border-stone-200 py-4 pr-2 dark:border-stone-800">
                        <PromptAttribution prompt={prompt} />
                        <div className="flex flex-wrap gap-1.5">
                            {prompt.tags.map((tag) => (
                                <Tag key={tag} className="m-0">
                                    {tag}
                                </Tag>
                            ))}
                        </div>
                        {prompt.description ? <p className="mt-4 text-sm leading-6 text-stone-500 dark:text-stone-400">{prompt.description}</p> : null}
                        {prompt.preview ? <pre className="mt-4 whitespace-pre-wrap rounded-lg bg-stone-100 p-3 text-xs leading-5 text-stone-600 dark:bg-stone-900 dark:text-stone-300">{prompt.preview}</pre> : null}
                        <p className="mt-4 whitespace-pre-wrap text-sm leading-7 text-stone-800 dark:text-stone-300">{prompt.prompt}</p>
                        {prompt.createdAt || prompt.updatedAt ? <div className="mt-4 text-xs text-stone-500 dark:text-stone-400">{prompt.createdAt ? t("common.created", { date: formatPromptDate(prompt.createdAt, i18n.resolvedLanguage) }) : null}{prompt.createdAt && prompt.updatedAt ? " · " : null}{prompt.updatedAt ? t("common.updated", { date: formatPromptDate(prompt.updatedAt, i18n.resolvedLanguage) }) : null}</div> : null}
                    </div>
                    <div className="shrink-0 pt-4">
                        <Space wrap>
                            <Dropdown trigger={["click"]} menu={{ items: [{ key: "image", label: "生图工作台" }, { key: "video", label: "视频工作台" }], onClick: ({ key }) => {
                                void openDraft(key === "video" ? "video" : "image", { prompt: prompt.prompt, references: [] }).then((accepted) => {
                                    if (accepted) { trackPromptUsage(prompt.id, "use"); onClose(); }
                                });
                            } }}><Button type="primary">用此提示词<ChevronDown className="size-3" /></Button></Dropdown>
                            <Button icon={<Copy className="size-4" />} onClick={() => {
                                trackPromptUsage(prompt.id, "copy");
                                onCopy(prompt.prompt);
                            }}>
                                {t("common.copyPrompt")}
                            </Button>
                            {onSaveAsset ? (
                                <Button icon={<FolderPlus className="size-4" />} onClick={() => {
                                    trackPromptUsage(prompt.id, "use");
                                    onSaveAsset(prompt);
                                }}>
                                    {t("common.addToAssets")}
                                </Button>
                            ) : null}
                        </Space>
                        <p className="mt-2 text-xs text-[var(--ant-color-text-secondary)]">仅载入提示词；可按需添加自己的参考图，确认模型后再生成。</p>
                    </div>
                </div>
            ) : null}
        </Modal>
    );
}

/** [dianran] Credit line: author, model and a link to the original post (shown when the source provides them). */
function PromptAttribution({ prompt }: { prompt: Prompt }) {
    const { i18n, t } = useTranslation();
    const author = prompt.author?.trim();
    const link = prompt.sourceUrl && /^https:\/\/((x|twitter)\.com|civitai\.com)\//.test(prompt.sourceUrl) ? prompt.sourceUrl : "";
    if (!author && !link) return null;
    return (
        <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg bg-stone-50 px-3 py-2 text-xs text-stone-600 dark:bg-stone-900 dark:text-stone-400">
            {author ? <span className="font-medium text-stone-800 dark:text-stone-200">{t("prompts.attribution.author", { author })}</span> : null}
            {prompt.imageModel || prompt.model ? <span>{t("prompts.attribution.model", { model: prompt.imageModel || prompt.model })}</span> : null}
            {link && prompt.createdAt ? <span>{t("prompts.attribution.posted", { date: formatPromptDate(prompt.createdAt, i18n.resolvedLanguage) })}</span> : null}
            {link ? (
                <a href={link} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[var(--ant-color-primary)] hover:underline">
                    {t("prompts.attribution.source")}
                    <ExternalLink className="size-3" />
                </a>
            ) : null}
        </div>
    );
}
