import "./browser-storage";
import { expect, test } from "bun:test";
const { appendDeliveryGraph } = await import("../src/lib/canvas/canvas-delivery-graph");
const { createComposerSubmission, creationSnapshot } = await import("../src/lib/composer");
const { defaultConfig } = await import("../src/stores/use-config-store");
const ref = { id: "ref", name: "原图", type: "image/png", dataUrl: "data:image/png;base64,AA==", storageKey: "image:original" };
const creation = creationSnapshot(createComposerSubmission("image", "@[ref:ref] 春山", [ref], { ...defaultConfig, apiKey: "secret" }));
const result = { id: "result", url: "blob:result", storageKey: "image:result", width: 200, height: 100, bytes: 12, creation };
test("result-only delivery can be upgraded without duplicating the result or process", () => {
    const first = appendDeliveryGraph("image", result, [], []);
    expect(first.nodes.length).toBe(1);
    const full = appendDeliveryGraph("image", result, first.nodes, [], true, [ref]);
    expect(full.nodes.length).toBe(3);
    expect(full.connections.map((edge) => edge.kind)).toEqual(["input", "generation"]);
    const output = full.nodes.find((node) => node.metadata?.sourceResultId === result.id)!;
    expect(output.id).toBe(first.nodes[0].id);
    expect(output.metadata?.inputSnapshot?.prompt).toBe("参考图1 春山");
    expect(output.metadata?.inputSnapshot?.referenceImages[0].dataUrl).toBe("");
    expect(output.metadata?.inputSnapshot?.referenceImages[0].storageKey).toBe("image:original");
    expect(JSON.stringify(full)).not.toContain("secret");
    const again = appendDeliveryGraph("image", result, full.nodes, full.connections, true, [ref]);
    expect(again.nodes).toBe(full.nodes);
    expect(again.connections).toBe(full.connections);
});
test("missing reference snapshot blocks full process delivery", () => {
    expect(() => appendDeliveryGraph("image", result, [], [], true, [])).toThrow("不完整");
});
