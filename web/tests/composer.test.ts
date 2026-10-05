import { describe, expect, test } from "bun:test";
const memory = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", { value: { getItem: (key: string) => memory.get(key) || null, setItem: (key: string, value: string) => memory.set(key, value), removeItem: (key: string) => memory.delete(key) }, configurable: true });
const { createComposerSubmission, creationSnapshot, normalizeComposerConfig } = await import("../src/lib/composer");
const { defaultConfig } = await import("../src/stores/use-config-store");
const { useWorkbenchAgentStore } = await import("../src/stores/use-workbench-agent-store");

const channels = [
    {
        id: "relay",
        name: "中转",
        baseUrl: "https://relay.example",
        apiKey: "test-secret",
        apiFormat: "openai" as const,
        models: [
            { name: "grok-imagine-video", capability: "video" as const },
            { name: "sora-2", capability: "video" as const },
        ],
    },
    { id: "gemini", name: "Gemini", baseUrl: "https://generativelanguage.googleapis.com", apiKey: "test-secret", apiFormat: "gemini" as const, models: [{ name: "veo-3.1", capability: "video" as const }] },
];
describe("Composer handoff", () => {
    test("submission retains attachments, prompt, actual parameters; snapshot contains no credentials", () => {
        const config = { ...defaultConfig, count: "3", apiKey: "test-secret" };
        const ref = { id: "asset1", name: "参考", type: "image/png", dataUrl: "data:image/png;base64,x", storageKey: "image1" };
        const submission = createComposerSubmission("image", "@[ref:asset1] 春山", [ref], config);
        config.size = "16:9";
        ref.name = "改名";
        expect(submission.prompt).toBe("参考图1 春山");
        expect(submission.references[0].name).toBe("参考");
        expect(submission.actual.size).toBe("1024x1024");
        expect(submission.parameters.count).toBe("3");
        expect(JSON.stringify(creationSnapshot(submission))).not.toContain("test-secret");
        useWorkbenchAgentStore.getState().dispatchImage({ submission, prompt: submission.prompt, run: true });
        expect(useWorkbenchAgentStore.getState().imageCommand?.submission?.id).toBe(submission.id);
        useWorkbenchAgentStore.getState().clearImageCommand();
        expect(useWorkbenchAgentStore.getState().imageCommand).toBeNull();
    });
    test("model switch preserves legal values and snaps only illegal ones", () => {
        const config = { ...defaultConfig, channels, videoModel: "gemini::veo-3.1", videoSize: "16:9", videoSeconds: "10", vquality: "720" };
        const veo = normalizeComposerConfig(config, "video");
        expect(veo.config.videoSeconds).toBe("8");
        expect(veo.config.videoSize).toBe("16:9");
        expect(veo.notes.join(" ")).toContain("10");
        const sora = createComposerSubmission("video", "晨雾", [], { ...veo.config, videoModel: "relay::sora-2", videoSeconds: "12" });
        expect(sora.actual).toEqual({ size: "1280x720", seconds: 12 });
    });
    test("invalid references stop submission instead of silently disappearing", () => {
        expect(() => createComposerSubmission("image", "@[ref:missing] 春山", [], defaultConfig)).toThrow("引用已失效");
    });
});
