import { describe, expect, test } from "bun:test";

const memory = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", { value: { getItem: (key: string) => memory.get(key) || null, setItem: (key: string, value: string) => memory.set(key, value), removeItem: (key: string) => memory.delete(key) }, configurable: true });
const { prepareCanvasSubmission, createCanvasSubmissionGraph, resultProvenance, vacantCanvasPosition } = await import("../src/lib/canvas/canvas-composer");
const { buildNodeGenerationContext } = await import("../src/components/canvas/canvas-node-generation");
const { defaultConfig } = await import("../src/stores/use-config-store");
const { CanvasNodeType } = await import("../src/types/canvas");
import type { CanvasNodeData } from "../src/types/canvas";

const config = { ...defaultConfig, imageModel: "gpt-image-2", model: "gpt-image-2", count: "3", size: "4:3", apiKey: "do-not-snapshot" };
const node = (id: string, type = CanvasNodeType.Image, content = "data:image/png;base64,one", groupId?: string): CanvasNodeData => ({ id, type, title: id, position: { x: 0, y: 0 }, width: 320, height: 240, metadata: { content, storageKey: type === CanvasNodeType.Image ? "image:" + content : undefined, groupId } });
describe("Canvas Composer input and provenance", () => {
    test("blank submission creates a config, material submission creates one material per resource", () => {
        const blank = prepareCanvasSubmission("image", "春山", [], config, []);
        const graph = createCanvasSubmissionGraph(blank, [], [], { x: 400, y: 200 });
        expect(graph.nodes.map((node) => node.type)).toEqual(["config"]);
        expect(graph.config.metadata?.creation?.actual.size).toBe("1024x768");
        expect(JSON.stringify(graph)).not.toContain("do-not-snapshot");
        expect(prepareCanvasSubmission("image", "春山", [], { ...config, count: "15" }, []).parameters.count).toBe("15");
        const attachment = { id: "ref1", name: "图片", type: "image/png", dataUrl: "data:image/png;base64,x", storageKey: "image:ref1" };
        const submission = prepareCanvasSubmission("image", "@[ref:ref1] 春山", [attachment, { ...attachment, id: "ref2" }], config, []);
        const materialGraph = createCanvasSubmissionGraph(submission, [], [], { x: 400, y: 200 });
        expect(materialGraph.nodes).toHaveLength(2);
        expect(materialGraph.connections).toHaveLength(1);
        expect(materialGraph.connections[0].kind).toBe("input");
        expect(materialGraph.config.metadata?.inputSnapshot?.referenceImages[0].dataUrl).toBe("");
    });
    test("group, member, copy and attachment references send the same file once", () => {
        const nodes = [node("group", CanvasNodeType.Group, ""), node("one", CanvasNodeType.Image, "same", "group"), node("copy", CanvasNodeType.Image, "same"), node("text", CanvasNodeType.Text, "晨雾", "group")];
        const submission = prepareCanvasSubmission("image", "@[node:group] @[node:one] @[node:copy] 春山", [{ id: "upload", name: "same", type: "image/png", dataUrl: "same", storageKey: "image:same" }], config, nodes);
        expect(submission.references).toHaveLength(1);
        expect(submission.input.textCount).toBe(1);
        expect(submission.prompt).toContain("晨雾");
        expect(submission.materials).toHaveLength(0);
    });
    test("missing node, empty group and unsupported media block submission; errors never remove tokens", () => {
        expect(() => prepareCanvasSubmission("image", "春山 @[node:missing]", [], config, [])).toThrow("引用已失效");
        expect(() => prepareCanvasSubmission("image", "春山 @[node:empty]", [], config, [node("empty", CanvasNodeType.Group, "")])).toThrow("引用已失效");
        expect(() => prepareCanvasSubmission("image", "春山 @[node:video]", [], config, [node("video", CanvasNodeType.Video, "https://video")])).toThrow("图片和文字");
        const source = node("config", CanvasNodeType.Config, "");
        source.metadata!.composerContent = "春山 @[node:missing]";
        expect(() => buildNodeGenerationContext(source.id, [source], [], source.metadata!.composerContent!)).toThrow("引用已失效");
    });
    test("deleting a textual mention does not remove the authoritative input", () => {
        const submission = prepareCanvasSubmission("image", "新的描述", [], config, [node("one")], ["one"]);
        expect(submission.references).toHaveLength(1);
        expect(submission.composerContent).toContain("@[node:one]");
    });
    test("empty target is filled; editing and regenerating preserve source and immutable snapshots", () => {
        const empty = node("empty", CanvasNodeType.Image, "");
        const first = prepareCanvasSubmission("image", "春山", [], config, [empty]);
        const fill = createCanvasSubmissionGraph(first, [empty], [], { x: 400, y: 200 }, empty);
        expect(fill.config.metadata?.resultTargetId).toBe("empty");
        expect(fill.nodes.find((node) => node.id === "empty")).toBe(empty);
        const result = node("result");
        const edit = prepareCanvasSubmission("image", "加晨雾 @[node:result]", [], config, [result]);
        const graph = createCanvasSubmissionGraph(edit, [result], [], { x: 400, y: 200 }, result, "edit");
        const provenance = resultProvenance(graph.config);
        expect(provenance.sourceNodeId).toBe(result.id);
        expect(provenance.branchKind).toBe("edit");
        result.metadata!.content = "changed";
        expect(provenance.inputSnapshot?.referenceImages[0].storageKey).not.toBe("changed");
        expect(graph.nodes).toContain(result);
        const version = createCanvasSubmissionGraph(first, [result], [], { x: 400, y: 200 }, result, "regenerate");
        expect(version.config.metadata?.versionOf).toBe(result.id);
        expect(version.config.metadata?.resultTargetId).toBeUndefined();
    });
    test("occupied layout rows are skipped", () => {
        expect(vacantCanvasPosition([node("one")], { x: 10, y: 0 }, 320, 240)).toEqual({ x: 10, y: 272 });
    });
});
