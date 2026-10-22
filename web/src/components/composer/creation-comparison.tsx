import { useEffect, useState } from "react";
import { Button, Image, Modal } from "antd";
import { useOpenCreationDraft } from "@/hooks/use-open-creation-draft";
import type { CreationSnapshot } from "@/lib/composer";
import type { CanvasNodeData } from "@/types/canvas";
import { resolveImageUrl } from "@/services/image-storage";
import { resolveMediaUrl } from "@/services/file-storage";
import { recordLocalDiagnostic } from "@/stores/use-local-diagnostics-store";
export type ComparisonItem = { id: string; title: string; mode: "image" | "video"; content: string; storageKey?: string; mimeType?: string; creation?: CreationSnapshot; parameters?: unknown; prompt?: string; status?: string; primary?: boolean; canAdopt?: boolean; source?: string };
export function canvasComparisonItems(nodes: CanvasNodeData[]): ComparisonItem[] {
    return nodes.flatMap((node): ComparisonItem[] => {
        if (node.type !== "image" && node.type !== "video") return [];
        const m = node.metadata || {};
        const base = { mode: node.type as "image" | "video", title: node.title, creation: m.creation, parameters: m.creation?.actual || { model: m.model, size: m.size, quality: m.quality, seconds: m.seconds }, prompt: m.prompt, source: node.id } as const;
        return m.images?.length
            ? m.images.map((image, index) => ({ ...base, id: image.id, title: `${node.title} · ${index + 1}`, content: image.content, storageKey: image.storageKey, mimeType: image.mimeType, status: image.status, primary: image.id === m.primaryImageId, canAdopt: node.type === "image" && m.images!.length > 1 }))
            : [{ ...base, id: node.id, content: m.content || "", storageKey: m.storageKey, mimeType: m.mimeType, status: m.status }];
    });
}
const comparisonKey = (item: ComparisonItem) => `${item.source || ""}:${item.id}`;
export function CreationComparison({ items, open, onClose, onAdopt }: { items: ComparisonItem[]; open: boolean; onClose: () => void; onAdopt?: (item: ComparisonItem) => void }) {
    const openDraft = useOpenCreationDraft();
    const [urls, setUrls] = useState<Record<string, string>>({});
    const [error, setError] = useState("");
    const [loading, setLoading] = useState(false);
    useEffect(() => {
        if (!open) return;
        let active = true;
        setUrls({});
        setError("");
        setLoading(true);
        void Promise.allSettled(items.map(async (item) => [comparisonKey(item), item.mode === "image" ? await resolveImageUrl(item.storageKey, item.content) : await resolveMediaUrl(item.storageKey, item.content)] as const))
            .then((results) => {
                if (!active) return;
                const entries = results.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
                setUrls(Object.fromEntries(entries));
                if (results.some((result, index) => result.status === "rejected" || (result.status === "fulfilled" && !result.value[1] && Boolean(items[index].content || items[index].storageKey)))) setError("部分素材无法读取，其余结果仍可查看和使用。请恢复缺失文件后重新打开比较。");
                setLoading(false);
            });
        return () => {
            active = false;
        };
    }, [open, items]);
    const unreadable = (item: ComparisonItem) => {
        setUrls((current) => ({ ...current, [comparisonKey(item)]: "" }));
        setError("部分素材无法显示，请恢复原文件后重新打开比较。");
    };
    return (
        <Modal title="批次与版本比较" open={open} onCancel={onClose} footer={null} width={1100}>
            <p className="mb-3 text-sm">并排挑选结果；图片可用作参考继续创作，画布图片批次可直接采用为主图。继续创作沿用工作台当前模型与参数。</p>
            {error && <p role="alert">{error}</p>}
            {!items.length && <p>请选择图片／视频结果，或在生图历史中勾选批次。</p>}
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
                {items.map((item) => {
                    const url = urls[comparisonKey(item)];
                    const usable = Boolean(url) && (!item.status || item.status === "idle" || item.status === "success");
                    return (
                        <article key={`${item.source}:${item.id}`} className="min-w-0 space-y-2">
                            <h3>
                                {item.title}
                                {item.primary ? " · 主图" : ""}
                            </h3>
                            {url ? (
                                item.mode === "image" ? (
                                    <Image src={url} alt={item.title} className="max-h-80 object-contain" onError={() => unreadable(item)} />
                                ) : (
                                    <video controls src={url} className="max-h-80 w-full" onError={() => unreadable(item)} />
                                )
                            ) : (
                                <p>{item.status === "error" || item.status === "failed" ? "生成失败" : loading ? "正在读取素材…" : "暂无可用文件"}</p>
                            )}
                            {item.mode === "image" && <div className="flex flex-wrap gap-1">
                                {onAdopt && item.canAdopt && !item.primary && <Button type="text" size="small" disabled={!usable} onClick={() => onAdopt(item)}>采用为主图</Button>}
                                <Button type="text" size="small" disabled={!usable} onClick={() => {
                                    void openDraft("image", { prompt: item.creation?.prompt || item.prompt || "", references: [{ id: item.id, name: item.title, type: item.mimeType || "image/png", dataUrl: url, storageKey: item.storageKey }] }).then((accepted) => { if (accepted) { void recordLocalDiagnostic("reference-reuse"); onClose(); } });
                                }}>用作参考继续创作</Button>
                            </div>}
                            <details className="text-xs text-[var(--ant-color-text-secondary)]">
                                <summary className="cursor-pointer py-1">提示词与参数</summary>
                                <p className="mt-2 whitespace-pre-wrap break-words text-sm">{item.creation?.prompt || item.prompt || "未记录提示词"}</p>
                                <pre className="mt-2 overflow-auto">{JSON.stringify(item.creation?.actual || item.parameters || {}, null, 2)}</pre>
                                {!item.creation && <p>此结果仅保留了部分参数，请在工作台重新核对模型设置。</p>}
                            </details>
                        </article>
                    );
                })}
            </div>
        </Modal>
    );
}
