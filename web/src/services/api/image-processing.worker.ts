import { pipeline, RawImage, env } from "@huggingface/transformers";
import type { ImageTool } from "@/lib/canvas/image-tool-parameters";

// Only model files and the runtime are downloaded; source images stay inside this worker.
env.allowLocalModels = false;
self.onmessage = async ({ data }: MessageEvent<{ action: ImageTool; image: Blob }>) => {
    try {
        const progress = () => self.postMessage({ progress: "正在下载或读取本地模型" });
        const processor = data.action === "removeBackground"
            ? await pipeline("background-removal", "onnx-community/ormbg-ONNX", { dtype: "fp32", progress_callback: progress })
            : await pipeline("image-to-image", "Xenova/swin2SR-lightweight-x2-64", { dtype: "fp32", progress_callback: progress });
        try {
            self.postMessage({ progress: "正在本地处理图片" });
            const image = await RawImage.fromBlob(data.image);
            const originalAlpha = image.channels === 4 ? image.clone() : undefined;
            const output = await processor(image);
            let result = Array.isArray(output) ? output[0] : output;
            if (originalAlpha) {
                // Super-resolution predicts RGB; retain the original transparency mask at the new resolution.
                const alpha = await originalAlpha.resize(result.width, result.height);
                result = result.rgba();
                for (let i = 3; i < result.data.length; i += 4) result.data[i] = data.action === "upscale" ? alpha.data[i] : Math.round(result.data[i] * alpha.data[i] / 255);
            }
            self.postMessage({ result: await result.toBlob() });
        } finally { await processor.dispose(); }
    } catch (error) { self.postMessage({ error: error instanceof Error ? error.message : String(error) }); }
};
