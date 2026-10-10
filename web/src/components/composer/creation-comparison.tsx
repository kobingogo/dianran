import { useEffect, useState } from "react";
import { Image, Modal } from "antd";
import type { CreationSnapshot } from "@/lib/composer";
import type { CanvasNodeData } from "@/types/canvas";
import { resolveImageUrl } from "@/services/image-storage";
import { resolveMediaUrl } from "@/services/file-storage";
export type ComparisonItem = { id: string; title: string; mode: "image" | "video"; content: string; storageKey?: string; creation?: CreationSnapshot; parameters?: unknown; prompt?: string; status?: string; primary?: boolean; source?: string };
export function canvasComparisonItems(nodes: CanvasNodeData[]): ComparisonItem[] {
    return nodes.flatMap((node): ComparisonItem[] => {
        if (node.type !== "image" && node.type !== "video") return [];
        const m = node.metadata || {};
        const base = { mode: node.type as "image" | "video", title: node.title, creation: m.creation, parameters: m.creation?.actual || { model: m.model, size: m.size, quality: m.quality, seconds: m.seconds }, prompt: m.prompt, source: node.id } as const;
        return m.images?.length
            ? m.images.map((image, index) => ({ ...base, id: image.id, title: `${node.title} · ${index + 1}`, content: image.content, storageKey: image.storageKey, status: image.status, primary: image.id === m.primaryImageId }))
            : [{ ...base, id: node.id, content: m.content || "", storageKey: m.storageKey, status: m.status }];
    });
}
const comparisonKey = (item: ComparisonItem) => `${item.source || ""}:${item.id}`;
export function CreationComparison({ items, open, onClose }: { items: ComparisonItem[]; open: boolean; onClose: () => void }) {
    const [urls, setUrls] = useState<Record<string, string>>({});
    const [error, setError] = useState("");
    useEffect(() => {
        if (!open) return;
        let active = true;
        setUrls({});
        setError("");
        void Promise.all(items.map(async (item) => [comparisonKey(item), item.mode === "image" ? await resolveImageUrl(item.storageKey, item.content) : await resolveMediaUrl(item.storageKey, item.content)] as const))
            .then((entries) => {
                if (active) setUrls(Object.fromEntries(entries));
            })
            .catch(() => {
                if (active) setError("部分原始素材无法读取，请恢复文件后重试");
            });
        return () => {
            active = false;
        };
    }, [open, items]);
    return (
        <Modal title="批次与版本比较" open={open} onCancel={onClose} footer={null} width={1100}>
            <p className="mb-3 text-sm">并排查看结果、提示词和本轮参数。比较不会修改主图、历史或画布节点。</p>
            {error && <p role="alert">{error}</p>}
            {!items.length && <p>请选择图片／视频结果，或在生图历史中勾选批次。</p>}
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
                {items.map((item) => (
                    <article key={`${item.source}:${item.id}`} className="min-w-0 space-y-2">
                        <h3>
                            {item.title}
                            {item.primary ? " · 主图" : ""}
                        </h3>
                        {urls[comparisonKey(item)] ? (
                            item.mode === "image" ? (
                                <Image src={urls[comparisonKey(item)]} alt={item.title} className="max-h-80 object-contain" />
                            ) : (
                                <video controls src={urls[comparisonKey(item)]} className="max-h-80 w-full" />
                            )
                        ) : (
                            <p>{item.status === "error" || item.status === "failed" ? "生成失败" : "暂无可用文件"}</p>
                        )}
                        <p className="whitespace-pre-wrap break-words text-sm">{item.creation?.prompt || item.prompt || "未记录提示词"}</p>
                        <p className="break-all text-xs">来源：{item.source || item.id}</p>
                        <pre className="overflow-auto text-xs">{JSON.stringify(item.creation?.actual || item.parameters || {}, null, 2)}</pre>
                        {!item.creation && <p className="text-xs">旧结果未记录完整提交快照，以上为保留参数。</p>}
                    </article>
                ))}
            </div>
        </Modal>
    );
}
