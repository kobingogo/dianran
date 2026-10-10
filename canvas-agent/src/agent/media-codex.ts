import type { AgentMediaRegistry } from "./media-registry.js";
import type { MediaAdapter, MediaCapabilities, MediaRequest, MediaTask } from "./media-types.js";

export type CodexMediaEvidence = { authenticated: boolean; imageTool: "verified" | "unverified" | "unavailable"; imageEditing?: boolean; reason?: string };
/** Runtime callbacks own Codex execution; this adapter never reads login credentials. */
export class CodexMediaAdapter implements MediaAdapter {
    constructor(private registry: AgentMediaRegistry, private root: string | ((request: MediaRequest) => Promise<string>), private evidence: () => Promise<CodexMediaEvidence>, private start: (task: MediaTask, bind: (threadId: string, turnId: string) => Promise<unknown>) => Promise<void>) {}
    async capabilities(): Promise<MediaCapabilities> { const evidence = await this.evidence(); return { agentId: "codex", tool: "Codex 内置图片生成", backend: "Codex 账户所提供的生成服务", billing: "当前 Codex 登录账户额度或 API 计费；连接本机不代表免费", capabilities: { "text-to-image": evidence.authenticated ? evidence.imageTool : "unavailable", "image-edit": !evidence.authenticated || evidence.imageEditing === false ? "unavailable" : evidence.imageTool, "text-to-video": "unavailable", "image-to-video": "unavailable" }, query: true, cancel: false, reason: evidence.reason }; }
    async submit(request: MediaRequest) {
        const capabilities = await this.capabilities(); const available = capabilities.capabilities[request.capability];
        if (request.agentId !== "codex" || available === "unavailable" || !available || (available === "unverified" && !request.allowUnverified)) throw new Error("本机 Codex 尚未核实该生成能力；请明确验证任务和额度范围，不能自动改用 API");
        if (request.parameters && Object.keys(request.parameters).length) throw new Error("Codex 未声明尺寸、质量或数量参数接口，请移除 API 专用参数");
        if (request.capability === "image-edit" && !request.references?.length) throw new Error("图片编辑需要明确授权的参考原图");
        const task = await this.registry.create(request, typeof this.root === "string" ? this.root : await this.root(request));
        // Durable request identity prevents refreshing/recovering a request from starting another turn.
        if (!await this.registry.claimSubmission(task.id)) return this.registry.get(task.id, request.projectId);
        void this.start(task, (threadId, turnId) => this.registry.bind(task.id, { threadId, turnId })).catch(async (error) => { const current = await this.registry.get(task.id, task.request.projectId); if (current.status !== "completed") await this.registry.mark(task.id, "unknown", String(error instanceof Error ? error.message : error)); });
        return this.registry.get(task.id, request.projectId);
    }
    query(taskId: string, projectId: string) { return this.registry.get(taskId, projectId); }
}
