import { useEffect } from "react";
import { App } from "antd";
import { nanoid } from "nanoid";
import { flushComposerSave, useComposerStore } from "@/stores/use-composer-store";
import { creationExecutors, discussionRequests, DISCUSSION_INSTRUCTIONS, useCreationRuntimeStore, type CreationEntry, type CreationPlan } from "@/lib/creation-conversation";
import { requestCreationDiscussion } from "@/services/api/creation-discussion";
import type { AiTextMessage } from "@/services/api/image";
import { imageToDataUrl } from "@/services/image-storage";
import { showErrorToast } from "@/features/errors/error-toast";
import type { ComposerMode } from "@/lib/composer";
import type { CanvasSubmission } from "@/lib/canvas/canvas-composer";

export function useCreationDiscussion(scope: string, mode: ComposerMode) {
    const { message } = App.useApp();
    const hydrated = useComposerStore((state) => state.hydrated);
    const id = useComposerStore((state) => state.activeConversations[scope]);
    const conversation = useComposerStore((state) => state.conversations[id]);
    const runtime = useCreationRuntimeStore((state) => state.runs[id]);
    const { pending = false, stream = "", error = "" } = runtime || {};
    const setRuntime = (change: Parameters<ReturnType<typeof useCreationRuntimeStore.getState>["update"]>[1]) => useCreationRuntimeStore.getState().update(id, change);
    useEffect(() => { if (hydrated) useComposerStore.getState().ensureConversation(scope, mode); }, [hydrated, scope, mode]);
    const update = (change: Parameters<ReturnType<typeof useComposerStore.getState>["updateConversation"]>[1]) => {
        if (id) useComposerStore.getState().updateConversation(id, change);
    };
    const preparePlan = (prompt: string, frozen?: Omit<CreationPlan, "id" | "version" | "state">) => {
        const state = useComposerStore.getState();
        const current = state.conversations[id];
        const executor = creationExecutors.get(scope);
        if (!current || (!frozen && !executor) || discussionRequests.has(id)) return;
        const versions = current.entries.flatMap((entry) => entry.plan ? [entry.plan.version] : []);
        const prepared = frozen || executor!.prepare(prompt, true);
        const submission = { ...prepared.submission, prompt, composerContent: prompt } as CanvasSubmission;
        if (submission.input) submission.input = { ...submission.input, prompt };
        const plan: CreationPlan = { ...prepared, submission, id: nanoid(), version: Math.max(0, ...versions) + 1, state: "draft" };
        state.updateConversation(id, { entries: [...current.entries, { id: nanoid(), role: "assistant", text: "", plan }] });
    };
    const send = async () => {
        const state = useComposerStore.getState();
        const current = state.conversations[id];
        const draft = scope === mode ? state[mode] : state.scoped[scope];
        if (!current || !draft?.prompt.trim() || discussionRequests.has(id)) return;
        const controller = new AbortController();
        discussionRequests.set(id, controller);
        setRuntime({ pending: true, error: "", stream: "" });
        const messageId = nanoid();
        try {
            const prepared = creationExecutors.get(scope)?.prepare(draft.prompt, true);
            if (!prepared) throw new Error("当前创作输入尚未准备好");
            const entry: CreationEntry = { id: messageId, role: "user", text: prepared.submission.prompt, references: prepared.submission.references };
            // Save the user message before network submission; no silent resend after refresh.
            const entries = [...current.entries, entry];
            state.updateConversation(id, { entries });
            await flushComposerSave();
            const messages: AiTextMessage[] = [{ role: "system", content: `${DISCUSSION_INSTRUCTIONS}\n创作类型：${mode === "image" ? "图片" : "视频"}\n${current.skill ? `本轮 Skill 方法参考：\n${current.skill.instructions}` : ""}` }];
            for (const item of entries) {
                if (item.error) continue;
                if (item.plan) { messages.push({ role: "assistant", content: `方案第 ${item.plan.version} 版（${item.plan.state === "draft" ? "尚未确认" : "已发起执行"}）：${item.plan.submission.prompt}` }); continue; }
                const images = await Promise.all((item.references || []).map(async (ref) => ({ type: "image_url" as const, image_url: { url: await imageToDataUrl(ref) } })));
                messages.push({ role: item.role, content: images.length ? [{ type: "text", text: item.text }, ...images] : item.text });
            }
            const answer = await requestCreationDiscussion(current.dialogueModel, messages, controller.signal, (text) => setRuntime({ stream: text }));
            const latest = useComposerStore.getState().conversations[id];
            state.updateConversation(id, { entries: [...latest.entries.map((item) => item.id === messageId && answer.native ? { ...item, native: { ...answer.native, itemId: `synthetic:user:${messageId}` } } : item), { id: nanoid(), role: "assistant", text: answer.reply, native: answer.native }] });
            await flushComposerSave();
            const latestDraft = scope === mode ? useComposerStore.getState()[mode] : useComposerStore.getState().scoped[scope];
            if (useComposerStore.getState().activeConversations[scope] === id && latestDraft === draft) state.patch(mode, { prompt: "" }, scope === mode ? undefined : scope);
            if (answer.prompt) {
                discussionRequests.delete(id);
                preparePlan(answer.prompt, prepared);
                await flushComposerSave();
            }
        } catch (cause) {
            const text = controller.signal.aborted ? "已停止等待回复；远端可能仍在处理。草稿保留，不会自动重发。" : cause instanceof Error ? cause.message : String(cause);
            setRuntime({ error: text });
            const latest = useComposerStore.getState().conversations[id];
            if (latest) state.updateConversation(id, { entries: latest.entries.map((item) => item.id === messageId ? { ...item, error: text } : item) });
            showErrorToast(message, new Error(text));
        } finally { if (discussionRequests.get(id) === controller) discussionRequests.delete(id); setRuntime({ pending: false, stream: "" }); }
    };
    return { id, conversation, pending, stream, error, update, send, preparePlan, stop: () => discussionRequests.get(id)?.abort() };
}
