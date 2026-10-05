import { describe, expect, test } from "bun:test";

import { collectImageAdjustments, collectVideoAdjustments, planImageRequest, planVideoRequest } from "../src/lib/model-capabilities";

describe("planImageRequest", () => {
    test("quality no longer raises the pixel tier", () => {
        const standard = planImageRequest({ model: "gpt-image-2", size: "1:1", quality: "standard" });
        const hd = planImageRequest({ model: "gpt-image-2", size: "1:1", quality: "high" });
        expect(standard.sizeValue).toBe("1024x1024");
        expect(hd.sizeValue).toBe("1024x1024");
        expect(standard.quality).toBeUndefined();
        expect(hd.quality).toEqual({ param: "quality", value: "high" });
    });
    test("auto is really auto", () => {
        expect(planImageRequest({ model: "gpt-image-1", size: "auto", quality: "standard" })).toMatchObject({ sizeField: "size", sizeValue: "auto" });
        expect(planImageRequest({ model: "flux", size: "auto", quality: "standard" }).sizeField).toBe("none");
        expect(planImageRequest({ model: "gemini-3-pro-image", size: "auto", quality: "standard", channel: "gemini" }).sizeField).toBe("none");
    });
    test("fixed-size models map to legal sizes", () => {
        expect(planImageRequest({ model: "gpt-image-1", size: "16:9", quality: "standard" }).sizeValue).toBe("1536x1024");
        expect(planImageRequest({ model: "dall-e-3", size: "9:16", quality: "hd" })).toMatchObject({ sizeValue: "1024x1792", quality: { param: "quality", value: "hd" } });
    });
    test("gemini 3 maps quality to imageSize", () => {
        expect(planImageRequest({ model: "gemini-3-pro-image-preview", size: "16:9", quality: "hd", channel: "gemini" })).toMatchObject({ sizeField: "aspectRatio", sizeValue: "16:9", quality: { param: "imageSize", value: "2K" } });
    });
    test("chat endpoint sends nothing", () => {
        expect(planImageRequest({ model: "x", size: "1:1", quality: "hd", background: "transparent", channel: "chat" })).toMatchObject({ sizeField: "none", background: undefined });
    });
    test("switching to gpt-image-1 snaps 4:3", () => {
        expect(collectImageAdjustments({ model: "gpt-image-1", size: "4:3", quality: "standard", count: "1" })[0]).toMatchObject({ kind: "ratio", to: "3:2" });
    });
});

describe("planVideoRequest", () => {
    test("veo sends aspectRatio + resolution only", () => {
        const plan = planVideoRequest({ model: "veo-3.1-generate-preview", apiFormat: "gemini", videoSize: "4:3", vquality: "480", seconds: "10" });
        expect(plan.fields).toEqual({ aspectRatio: "16:9", resolution: "720p", durationSeconds: 8 });
    });
    test("sora sends size only", () => {
        const plan = planVideoRequest({ model: "sora-2", apiFormat: "openai", videoSize: "9:16", vquality: "1080", seconds: "8" });
        expect(plan.fields).toEqual({ size: "1024x1792", seconds: 8 });
    });
    test("relay: size, or resolution_name when auto", () => {
        expect(planVideoRequest({ model: "grok-imagine-video", apiFormat: "openai", videoSize: "16:9", vquality: "720", seconds: "6" }).fields).toEqual({ size: "1280x720", seconds: 6 });
        expect(planVideoRequest({ model: "grok-imagine-video", apiFormat: "openai", videoSize: "auto", vquality: "1080", seconds: "6" }).fields).toEqual({ resolution_name: "1080p", seconds: 6 });
        expect(planVideoRequest({ model: "grok-imagine-video", apiFormat: "openai", videoSize: "1000x600", vquality: "720", seconds: "6" }).fields).toEqual({ size: "1000x600", seconds: 6 });
        expect(planVideoRequest({ model: "grok-imagine-video", apiFormat: "openai", videoSize: "1920x1080", vquality: "720", seconds: "6" }).customSize).toBeUndefined();
    });
    test("model switch snaps to veo options", () => {
        const notes = collectVideoAdjustments({ model: "veo-3", apiFormat: "gemini", videoSize: "1:1", vquality: "480", seconds: "10" }).map((item) => item.key);
        expect(notes).toEqual(["videoSize", "vquality", "videoSeconds"]);
    });
});

describe("Gemini explicit output tiers", () => {
    test("all declared ratios keep 1K / 2K / 4K distinct, including extreme ratios", async () => {
        const { getImageCaps, imageTierSize } = await import("../src/lib/model-capabilities");
        const model = "gemini-3-pro-image-preview";
        for (const ratio of getImageCaps(model, "gemini").ratios) {
            for (const tier of ["1k", "2k", "4k"] as const) {
                const plan = planImageRequest({ model, size: imageTierSize(ratio, tier), quality: "standard", channel: "gemini" });
                expect(plan.ratio).toBe(ratio);
                expect(plan.quality).toEqual({ param: "imageSize", value: tier.toUpperCase() });
            }
        }
    });
});
