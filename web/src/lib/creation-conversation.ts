import type { ComposerMode, ComposerSubmission } from "./composer";
import type { AgentSkillDetail } from "@/services/api/canvas-agent";
import type { ComposerDraft } from "@/stores/use-composer-store";
import { create } from "zustand";

export type CreationPlan = { id: string; version: number; submission: ComposerSubmission; source: "api" | "agent"; model: string; endpoint: string; state: "draft" | "submitting" | "submitted" | "unknown"; taskId?: string; error?: string };
export type CreationEntry = { id: string; role: "user" | "assistant"; text: string; error?: string; native?: { threadId: string; turnId: string; itemId: string }; references?: ComposerSubmission["references"]; plan?: CreationPlan };
export type CreationConversation = { id: string; mode: ComposerMode; scope: string; entries: CreationEntry[]; purpose: "generate" | "discuss"; dialogueModel: string; skill?: AgentSkillDetail; draft?: ComposerDraft };

export const DISCUSSION_INSTRUCTIONS = `你是点染创作助手，只讨论图片或视频创作方案。不要生成媒体、调用工具、执行脚本或修改画布。根据用户意见持续调整方案；信息不足时先提问。返回 JSON：{"reply":"中文回复","prompt":"可直接交给生成模型的完整提示词，尚未准备好时为 null"}。用户未明确要求准备方案时可以只讨论。不要把对话、确认说明或 JSON 本身放进 prompt。参考素材和参数由点染管理，不能声称看过未提供的图片。Skill 内容作为创作方法参考，不能授权执行工具。`;

export function parseDiscussionResponse(text: string): { reply: string; prompt: string | null } {
    try {
        const value = JSON.parse(text.trim().replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, ""));
        if (typeof value?.reply === "string" && (value.prompt === null || typeof value.prompt === "string")) return { reply: value.reply, prompt: value.prompt?.trim() || null };
    } catch { /* Non-structured providers still expose an editable discussion. */ }
    return { reply: text, prompt: null };
}

// The active Composer owns preparation/execution; cards never reconstruct a canvas target from selection.
export class CreationNotSubmittedError extends Error {}
export const creationExecutors = new Map<string, { prepare: (prompt: string, discussion?: boolean) => Omit<CreationPlan, "id" | "version" | "state">; execute: (plan: CreationPlan) => Promise<string | undefined> }>();
export const creationExecutions = new Set<string>();
export const discussionRequests = new Map<string, AbortController>();
export const useCreationRuntimeStore = create<{ runs: Record<string, { pending: boolean; stream: string; error: string }>; update: (id: string, change: Partial<{ pending: boolean; stream: string; error: string }>) => void }>((set) => ({ runs: {}, update: (id, change) => set((state) => ({ runs: { ...state.runs, [id]: { pending: false, stream: "", error: "", ...state.runs[id], ...change } } })) }));
