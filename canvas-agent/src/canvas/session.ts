import crypto from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import type { ServerResponse } from "node:http";

import type { AgentAttachment } from "../agent/types.js";
import { LEGACY_MCP_SERVER_NAME, MCP_SERVER_NAME } from "../names.js";
import { logger } from "../utils/logger.js";
import { buildCanvasToolRequest, fitAttachmentNodeSize } from "./operations.js";
import type { ToolName } from "./schemas.js";
import { compactCanvasState, compactNode, isToolName, nextCanvasX, parseToolInput, readableNode } from "./tools.js";
import type { CanvasSnapshot, CanvasTarget } from "./types.js";

export type ToolRequestStatus = "awaiting" | "claimed" | "executing" | "succeeded" | "failed" | "cancelled" | "expired" | "unknown";
type PendingRequest = { clientId: string; target?: CanvasTarget; status: ToolRequestStatus; name: ToolName; input?: Record<string,unknown>; result?: unknown; error?: string; resolve: (value: unknown) => void; reject: (error: Error) => void };
type TurnAttachment = { clientId: string; id: string; name: string; type: string; size: number; width: number; height: number; dataUrl: string };
type ReplayEvent = { type: string; payload: Record<string, unknown> };
export type CodexState = { busy: boolean; threadId: string; turnId: string };
export type McpStartupState = "starting" | "ready" | "failed" | "cancelled";
export type ConversationState = {
    revision: number;
    conversationId: string;
    threadId: string;
    status: "idle" | "preparing" | "ready" | "warning" | "running" | "failed";
    mcpStatuses: Record<string, { status: McpStartupState; error?: string | null; failureReason?: string | null }>;
    sourceClientId?: string;
    error?: string;
};
type McpInventoryItem = { name: string; authStatus?: string };
export const AGENT_PROTOCOL_VERSION = 7;

const SITE_TOOLS = new Set<ToolName>([
    "site_navigate",
    "canvas_list_projects",
    "workbench_image_get_config",
    "workbench_image_generate",
    "workbench_video_get_config",
    "workbench_video_generate",
    "prompts_search",
    "assets_list",
    "assets_add",
    "generation_get_status",
]);

/** 管理网页画布连接、状态、附件和工具请求。 */
export class CanvasSession {
    private clients = new Map<string, ServerResponse>();
    private clientFocusOrder = new Map<string, number>();
    private pending = new Map<string, PendingRequest>();
    private completedRequests = new Map<string, { clientId: string; status: ToolRequestStatus; target?: CanvasTarget; result?: unknown; error?: string }>();
    private boundProjectId = "";
    private pendingApprovals = new Map<string, Record<string, unknown>>();
    private canvasStates = new Map<string, CanvasSnapshot>();
    private turnAttachments = new Map<string, TurnAttachment>();
    private codexReplayEvents = new Map<string, ReplayEvent>();
    private codexReplayActiveItems = new Set<string>();
    private codexMutationBusy = false;
    private activeClientId = "";
    private boundClientId = "";
    private focusSequence = 0;
    private codexState: CodexState = { busy: false, threadId: "", turnId: "" };
    private conversationState: ConversationState;
    private conversationInventoryComplete = false;
    private preparedConversationThreadId = "";

    constructor(activeThreadId = "") {
        this.conversationState = {
            revision: 1,
            conversationId: activeThreadId || crypto.randomUUID(),
            threadId: activeThreadId,
            status: activeThreadId ? "ready" : "idle",
            mcpStatuses: {},
        };
    }

    /** 获取当前目标网页的画布状态。 */
    private get canvasState() {
        return this.clients.has(this.targetClientId) ? this.canvasStates.get(this.targetClientId) || null : null;
    }

    /** 获取当前 turn 绑定或最近激活的网页客户端。 */
    private get targetClientId() {
        return this.boundClientId || this.activeClientId;
    }

    /** 返回 Canvas Agent 当前连接状态。 */
    health() {
        return { ok: true, protocolVersion: AGENT_PROTOCOL_VERSION, hasCanvas: Boolean(this.canvasState), clients: this.clients.size, codexBusy: this.codexState.busy, conversation: this.conversationStateSnapshot };
    }

