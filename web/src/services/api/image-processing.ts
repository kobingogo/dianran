import { imageToolGeometry, imageToolParameters, type ImageTool } from "@/lib/canvas/image-tool-parameters";
import type { PluginActionParameters } from "@/types/canvas-plugin";

async function modelImage(action: ImageTool, image: Blob, progress: (message: string) => void) {
    const worker = new Worker(new URL("./image-processing.worker.ts", import.meta.url), { type: "module" });
    try {
        return await new Promise<Blob>((resolve, reject) => {
            worker.onmessage = ({ data }) => { if (data.error) reject(new Error(data.error)); else if (data.result) resolve(data.result); else if (data.progress) progress(data.progress); };
            worker.onerror = (event) => reject(new Error(event.message || "本地模型加载失败，原图未改动"));
            worker.postMessage({ action, image });
        });
    } finally { worker.terminate(); }
}

export async function processImage(action: ImageTool, image: Blob, parameters: PluginActionParameters, progress: (message: string) => void) {
    const p = imageToolParameters(action, parameters);
    if (action === "removeBackground" || action === "upscale") return modelImage(action, image, progress);
    const bitmap = await createImageBitmap(image);
    try {
        const geometry = imageToolGeometry(action, p, bitmap.width, bitmap.height);
        const canvas = document.createElement("canvas");
        canvas.width = geometry.width; canvas.height = geometry.height;
        const context = canvas.getContext("2d");
        if (!context) throw new Error("当前浏览器无法处理图片");
        if (action === "resize" || (action === "convert" && p.format === "jpeg")) { context.fillStyle = String(p.background); context.fillRect(0, 0, canvas.width, canvas.height); }
        context.imageSmoothingEnabled = true; context.imageSmoothingQuality = "high";
        context.drawImage(bitmap, ...geometry.source as [number, number, number, number], ...geometry.destination as [number, number, number, number]);
        const mime = action === "convert" ? `image/${p.format}` : "image/png";
        const result = await new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("图片编码失败，原图未改动")), mime, p.quality === undefined ? undefined : Number(p.quality)));
        if (result.type !== mime) throw new Error("当前浏览器不支持该输出格式，请换一种格式");
        return result;
    } finally { bitmap.close(); }
}
