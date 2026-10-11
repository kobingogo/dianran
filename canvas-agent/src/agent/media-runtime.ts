import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { CodexMediaAdapter, type CodexMediaEvidence } from "./media-codex.js";
import { AgentMediaRegistry } from "./media-registry.js";
import type { MediaRequest, MediaTask } from "./media-types.js";
import type { AgentAttachment, AgentEmit } from "./types.js";

type RuntimeCallbacks = {
    productionDirectory: string;
    codexHome?: string;
    recordsDirectory?: string;
    evidence: () => Promise<CodexMediaEvidence>;
    emit: AgentEmit;
    startThread: (emit: AgentEmit, cwd: string) => Promise<{ id: string }>;
    runTurn: (prompt: string, emit: AgentEmit, attachments: AgentAttachment[], options: { threadId: string; cwd: string; permissionMode: "request"; model?: string; appEmit: AgentEmit; onTurn: (turnId: string) => void }) => Promise<void>;
    onStart?: (task: MediaTask) => void;
    onFinish?: (task: MediaTask) => void;
};
/** Supply normal app-server emit/approval handlers; never impersonate approval decisions. */
export function createCodexMediaRuntime(options: RuntimeCallbacks) {
    const registry = new AgentMediaRegistry(options.recordsDirectory);
    const bound = new Map<string, { task: MediaTask; ready: Promise<unknown> }>();
    const nativeBindings = new Map<string, Promise<MediaTask>>();
    const nativeIntents = new Map<string, { requestId: string; projectId: string; revision: string; prompt: string; cwd: string }>();
    const pending = new Set<Promise<unknown>>();
    const processing = new Set<string>();
    async function productionRoot(request: MediaRequest) { const identity = crypto.createHash("sha256").update(JSON.stringify([request.projectId, request.requestId])).digest("hex"); const directory = path.join(options.productionDirectory, identity); await fs.mkdir(directory, { recursive: true, mode: 0o700 }); return directory; }
    function capture(type: string, payload: unknown) {
        if (type !== "agent_event" || !payload || typeof payload !== "object") return;
        const event = payload as { type?: string; thread_id?: string; turn_id?: string; item?: { type?: string; id?: string; savedPath?: string; status?: string } };
        if (event.type !== "item.completed" || event.item?.type !== "image_generation" || !event.item.id || !event.item.savedPath) return;
        const eventKey = JSON.stringify([event.thread_id, event.turn_id, event.item.id]);
        if (processing.has(eventKey)) return;
        processing.add(eventKey);
        const operation = (async () => {
            let owner = bound.get(JSON.stringify([event.thread_id, event.turn_id]));
            if (!owner && event.thread_id && event.turn_id) {
                const key=JSON.stringify([event.thread_id,event.turn_id]);const input=nativeIntents.get(key);
                if(input && !nativeBindings.has(key)){const ready=(async()=>{const task=await registry.create({requestId:input.requestId,projectId:input.projectId,revision:input.revision,prompt:input.prompt || "原生对话图片产物",agentId:"codex",capability:"text-to-image"},input.cwd);await registry.bind(task.id,{threadId:event.thread_id!,turnId:event.turn_id!});return registry.get(task.id,input.projectId);})();nativeBindings.set(key,ready);}
                const task = nativeBindings.has(JSON.stringify([event.thread_id,event.turn_id])) ? await nativeBindings.get(JSON.stringify([event.thread_id,event.turn_id])) : await registry.findNative(event.thread_id, event.turn_id); if (task) owner = { task, ready: Promise.resolve() }; }
            if (!owner) return;
            await owner.ready;
            try {
                const threadId = event.thread_id!, itemId = event.item!.id!;
                if (!/^[A-Za-z0-9_-]+$/.test(threadId) || !/^[A-Za-z0-9_-]+$/.test(itemId)) throw new Error("Codex 原生产物身份格式无效");
                const codexHome = path.resolve(options.codexHome || process.env.CODEX_HOME || path.join(os.homedir(), ".codex"));
                const generatedDirectory = path.join(codexHome, "generated_images");
                const sourceDirectory = path.join(generatedDirectory, threadId);
                const sourcePath = path.join(sourceDirectory, `${itemId}.png`);
                const announced = path.resolve(event.item!.savedPath!);
                const info = await fs.lstat(announced);
                const production = await registry.authorizedProductionRoot(owner.task.id);
                const destination = path.join(production, `${itemId}.png`);
                const real = await fs.realpath(announced);
                const relative = path.relative(await fs.realpath(production), real);
                const taskOutput = !info.isSymbolicLink() && Boolean(relative) && !relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative);
                if (!taskOutput) {
                    const generatedInfo = await fs.lstat(generatedDirectory);
                    const threadInfo = await fs.lstat(sourceDirectory);
                    if (generatedInfo.isSymbolicLink() || threadInfo.isSymbolicLink() || info.isSymbolicLink() || announced !== sourcePath || await fs.realpath(generatedDirectory) !== generatedDirectory || await fs.realpath(sourceDirectory) !== sourceDirectory || await fs.realpath(path.dirname(announced)) !== sourceDirectory) throw new Error("Codex 产物不在该线程的固定图片输出目录");
                    await fs.copyFile(announced, destination, fs.constants.COPYFILE_EXCL);
                }
                const artifact = await registry.registerArtifact(owner.task.id, { threadId, turnId:event.turn_id!, itemId, path:taskOutput ? announced : destination, kind:"image" });
                options.emit("agent_media_artifact", { taskId: owner.task.id, projectId: owner.task.request.projectId, artifact });
            } catch (error) { await registry.mark(owner.task.id, "unknown", `原产物导入失败：${error instanceof Error ? error.message : String(error)}`); options.emit("agent_media_error", { taskId: owner.task.id, projectId: owner.task.request.projectId, error: "原产物导入失败，请查询原任务并重新导入；不会重新生成" }); }
        })();
        pending.add(operation); void operation.then(() => { pending.delete(operation); processing.delete(eventKey); }, () => { pending.delete(operation); processing.delete(eventKey); });
    }
    const emit: AgentEmit = (type, payload) => { capture(type, payload); options.emit(type, payload); };
    const adapter = new CodexMediaAdapter(registry, productionRoot, options.evidence, async (task, bind) => {
        options.onStart?.(task);
        const cwd = await productionRoot(task.request);
        try {
            const thread = await options.startThread(emit, cwd);
            await options.runTurn(`使用 Codex 内置图片生成工具完成以下${task.request.capability === "image-edit" ? "图片编辑" : "文生图"}任务；不要调用其他收费 API，输出保存到当前工作目录。只执行本次请求，不重复生成。\n${task.request.prompt}`, emit, task.request.references?.map((reference) => ({ id: reference.id, name: reference.name, dataUrl: reference.dataUrl })) || [], { threadId: thread.id, cwd, permissionMode: "request", model:task.request.codexModel, appEmit: emit, onTurn(turnId) { const ready = bind(thread.id, turnId); bound.set(JSON.stringify([thread.id, turnId]), { task, ready }); } });
            await Promise.all([...pending]);
            const latest = await registry.get(task.id, task.request.projectId);
            if (!latest.artifacts.length && latest.status !== "unknown") await registry.mark(task.id, "unknown", "本轮没有可登记的生成产物；请查询原任务，不能认定已经生图成功");
        } finally { options.onFinish?.(task); }
    });
    function bindNativeTurn(threadId: string, turnId: string, input: { requestId: string; projectId: string; revision: string; prompt: string; cwd: string }) {
        const key=JSON.stringify([threadId,turnId]);
        if(bound.has(key))return bound.get(key)!.ready;
        nativeIntents.set(key,structuredClone(input));return Promise.resolve();
    }
    return { registry, adapter, capture, emit, bindNativeTurn, recover: () => registry.recover() };
}