    /** 返回 Codex 是否正在执行任务。 */
    get codexBusy() {
        return this.codexState.busy;
    }

    get codexThreadId() {
        return this.codexState.threadId;
    }

    /** Return a copy that callers can restore after a temporary Codex operation. */
    get codexStateSnapshot(): CodexState {
        return { ...this.codexState };
    }

    /** 返回站点级对话的权威快照。 */
    get conversationStateSnapshot(): ConversationState {
        return { ...this.conversationState, mcpStatuses: { ...this.conversationState.mcpStatuses } };
    }

    /** 原子开始一次新建或恢复对话流程。 */
    beginConversation(options: { threadId?: string; conversationId?: string; sourceClientId?: string } = {}) {
        this.conversationInventoryComplete = false;
        this.preparedConversationThreadId = "";
        return this.updateConversation({
            conversationId: options.conversationId || options.threadId || crypto.randomUUID(),
            threadId: options.threadId || "",
            status: "preparing",
            mcpStatuses: {},
            sourceClientId: options.sourceClientId,
            error: undefined,
        });
    }

    /** 记录预热阶段单个 MCP 服务的启动状态。 */
    updateConversationMcp(name: string, status: McpStartupState, error?: string | null, failureReason?: string | null) {
        if (!name || this.conversationState.status !== "preparing") return this.conversationStateSnapshot;
        const snapshot = this.updateConversation({
            mcpStatuses: { ...this.conversationState.mcpStatuses, [name]: { status, error, failureReason } },
        });
        return this.conversationInventoryComplete && this.preparedConversationThreadId
            ? this.completeConversationPreparation(this.preparedConversationThreadId)
            : snapshot;
    }

    /** 用 app-server 的完整 MCP 清单补齐未发送逐项通知的服务。 */
    completeConversationMcpInventory(services: McpInventoryItem[]) {
        if (this.conversationState.status !== "preparing") return this.conversationStateSnapshot;
        const mcpStatuses = { ...this.conversationState.mcpStatuses };
        services.filter((item) => item.name).forEach((item) => {
            const current = mcpStatuses[item.name];
            if (current?.status === "failed" || current?.status === "cancelled") return;
            mcpStatuses[item.name] = item.authStatus === "notLoggedIn"
                ? { status: "failed", error: "MCP 服务未登录", failureReason: "reauthenticationRequired" }
                : { status: "ready" };
        });
        this.conversationInventoryComplete = true;
        return this.updateConversation({ mcpStatuses });
    }

    /** MCP 清单读取结束后提交线程和最终可发送状态。 */
    completeConversationPreparation(threadId: string) {
        this.preparedConversationThreadId = threadId;
        const statuses = this.conversationState.mcpStatuses;
        const hasPending = !this.conversationInventoryComplete || Object.values(statuses).some((item) => item.status === "starting");
        const required = statuses[MCP_SERVER_NAME] || statuses[LEGACY_MCP_SERVER_NAME];
        const requiredFailure = required?.status !== "ready";
        const hasFailure = Object.values(statuses).some((item) => item.status === "failed" || item.status === "cancelled");
        const requiredFailureDetail = required?.error;
        return this.updateConversation({
            threadId,
            status: hasPending ? "preparing" : requiredFailure ? "failed" : hasFailure ? "warning" : "ready",
            error: requiredFailure ? `画布 MCP 初始化失败${requiredFailureDetail ? `：${requiredFailureDetail}` : ""}` : undefined,
        });
    }

    /** 将创建线程或读取 MCP 清单的失败保存为不可发送状态。 */
    failConversationPreparation(error: string) {
        this.conversationInventoryComplete = false;
        this.preparedConversationThreadId = "";
        return this.updateConversation({ status: "failed", error });
    }

    /** 切换到无需重新预热的既有状态，例如删除当前对话后的空状态。 */
    activateConversation(threadId: string, sourceClientId?: string) {
        this.conversationInventoryComplete = false;
        this.preparedConversationThreadId = "";
        return this.updateConversation({
            conversationId: threadId || crypto.randomUUID(),
            threadId,
            status: threadId ? "ready" : "idle",
            mcpStatuses: {},
            sourceClientId,
            error: undefined,
        });
    }

