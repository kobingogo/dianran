import { useState } from "react";
import { App } from "antd";
import { saveAs } from "file-saver";
import { createZip } from "@/lib/zip";
import { getImageBlob } from "@/services/image-storage";
import { processImage } from "@/services/api/image-processing";
import { markBundledAction } from "./plugin-actions";
import { imageToolParameters, imageToolTitles, type ImageTool } from "./image-tool-parameters";
import { showErrorToast } from "@/features/errors/error-toast";
import type { CanvasPlugin, CanvasNodeContext, PluginActionParameters } from "@/types/canvas-plugin";

function ImageToolContent({ ctx }: { ctx: CanvasNodeContext }) {
    const { message } = App.useApp();
    const action = ctx.node.type.split(":")[1] as ImageTool | "export";
    const images = ctx.getUpstream().filter((node) => node.type === "image" && node.metadata?.storageKey);
    const [busy, setBusy] = useState(false);
    const original = images[0]?.metadata;
    const p: PluginActionParameters = { ...(action === "crop" ? { x: 0, y: 0, width: original?.naturalWidth || 0, height: original?.naturalHeight || 0 } : action === "resize" ? { width: original?.naturalWidth || 0, height: original?.naturalHeight || 0, fit: "contain", background: "#ffffff" } : action === "convert" ? { format: "png", quality: 0.9, background: "#ffffff" } : {}), ...ctx.node.metadata?.pluginActionParameters };
    const update = (key: string, value: string | number) => ctx.updateMetadata({ pluginActionParameters: { ...p, [key]: value } });
    const field = (key: string, label: string) => <label className="flex items-center justify-between gap-3 text-xs">{label}<input aria-label={label} className="w-24 bg-transparent text-right" type="number" step={key === "quality" ? 0.1 : 1} value={Number(p[key])} onChange={(event) => update(key, Number(event.target.value))} /></label>;
    const exportImages = async () => {
        setBusy(true);
        try {
            if (!images.length) throw new Error("请连接要导出的图片");
            const files = await Promise.all(images.map(async (node, index) => { const blob = await getImageBlob(node.metadata!.storageKey!); if (!blob) throw new Error(`${node.title} 原文件缺失，未导出`); return { name: `${index + 1}-${node.title.replace(/[\\/:*?"<>|]/g, "_")}.${blob.type === "image/jpeg" ? "jpg" : blob.type.split("/")[1] || "png"}`, data: blob }; }));
            saveAs(await createZip(files), "点染图片交付.zip");
            message.success("图片包已准备，下载已发起");
        } catch (error) { showErrorToast(message, error); }
        finally { setBusy(false); }
    };
    return <div data-canvas-no-zoom onPointerDown={(event) => event.stopPropagation()} onWheel={(event) => event.stopPropagation()} className="flex h-full flex-col gap-3 overflow-auto p-4" style={{ color: ctx.theme.node.text }}>
        <p className="text-sm">{action === "export" ? "打包导出" : imageToolTitles[action]}</p>
        <p className="text-xs" style={{ color: ctx.theme.node.muted }}>{images.length ? `已连接 ${images.length} 张原图${original?.naturalWidth ? ` · ${original.naturalWidth} × ${original.naturalHeight}` : ""}` : "从图片节点右侧连线接入此工具"}</p>
        {action === "crop" && <>{field("x", "左边距（像素）")}{field("y", "上边距（像素）")}{field("width", "裁剪宽度")}{field("height", "裁剪高度")}</>}
        {action === "resize" && <>{field("width", "输出宽度")}{field("height", "输出高度")}<label className="flex justify-between gap-3 text-xs">适配方式<select className="bg-transparent" value={String(p.fit)} onChange={(event) => update("fit", event.target.value)}><option value="contain">完整保留，加留白</option><option value="cover">填满画面，裁切边缘</option></select></label></>}
        {action === "convert" && <><label className="flex justify-between gap-3 text-xs">格式<select className="bg-transparent" value={String(p.format)} onChange={(event) => update("format", event.target.value)}><option value="png">PNG（保留透明）</option><option value="jpeg">JPEG（合成背景）</option><option value="webp">WebP（保留透明）</option></select></label>{field("quality", "编码质量（0–1）")}</>}
        {(action === "resize" || action === "convert") && <label className="flex justify-between text-xs">留白 / JPEG 背景<input aria-label="输出背景颜色" type="color" value={String(p.background)} onChange={(event) => update("background", event.target.value)} /></label>}
        {(action === "removeBackground" || action === "upscale") && <p className="text-xs" style={{ color: ctx.theme.node.muted }}>在本地处理原图。首次运行会下载模型，需要网络和设备内存；失败时保留原图，不上传到模型服务。</p>}
        <p className="text-xs" style={{ color: ctx.theme.node.muted }}>{action === "export" ? "导出已保存的原文件；缺件时停止，不用缩略图代替。" : "另存结果，不覆盖原图。可加入工作流，保存完成后传给下游。"}</p>
        <button className="mt-auto self-start rounded px-2 py-1 text-xs hover:bg-black/5 dark:hover:bg-white/10" disabled={busy || !images.length} onClick={() => { if (action === "export") void exportImages(); else { try { ctx.previewWorkflow(imageToolParameters(action, p)); } catch (error) { showErrorToast(message, error); } } }}>{busy ? "正在准备图片包…" : action === "export" ? "打包下载原图" : "预览处理"}</button>
    </div>;
}

export const imageToolsPlugin: CanvasPlugin = {
    id: "dianran-image-tools", name: "点染素材处理", version: "1.0.0", description: "去背景、AI 放大、裁剪、尺寸适配、格式转换和打包导出",
    nodes: [...Object.entries(imageToolTitles).map(([key, title]) => ({ type: `dianran-image-tools:${key}`, title, icon: "✂", defaultSize: { width: 320, height: 360 }, defaultMetadata: { pluginActionParameters: {} }, Content: ImageToolContent,
        workflowAction: { id: key, version: "1.0.0", title, description: key === "removeBackground" || key === "upscale" ? "本地 AI 图片处理，首次下载模型；结果另存为图片。" : "浏览器本地处理，原图保留，结果另存为图片。", validate: (parameters: unknown) => imageToolParameters(key as ImageTool, parameters), execute: async (images: Blob[], parameters: PluginActionParameters, progress: (message: string) => void) => { const results: Blob[] = []; for (const [index, image] of images.entries()) { progress(`正在处理第 ${index + 1} / ${images.length} 张`); results.push(await processImage(key as ImageTool, image, parameters, progress)); } return results; } },
    })), { type: "dianran-image-tools:export", title: "图片打包导出", icon: "↓", defaultSize: { width: 320, height: 260 }, Content: ImageToolContent }],
};
imageToolsPlugin.nodes.forEach((definition) => markBundledAction(definition, "bundled:dianran-image-tools:1.0.0"));
