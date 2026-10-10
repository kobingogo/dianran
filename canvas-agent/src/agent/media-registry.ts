import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileTypeFromBuffer } from "file-type";
import { CONFIG_DIR } from "../config.js";
import type { MediaArtifact, MediaRequest, MediaTask } from "./media-types.js";

type StoredTask = MediaTask & { productionRoot: string; files: Record<string, string> };
export class AgentMediaRegistry {
    private queue: Promise<unknown> = Promise.resolve();
    constructor(private directory = path.join(CONFIG_DIR, "media-tasks")) {}
    private run<T>(fn: () => Promise<T>): Promise<T> { const next = this.queue.catch(() => {}).then(fn); this.queue = next; return next; }
    private file(id: string) { if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error("媒体任务身份无效"); return path.join(this.directory, `${id}.json`); }
    private async read(id: string): Promise<StoredTask> { const task = JSON.parse(await fs.readFile(this.file(id), "utf8")); if (task.version !== 1 || task.id !== id || !task.request?.projectId || !Array.isArray(task.artifacts) || !task.files || !path.isAbsolute(task.productionRoot)) throw new Error("媒体任务记录版本未知或损坏，拒绝覆盖"); return task; }
    private async write(task: StoredTask) { await fs.mkdir(this.directory, { recursive: true, mode: 0o700 }); const temporary = `${this.file(task.id)}.${crypto.randomUUID()}.tmp`; await fs.writeFile(temporary, JSON.stringify(task), { mode: 0o600 }); await fs.rename(temporary, this.file(task.id)); }
    private public(task: StoredTask): MediaTask { const { productionRoot: _, files: __, ...result } = task; return structuredClone(result); }
    create(request: MediaRequest, productionRoot: string) { return this.run(async () => {
        if (!request.projectId || !request.requestId || !request.revision || !request.prompt.trim()) throw new Error("媒体请求缺少项目、修订、请求身份或提示词");
        const root = await fs.realpath(productionRoot);
        for (const item of await this.listStored()) if (item.request.requestId === request.requestId && item.request.projectId === request.projectId) { if (item.productionRoot !== root || JSON.stringify(item.request) !== JSON.stringify(request)) throw new Error("同一请求身份不能对应不同输入"); return this.public(item); }
        const task: StoredTask = { version: 1, id: crypto.randomUUID(), request: structuredClone(request), productionRoot: root, files: {}, status: "pending", artifacts: [], createdAt: Date.now() }; await this.write(task); return this.public(task);
    }); }
    claimSubmission(id: string) { return this.run(async () => { const task = await this.read(id); if (task.status !== "pending") return false; task.status = "unknown"; task.error = "提交阶段尚未取得原生任务回执"; await this.write(task); return true; }); }
    bind(id: string, native: NonNullable<MediaTask["native"]>) { return this.run(async () => { const task = await this.read(id); if (!native.threadId || !native.turnId || (task.native && JSON.stringify(task.native) !== JSON.stringify(native))) throw new Error("媒体任务原生身份冲突"); task.native = native; task.status = task.artifacts.length ? "completed" : "running"; task.error = undefined; await this.write(task); return this.public(task); }); }
    mark(id: string, status: MediaTask["status"], error?: string) { return this.run(async () => { const task = await this.read(id); task.status = status; task.error = error; await this.write(task); return this.public(task); }); }
    registerArtifact(id: string, input: { threadId: string; turnId: string; itemId: string; path: string; kind: "image" | "video" }) { return this.run(async () => {
        const task = await this.read(id);
        if (!task.native || task.native.threadId !== input.threadId || task.native.turnId !== input.turnId || !input.itemId) throw new Error("产物不属于当前登记的原生任务");
        const target = await fs.realpath(input.path); const relative = path.relative(task.productionRoot, target);
        if (!relative || relative.startsWith(`..${path.sep}`) || relative === ".." || path.isAbsolute(relative)) throw new Error("产物超出当前任务授权目录");
        const data = await fs.readFile(target); const contentType = await mediaType(data, input.kind); const sha256 = crypto.createHash("sha256").update(data).digest("hex");
        const existing = task.artifacts.find((item) => item.itemId === input.itemId);
        if (existing) { if (existing.sha256 !== sha256 || existing.kind !== input.kind) throw new Error("同一原生产物内容冲突"); return existing; }
        const artifact: MediaArtifact = { id: crypto.randomUUID(), itemId: input.itemId, kind: input.kind, contentType, sha256, bytes: data.length };
        // Preserve an immutable copy; later native-path changes cannot replace a registered result.
        const copy = path.join(this.directory, `${artifact.id}.media`); await fs.writeFile(copy, data, { flag: "wx", mode: 0o600 }); task.files[artifact.id] = copy; task.artifacts.push(artifact); task.status = "completed"; task.error = undefined; await this.write(task); return artifact;
    }); }
    async get(id: string, projectId: string) { const task = await this.read(id); if (task.request.projectId !== projectId) throw new Error("媒体任务项目不匹配"); return this.public(task); }
    async authorizedProductionRoot(id: string) { return (await this.read(id)).productionRoot; }
    async readArtifact(id: string, artifactId: string, projectId: string) { const task = await this.read(id); if (task.request.projectId !== projectId) throw new Error("媒体任务项目不匹配"); const artifact = task.artifacts.find((item) => item.id === artifactId); if (!artifact || !task.files[artifactId]) throw new Error("产物未登记"); const file = await fs.realpath(task.files[artifactId]); if (path.dirname(file) !== await fs.realpath(this.directory) || path.basename(file) !== `${artifactId}.media`) throw new Error("产物记录路径无效"); const data = await fs.readFile(file); if (crypto.createHash("sha256").update(data).digest("hex") !== artifact.sha256 || await mediaType(data, artifact.kind) !== artifact.contentType) throw new Error("产物内容校验失败"); return { artifact, data }; }
    private async listStored() { const files = await fs.readdir(this.directory).catch((error) => { if (error.code === "ENOENT") return []; throw error; }); return Promise.all(files.filter((name) => /^[a-f0-9-]{36}\.json$/.test(name)).map((name) => this.read(name.slice(0, -5)))); }
    async findNative(threadId: string, turnId: string) { const tasks = (await this.listStored()).filter((task) => task.native?.threadId === threadId && task.native?.turnId === turnId); if (tasks.length > 1) throw new Error("原生任务归属冲突"); return tasks[0] ? this.public(tasks[0]) : undefined; }
    async list(projectId: string) { return (await this.listStored()).filter((task) => task.request.projectId === projectId).map((task) => this.public(task)); }
    recover() { return this.run(async () => { for (const task of await this.listStored()) if (task.status === "running" || task.status === "pending") { task.status = "unknown"; task.error = "服务已重启；原任务是否完成尚未确认，不会自动重新生成"; await this.write(task); } }); }
}
async function mediaType(data: Buffer, kind: "image" | "video") {
    const type = await fileTypeFromBuffer(data);
    if (!type || !type.mime.startsWith(`${kind}/`)) throw new Error("媒体文件实际类型与声明不符");
    return type.mime;
}