    markConversationRunning(threadId: string) {
        if (!threadId || threadId !== this.conversationState.threadId || !["ready", "warning"].includes(this.conversationState.status)) return this.conversationStateSnapshot;
        return this.updateConversation({ status: "running" });
    }

    finishConversationRun(threadId: string) {
        if (!threadId || threadId !== this.conversationState.threadId) return this.conversationStateSnapshot;
        const hasFailure = Object.values(this.conversationState.mcpStatuses).some((item) => item.status === "failed" || item.status === "cancelled");
        return this.updateConversation({ status: hasFailure ? "warning" : "ready" });
    }

    /** 判断网页客户端是否仍连接到当前 Agent。 */
    hasClient(clientId: string) {
        return this.clients.has(clientId);
    }

    /** 读取指定网页上报的画布，避免提炼时受最近焦点或其他标签页影响。 */
    canvasStateForClient(clientId: string) {
        return this.clients.has(clientId) ? this.canvasStates.get(clientId) || null : null;
    }

    /** 原子取得 Codex 写操作权限，避免多个网页并发切换或修改会话。 */
    beginCodexMutation() {
        if (this.codexState.busy || this.codexMutationBusy) return false;
        this.codexMutationBusy = true;
        return true;
    }

    /** 释放 Codex 写操作权限。 */
    endCodexMutation() {
        this.codexMutationBusy = false;
    }

    /** 返回当前 Codex turn 的线程、turn 和发起网页。 */
    get codexEventScope() {
        return {
            threadId: this.codexState.threadId,
            turnId: this.codexState.busy ? this.codexState.turnId : "",
            sourceClientId: this.codexState.busy ? this.boundClientId : "",
        };
    }

    /** 返回刷新后仍需展示的 Codex 权限请求。 */
    get codexPendingApprovals() {
        return [...this.pendingApprovals.values()];
    }

    /** 跟踪需要跨页面重连恢复的 Codex 权限请求。 */
    trackCodexEvent(type: string, payload: Record<string, unknown>) {
        const requestId = String(payload.requestId || "");
        if (type === "codex_approval" && requestId) this.pendingApprovals.set(requestId, payload);
        if (type === "codex_approval_resolved" && requestId) this.pendingApprovals.delete(requestId);
        if (type === "agent_error") this.pendingApprovals.clear();
    }

    /** 更新并广播 Codex 运行状态；静默后台活动可保留上一 turn 的断线重放。 */
    setCodexState(patch: Partial<CodexState>, options: { preserveReplay?: boolean } = {}) {
        const next = { ...this.codexState, ...patch };
        const threadChanged = next.threadId !== this.codexState.threadId;
        const turnChanged = Boolean(this.codexState.turnId && next.turnId && next.turnId !== this.codexState.turnId);
        const nextTurnStarted = !this.codexState.busy && next.busy;
        if (!options.preserveReplay && (threadChanged || turnChanged || nextTurnStarted)) {
            this.codexReplayEvents.clear();
            this.codexReplayActiveItems.clear();
        }
        if (!next.busy) {
            if (this.boundClientId && !this.clients.has(this.boundClientId)) this.boundClientId = "";
        }
        if (next.busy === this.codexState.busy && next.threadId === this.codexState.threadId && next.turnId === this.codexState.turnId) return;
        this.codexState = next;
        logger.debug("Codex state changed", this.codexState);
        this.emitAll("codex_state", this.codexState);
    }

    /** 权威历史已覆盖指定 turn 后，清理其断线重放事件。 */
    acknowledgeCodexHistory(threadId: string, turnIds: string[]) {
        const acknowledged = new Set(turnIds.filter(Boolean));
        if (!threadId || !acknowledged.size) return;
        this.codexReplayEvents.forEach((event, key) => {
            const eventThreadId = String(event.payload.threadId || event.payload.thread_id || "");
            const eventTurnId = String(event.payload.turnId || event.payload.turn_id || "");
            if (eventThreadId === threadId && acknowledged.has(eventTurnId)) {
                this.codexReplayEvents.delete(key);
                this.codexReplayActiveItems.delete(key);
            }
        });
    }

