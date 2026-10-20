import { Copy, ExternalLink, FolderPlus } from "lucide-react";
import { Button, Modal, Space, Tag } from "antd";
import { useTranslation } from "react-i18next";

import { PromptCover } from "@/components/prompts/prompt-card";
import { formatPromptDate, type Prompt } from "@/services/api/prompts";
import { trackPromptUsage } from "@/services/usage-stats";

export function PromptDetailDialog({ prompt, onClose, onCopy, onSaveAsset }: { prompt: Prompt | null; onClose: () => void; onCopy: (prompt: string) => void; onSaveAsset?: (prompt: Prompt) => void }) {
    const { i18n, t } = useTranslation();

    return (
        <Modal title={prompt?.title} open={Boolean(prompt)} onCancel={onClose} footer={null} width={720} centered styles={{ body: { height: "calc(85vh - 55px)", overflow: "hidden" } }}>
            {prompt ? (
                <div className="flex h-full min-h-0 flex-col">
                    <div className="shrink-0 space-y-3 pb-4">
                        <PromptCover key={prompt.id} src={prompt.coverUrl} alt={prompt.title} loading="eager" className="h-48 w-full rounded-lg sm:h-56" />
                        {prompt.referenceImageUrls.length > 1 ? <div className="grid grid-cols-6 gap-2">{prompt.referenceImageUrls.filter((url) => url !== prompt.coverUrl).slice(0, 6).map((url) => <img key={url} src={url} alt="" className="aspect-square w-full rounded-md object-cover" loading="lazy" />)}</div> : null}
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
                            <Button type="primary" icon={<Copy className="size-4" />} onClick={() => {
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
            {prompt.imageModel ? <span>{t("prompts.attribution.model", { model: prompt.imageModel })}</span> : null}
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
