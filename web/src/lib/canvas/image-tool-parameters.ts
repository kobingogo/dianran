import type { PluginActionParameters } from "@/types/canvas-plugin";

export const imageToolTitles = { removeBackground: "去背景", upscale: "AI 放大 2 倍", crop: "裁剪", resize: "尺寸适配", convert: "格式转换" };
export type ImageTool = keyof typeof imageToolTitles;
export function imageToolParameters(action: ImageTool, input: unknown): PluginActionParameters {
    const p = input as PluginActionParameters;
    if (!p || typeof p !== "object" || Array.isArray(p)) throw new Error("请填写处理参数");
    const keys: string[] = { removeBackground: [], upscale: [], crop: ["x", "y", "width", "height"], resize: ["width", "height", "fit", "background"], convert: ["format", "quality", "background"] }[action];
    if (!keys || Object.keys(p).some((key) => !keys.includes(key))) throw new Error("处理参数包含未知字段");
    const integer = (key: string, zero = false) => { if (typeof p[key] !== "number" || !Number.isSafeInteger(p[key]) || Number(p[key]) < (zero ? 0 : 1)) throw new Error(`${key} 必须是${zero ? "非负" : "正"}整数`); return p[key]; };
    const background = () => { if (typeof p.background !== "string" || !/^#[\da-f]{6}$/i.test(p.background)) throw new Error("背景颜色须为六位十六进制颜色"); return p.background; };
    if (action === "crop") return { x: integer("x", true), y: integer("y", true), width: integer("width"), height: integer("height") };
    if (action === "resize") { if (!["contain", "cover"].includes(String(p.fit))) throw new Error("请选择完整适配或填满裁切"); return { width: integer("width"), height: integer("height"), fit: p.fit, background: background() }; }
    if (action === "convert") { if (!["png", "jpeg", "webp"].includes(String(p.format)) || typeof p.quality !== "number" || !Number.isFinite(p.quality) || p.quality < 0 || p.quality > 1) throw new Error("请选择图片格式与 0–1 编码质量"); return { format: p.format, quality: p.quality, background: background() }; }
    return {};
}

export function imageToolGeometry(action: ImageTool, p: PluginActionParameters, width: number, height: number) {
    if (action === "crop") {
        if (Number(p.x) + Number(p.width) > width || Number(p.y) + Number(p.height) > height) throw new Error("裁剪范围超出原图，请按原图像素重新填写");
        return { width: Number(p.width), height: Number(p.height), source: [Number(p.x), Number(p.y), Number(p.width), Number(p.height)], destination: [0, 0, Number(p.width), Number(p.height)] };
    }
    const w = action === "resize" ? Number(p.width) : width, h = action === "resize" ? Number(p.height) : height;
    const scale = action !== "resize" ? 1 : p.fit === "cover" ? Math.max(w / width, h / height) : Math.min(w / width, h / height);
    return { width: w, height: h, source: [0, 0, width, height], destination: [(w - width * scale) / 2, (h - height * scale) / 2, width * scale, height * scale] };
}