    /** 建立网页与 Canvas Agent 之间的 SSE 连接。 */
    openEvents(url: URL, res: ServerResponse, activeThreadId = "") {
        const clientId = url.searchParams.get("clientId") || crypto.randomUUID();
        const statusOnly = url.searchParams.get("role") === "status";
        logger.info("SSE client connected", { clientId, statusOnly });
        res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
        if (!statusOnly) {
            this.clients.set(clientId, res);
            if (!this.clientFocusOrder.has(clientId)) this.clientFocusOrder.set(clientId, 0);
            if (!this.activeClientId) {
                this.activeClientId = clientId;
                this.clientFocusOrder.set(clientId, ++this.focusSequence);
            }
        }
        sendEvent(res, "hello", { ok: true, protocolVersion: AGENT_PROTOCOL_VERSION, clientId, workspace: { activeThreadId }, conversation: this.conversationStateSnapshot, codex: this.codexState, pendingApprovals: this.codexPendingApprovals });
        if (!statusOnly && activeThreadId && this.codexState.threadId === activeThreadId) this.codexReplayEvents.forEach((event) => sendEvent(res, event.type, event.payload));
        const timer = setInterval(() => sendEvent(res, "ping", { time: Date.now() }), 15000);
        res.on("close", () => {
            clearInterval(timer);
            logger.info("SSE client disconnected", { clientId, statusOnly });
            if (statusOnly || this.clients.get(clientId) !== res) return;
            this.clients.delete(clientId);
            this.clientFocusOrder.delete(clientId);
            this.canvasStates.delete(clientId);
            this.cancelRequests(clientId, "请求页面已断开");
            if (this.activeClientId === clientId) this.activeClientId = [...this.clients.keys()].sort((a, b) => (this.clientFocusOrder.get(b) || 0) - (this.clientFocusOrder.get(a) || 0))[0] || "";
        });
    }

    private updateConversation(patch: Partial<Omit<ConversationState, "revision">>) {
        this.conversationState = { ...this.conversationState, ...patch, revision: this.conversationState.revision + 1 };
        const snapshot = this.conversationStateSnapshot;
        this.emitAll("conversation_changed", snapshot);
        return snapshot;
    }

    /** 保存指定网页上报的最新画布快照。 */
    updateState(body: unknown, clientId?: string) {
        const targetClientId = clientId || this.activeClientId;
        if (!targetClientId || !this.clients.has(targetClientId)) return;
        const state = { ...((body && typeof body === "object" && !Array.isArray(body) ? body : {}) as Record<string, unknown>), clientId: targetClientId } as CanvasSnapshot;
        this.canvasStates.set(targetClientId, state);
        this.pending.forEach((item, id) => {
            if (item.clientId === targetClientId && item.target && item.status !== "executing" && (state.projectId !== item.target.projectId || state.revision !== item.target.revision)) this.finishRequest(id, "cancelled", undefined, "画布项目或修订已变化，请重新读取并审阅操作");
        });
        logger.debug("Canvas state updated", { clientId: targetClientId, nodes: state.nodes?.length || 0, connections: state.connections?.length || 0 });
    }

    /** 将指定网页设为最近激活的工具目标。 */
    activateClient(clientId: string) {
        if (!this.clients.has(clientId)) throw new Error("当前网页未连接");
        this.activeClientId = clientId;
        this.clientFocusOrder.set(clientId, ++this.focusSequence);
        logger.debug("Canvas client activated", { clientId });
    }

    /** 将当前 Agent turn 固定绑定到指定网页。 */
    bindClient(clientId: string) {
        if (!this.clients.has(clientId)) throw new Error("当前网页未连接");
        this.boundClientId = clientId;
        this.boundProjectId = this.canvasStates.get(clientId)?.projectId || "";
        logger.debug("Canvas client bound to turn", { clientId });
    }

    /** 解除当前 Agent turn 的网页绑定。 */
    releaseClient(clientId: string) {
        if (this.boundClientId === clientId) {
            this.cancelRequests(clientId, "当前任务已结束或停止");
            this.boundClientId = "";
            this.boundProjectId = "";
        }
        logger.debug("Canvas client released from turn", { clientId });
    }

    /** 保存当前 turn 可用的图片附件并返回安全引用。 */
    setTurnAttachments(clientId: string, attachments: AgentAttachment[]) {
        this.turnAttachments.clear();
        return attachments.flatMap((item, index) => {
            if (!item.dataUrl?.startsWith("data:image/")) return [];
            const id = item.id?.trim() || `attachment-${crypto.randomUUID()}`;
            const attachment: TurnAttachment = {
                clientId,
                id,
                name: item.name?.trim() || `图片 ${index + 1}`,
                type: item.type?.startsWith("image/") ? item.type : item.dataUrl.match(/^data:([^;]+)/)?.[1] || "image/png",
                size: positiveNumber(item.size, 0),
                width: positiveNumber(item.width, 1024),
                height: positiveNumber(item.height, 1024),
                dataUrl: item.dataUrl,
            };
            this.turnAttachments.set(id, attachment);
            return [{ id, name: attachment.name, type: attachment.type, size: attachment.size, width: attachment.width, height: attachment.height }];
        });
    }

    /** 清理指定网页或全部 turn 附件。 */
    clearTurnAttachments(clientId?: string) {
        this.turnAttachments.forEach((item, id) => {
            if (!clientId || item.clientId === clientId) this.turnAttachments.delete(id);
        });
    }

    /** 获取属于指定网页 turn 的图片附件。 */
    getTurnAttachment(clientId: string, attachmentId: string) {
        const attachment = this.turnAttachments.get(attachmentId);
        if (!attachment) throw new Error(`找不到本轮图片附件：${attachmentId}`);
        if (attachment.clientId !== clientId) throw new Error("图片附件不属于当前 turn 的发起标签页");
        return attachment;
    }

    /** 查询终态，响应丢失时只查回执，不重放变更。 */
    requestStatus(clientId: string, requestId: string) {
        const item = this.pending.get(requestId) || this.completedRequests.get(requestId);
        if (!item || item.clientId !== clientId) throw new Error("找不到属于当前页面的请求");
        return { requestId, status: item.status, target: item.target, result: item.result, error: item.error };
    }

    /** 批准只领取一次；真正执行前还需 validateRequest。 */
    claimRequest(clientId: string, requestId: string) {
        const item = this.pending.get(requestId);
        if (!item || item.clientId !== clientId || item.status !== "awaiting") throw new Error("请求已领取、过期或取消，请查询原回执");
        if (item.target) this.assertTarget(item.target, item.name === "site_navigate");
        item.status = "claimed";
        return this.requestStatus(clientId, requestId);
    }

    validateRequest(clientId: string, requestId: string) {
        const item = this.pending.get(requestId);
        if (!item || item.clientId !== clientId || item.status !== "claimed") throw new Error("请求不可执行，请查询原回执");
        if (item.target) this.assertTarget(item.target, item.name === "site_navigate");
        item.status = "executing";
        return this.requestStatus(clientId, requestId);
    }

    assertExecutingRequest(clientId: string, requestId: string, name: ToolName, input: Record<string,unknown>) {
        const item=this.pending.get(requestId);
        if(!item || item.clientId!==clientId || item.status!=="executing" || item.name!==name || !isDeepStrictEqual(item.input,input) || !item.target)throw new Error("文件授权请求未执行、归属错误或输入发生变化");
        this.assertTarget(item.target);
        return {target:structuredClone(item.target),input:structuredClone(item.input)};
    }
    cancelRequests(clientId?: string, reason = "请求已取消") {
        this.pending.forEach((item, id) => {
            if (!clientId || item.clientId === clientId) this.finishRequest(id, item.status === "executing" ? "unknown" : "cancelled", undefined, reason);
        });
    }

    private finishRequest(requestId: string, status: ToolRequestStatus, result?: unknown, error?: string) {
        const item = this.pending.get(requestId);
        if (!item) return;
        this.pending.delete(requestId);
        this.completedRequests.set(requestId, { clientId: item.clientId, target: item.target, status, result, error });
        const client = this.clients.get(item.clientId);
        if (client) sendEvent(client, "tool_resolved", { requestId, status, result, error });
        error ? item.reject(new Error(error)) : item.resolve(result);
    }

    /** 只接受已领取并执行的回执；同步接收权威快照后下一次读取可观察结果。 */
    resolveResult(clientId: string, body: { requestId?: string; error?: string; result?: unknown; state?: CanvasSnapshot }) {
        const item = body.requestId ? this.pending.get(body.requestId) : null;
        if (!item || !body.requestId || item.clientId !== clientId) {
            const completed = body.requestId ? this.completedRequests.get(body.requestId) : null;
            if (!completed || !body.requestId || completed.clientId !== clientId || completed.status !== "unknown") return false;
            if (completed.target && body.state?.projectId !== completed.target.projectId) return false;
            const status = body.error ? "failed" : "succeeded";
            // A late original receipt settles uncertainty but cannot replace a newer snapshot.
            this.completedRequests.set(body.requestId, { ...completed, status, result: body.result, error: body.error });
            const client = this.clients.get(clientId);
            if (client) sendEvent(client, "tool_resolved", { requestId: body.requestId, status, result: body.result, error: body.error });
            return true;
        }
        if (body.error && (item.status === "awaiting" || item.status === "claimed")) {
            this.finishRequest(body.requestId, "cancelled", undefined, body.error);
            return true;
        }
        if (item.status !== "executing") return false;
        if (body.state) {
            if (item.target && item.name !== "site_navigate" && body.state.projectId !== item.target.projectId) return false;
            this.updateState(body.state, clientId);
            if (item.name === "site_navigate" && !body.error && this.boundClientId === clientId) this.boundProjectId = body.state.projectId || "";
        }
        this.finishRequest(body.requestId, body.error ? "failed" : "succeeded", body.result, body.error);
        return true;
    }

    targetForClient(clientId: string): CanvasTarget {
        const state = this.canvasStateForClient(clientId);
        if (!state?.projectId || !state.revision) throw new Error("当前没有已连接画布或有效修订");
        return { clientId, projectId: state.projectId, revision: state.revision };
    }

    get boundTaskTarget() {
        return this.boundClientId && this.boundProjectId ? { clientId: this.boundClientId, projectId: this.boundProjectId } : null;
    }

    assertTarget(target: CanvasTarget, navigation = false) {
        const state = this.canvasStateForClient(target.clientId);
        if (!state || state.projectId !== target.projectId || state.revision !== target.revision) throw new Error("画布项目或修订已变化，请重新读取并审阅操作");
        if (!navigation && this.boundClientId && (target.clientId !== this.boundClientId || (this.boundProjectId && target.projectId !== this.boundProjectId))) throw new Error("目标不属于当前任务绑定的画布项目");
    }

    /** 向全部已连接网页广播事件。 */
    emitAll(type: string, payload: unknown) {
        this.clients.forEach((client) => sendEvent(client, type, payload));
    }

    /** 向全部网页广播带线程归属的事件。 */
    emitThread(type: string, threadId: string, payload: Record<string, unknown> = {}) {
        const data: Record<string, unknown> = { ...payload, threadId };
        const replayKey = codexReplayKey(type, data);
        const eventTurnId = String(data.turnId || data.turn_id || "");
        const currentScope = threadId === this.codexState.threadId && (!this.codexState.turnId || !eventTurnId || eventTurnId === this.codexState.turnId);
        if (this.codexState.busy && currentScope && replayKey) {
            const item = recordValue(data.item);
            const eventType = String(data.type || "");
            if (type === "agent_event" && item.id && (eventType === "item.started" || eventType === "item.updated")) this.codexReplayActiveItems.add(replayKey);
            if (type === "agent_event" && item.id && eventType === "item.completed") this.codexReplayActiveItems.delete(replayKey);
            if (type === "agent_event" && (eventType === "turn.completed" || eventType === "error")) this.clearReplayActiveTurn(threadId, eventTurnId);
            const replayData = this.replaySnapshot(replayKey, data);
            this.codexReplayEvents.set(replayKey, { type, payload: { ...replayData, replayed: true } });
            while (this.codexReplayEvents.size > 240) {
                const evictable = [...this.codexReplayEvents.keys()].find((key) => !this.codexReplayActiveItems.has(key));
                if (!evictable) break;
                this.codexReplayEvents.delete(evictable);
            }
        }
        this.emitAll(type, data);
    }

    /** 为断线重连保存完整的最新文本快照，实时连接仍只接收增量。 */
    private replaySnapshot(replayKey: string, data: Record<string, unknown>) {
        if (data.type !== "item.updated" && data.type !== "item.completed") return data;
        const item = recordValue(data.item);
        if (!item.id) return data;
        const previous = recordValue(recordValue(this.codexReplayEvents.get(replayKey)?.payload).item);
        const delta = String(item.delta || "");
        if (!delta) return data;
        const previousText = String(previous.text || "");
        const { delta: _delta, ...snapshotItem } = item;
        return { ...data, item: { ...previous, ...snapshotItem, text: `${previousText}${delta}` } };
    }

    private clearReplayActiveTurn(threadId: string, turnId: string) {
        const prefix = `item:${turnId}:`;
        this.codexReplayActiveItems.forEach((key) => {
            if (key.startsWith(prefix)) this.codexReplayActiveItems.delete(key);
        });
        if (!turnId) return;
        this.codexReplayActiveItems.forEach((key) => {
            const event = this.codexReplayEvents.get(key);
            const eventThreadId = String(event?.payload.threadId || event?.payload.thread_id || "");
            const eventTurnId = String(event?.payload.turnId || event?.payload.turn_id || "");
            if (eventThreadId === threadId && eventTurnId === turnId) this.codexReplayActiveItems.delete(key);
        });
    }

    /** 校验工具参数并将调用分派到当前目标网页。 */
    async callTool(name: unknown, rawInput: unknown) {
        if (!isToolName(name)) throw new Error(`未知工具：${String(name)}`);
        logger.info("MCP tool called", { name, input: rawInput, targetClientId: this.targetClientId });
        const input = parseToolInput(name, rawInput) as Record<string, unknown>;
        if (name === "canvas_get_request_status") return this.requestStatus(String(input.clientId), String(input.requestId));
        const boundState = this.boundClientId ? this.canvasStateForClient(this.boundClientId) : null;
        const target = (input.target as CanvasTarget | undefined) || (this.boundClientId && this.boundProjectId && boundState?.projectId && boundState.revision ? this.targetForClient(this.boundClientId) : undefined);
        const clientId = target?.clientId || this.targetClientId;
        const state = this.canvasStateForClient(clientId);
        const readTool = ["canvas_get_state", "canvas_get_selection", "canvas_export_snapshot", "canvas_get_node_content", "canvas_get_capabilities"].includes(name);
        if (target) this.assertTarget(target, name === "site_navigate");
        if (this.boundClientId && !SITE_TOOLS.has(name) && (!state || (this.boundProjectId && state.projectId !== this.boundProjectId))) throw new Error("当前任务绑定的画布项目已切换，请显式导航并重新读取");
        if (SITE_TOOLS.has(name)) {
            if (!this.clients.has(clientId)) throw new Error("当前没有已连接网页");
            return await this.requestCanvasTool(name, input, clientId, target);
        }
        if (!state || !this.clients.has(clientId)) throw new Error("当前没有已连接画布");
        if (name === "canvas_get_state") return compactCanvasState(state);
        if (name === "canvas_export_snapshot") return { ...state, nodes: (state.nodes || []).map(readableNode), contentScope: "full-text-no-media", target: { clientId, projectId: state.projectId, revision: state.revision } };
        if (name === "canvas_get_selection") {
            const ids = new Set(state.selectedNodeIds || []);
            return { target: { clientId, projectId: state.projectId, revision: state.revision }, contentScope: "summary", nodes: (state.nodes || []).filter((node) => ids.has(node.id)).map(compactNode) };
        }
        if (name === "canvas_get_capabilities") return await this.requestCanvasTool(name, input, clientId, target || this.targetForClient(clientId));
        if (name === "canvas_get_node_content") {
            const node = state.nodes?.find((node) => node.id === input.nodeId);
            if (!node) throw new Error("找不到指定节点");
            if (input.includeMedia) {
                if (node.type !== "image") throw new Error("仅支持经授权读取图片原文件；视频/音频完整内容读取未实现");
                return await this.requestCanvasTool(name, input, clientId, target || { clientId, projectId: state.projectId!, revision: state.revision! });
            }
            return { target: { clientId, projectId: state.projectId, revision: state.revision }, contentScope: "full-text-no-media", node: readableNode(node) };
        }
        if (!readTool && !target) throw new Error("画布写入必须携带读取返回的 target（clientId/projectId/revision）");
        if (name === "canvas_preview_workflow") return await this.requestCanvasTool(name, input, clientId, target!);
        if (name === "media_register_artifact") return await this.requestCanvasTool(name,input,clientId,target!);
        if (name === "canvas_create_attachment_nodes") return await this.createAttachmentNodes(input as { attachmentIds: string[]; x?: number; y?: number; gap?: number; direction?: "row" | "column" }, target!);
        const request = buildCanvasToolRequest(name, input, state);
        return await this.requestCanvasTool(request.name, request.input, clientId, target);
    }

    /** 将当前 turn 的附件转换为画布图片节点。 */
    private async createAttachmentNodes(input: { attachmentIds: string[]; x?: number; y?: number; gap?: number; direction?: "row" | "column" }, target: CanvasTarget) {
        const clientId = target.clientId;
        if (!this.clients.has(clientId)) throw new Error("当前没有已连接画布");
        const attachments = input.attachmentIds.map((id) => this.getTurnAttachment(clientId, id));
        const x = Number(input.x ?? nextCanvasX(this.canvasStateForClient(clientId)));
        const y = Number(input.y ?? 0);
        const gap = Number(input.gap ?? 40);
        const direction = input.direction || "row";
        let offset = 0;
        const nodes = attachments.map((attachment) => {
            const size = fitAttachmentNodeSize(attachment.width, attachment.height);
            const node = {
                id: `image-${crypto.randomUUID()}`,
                attachmentId: attachment.id,
                title: attachment.name,
                position: { x: direction === "row" ? x + offset : x, y: direction === "column" ? y + offset : y },
                width: size.width,
                height: size.height,
            };
            offset += (direction === "row" ? size.width : size.height) + gap;
            return node;
        });
        const receipt = await this.requestCanvasTool("canvas_create_attachment_nodes", { nodes }, clientId, target);
        return { ...recordValue(receipt), nodes: nodes.map(({ id, attachmentId, title }) => ({ id, attachmentId, title })) };
    }

    /** 向目标网页发送工具请求并等待调用结果。 */
    private async requestCanvasTool(name: ToolName, input: Record<string, unknown>, clientId = this.targetClientId, target?: CanvasTarget) {
        const requestId = crypto.randomUUID();
        const client = this.clients.get(clientId);
        if (!client) throw new Error("当前没有已连接画布");
        return await new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                const item = this.pending.get(requestId);
                if (item) this.finishRequest(requestId, item.status === "executing" ? "unknown" : "expired", undefined, `画布操作超时；requestId=${requestId}，clientId=${clientId}；请用 canvas_get_request_status 查询，不要重复提交`);
            }, 30000);
            this.pending.set(requestId, { clientId, target, name, input:structuredClone(input), status: "awaiting", resolve: (value) => (clearTimeout(timer), resolve(value)), reject: (error) => (clearTimeout(timer), reject(error)) });
            sendEvent(client, "tool_call", { requestId, name, input, target });
        });
    }
}

/** 为运行中 turn 的可重放事件生成稳定键。 */
function codexReplayKey(type: string, payload: Record<string, unknown>) {
    const turnId = String(payload.turnId || payload.turn_id || "");
    if (type === "chat_message") {
        const message = recordValue(payload.message);
        const clientMessageId = String(message.clientMessageId || "");
        if (clientMessageId) return `chat:${clientMessageId}`;
        const messageId = String(message.itemId || message.id || "");
        return messageId ? `chat:${turnId}:${messageId}` : "";
    }
    if (type === "agent_error") return `error:${turnId}`;
    if (type !== "agent_event") return "";
    const item = recordValue(payload.item);
    if (item.id) return `item:${turnId}:${String(item.id)}`;
    const eventType = String(payload.type || "");
    if (eventType === "plan.updated") return `plan:${turnId}`;
    if (eventType === "usage.updated") return `usage:${turnId}`;
    if (eventType === "turn.completed" || eventType === "error") return `${eventType}:${turnId}`;
    return "";
}

function recordValue(value: unknown) {
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

/** 向 SSE 连接写入一个事件。 */
function sendEvent(res: ServerResponse, type: string, payload: unknown) {
    res.write(`event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`);
}
/** 将未知数值转换为正数，否则使用默认值。 */
function positiveNumber(value: unknown, fallback: number) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : fallback;
}
