import { useEffect, useRef, useState } from "react";
import { App } from "antd";
import { nanoid } from "nanoid";
import { ChevronDown, Sparkles } from "lucide-react";
import { Streamdown } from "streamdown";
import { InkButton } from "@/components/ui/ink-button";
import { useComposerStore, flushComposerSave } from "@/stores/use-composer-store";
import { useCreationDiscussion } from "@/hooks/use-creation-discussion";
import { creationExecutors, creationExecutions, CreationNotSubmittedError, type CreationEntry, type CreationPlan } from "@/lib/creation-conversation";
import type { ComposerMode } from "@/lib/composer";
import { modelOptionName } from "@/stores/use-config-store";
import { showErrorToast } from "@/features/errors/error-toast";
import { CreationArtifacts } from "./creation-artifacts";

export function CreationConversationView({ scope, mode }: { scope: string; mode: ComposerMode }) {
    const discussion = useCreationDiscussion(scope, mode);
    const records = useComposerStore((state) => state.conversations);
    const [previewId, setPreviewId] = useState("");
    const conversation = records[previewId] || discussion.conversation;
    const current = !previewId || previewId === discussion.id;
    const { pending, stream, error, stop, preparePlan } = discussion;
    useEffect(() => {
        const focus = (event: Event) => { if ((event as CustomEvent).detail === scope) setPreviewId(""); };
        window.addEventListener("creation-focus", focus);
        return () => window.removeEventListener("creation-focus", focus);
    }, [scope]);
    const end = useRef<HTMLDivElement>(null);
    const nearEnd = useRef(true);
    const [unread, setUnread] = useState(false);
    useEffect(() => {
        const scroller = end.current?.closest(".thin-scrollbar");
        if (!scroller) return;
        const track = () => { nearEnd.current = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 32; if (nearEnd.current) setUnread(false); };
        scroller.addEventListener("scroll", track);
        return () => scroller.removeEventListener("scroll", track);
    }, [conversation?.id]);
    useEffect(() => {
        if (nearEnd.current) end.current?.scrollIntoView({ block: "end" });
        else setUnread(true);
    }, [conversation?.entries.length, stream]);
    if (!conversation) return null;
    const plans = conversation.entries.filter((item) => item.plan);
    const latestPlanId = plans.at(-1)?.id;
    const closedIndex = conversation.entries.findLastIndex((item) => item.plan?.state === "submitted" || item.plan?.state === "unknown");
    const renderEntry = (entry: CreationEntry) => entry.plan ? <CreationPlanCard key={entry.id} scope={scope} conversationId={conversation.id} entry={entry} editable={current && entry.id === latestPlanId && !pending} /> : <div key={entry.id} className={entry.role === "user" ? "ml-auto max-w-[85%] whitespace-pre-wrap text-sm leading-7" : "flex gap-3 text-sm leading-7"}>
        {entry.role === "assistant" ? <Sparkles className="mt-1 size-4 shrink-0 text-[color:var(--zhu-500)]" /> : null}
        <div className="min-w-0"><Streamdown>{entry.text}</Streamdown>{entry.references?.length ? <p className="text-xs text-[color:var(--ink-500)]">引用：{entry.references.map((ref) => ref.name).join("、")}</p> : null}{entry.error ? <p role="alert" className="text-xs text-[color:var(--zhu-600)]">{entry.error}</p> : null}</div>
    </div>;
    return <div className="mx-auto max-w-4xl space-y-5 pb-4" aria-label="创作记录">
        <div className="flex items-center justify-between gap-2 text-xs text-[color:var(--ink-500)]">
            <span>{pending ? "正在讨论方案" : "创作记录 · 保存在本机浏览器"}</span>
            <div className="flex flex-wrap gap-2">
                <select aria-label="查看创作历史" value={conversation.id} className="max-w-44 bg-transparent" onChange={(event) => setPreviewId(event.target.value)}>
                    {Object.values(records).filter((record) => record.scope === scope).reverse().map((record) => <option key={record.id} value={record.id}>{record.id === discussion.id ? "当前创作" : record.entries.find((entry) => entry.text)?.text.slice(0, 24) || record.entries.find((entry) => entry.plan)?.plan?.submission.prompt.slice(0, 24) || record.draft?.prompt.slice(0, 24) || "空白创作"}</option>)}
                </select>
                <InkButton variant="ghost" size={32} disabled={pending || discussion.conversation?.entries.some((item) => item.plan && creationExecutions.has(item.plan.id))} onClick={() => {
                    setPreviewId("");
                    if (scope === mode) useComposerStore.getState().ensureConversation(scope, mode, true);
                    else window.dispatchEvent(new CustomEvent("creation-new", { detail: scope }));
                }}>新建创作</InkButton>
            </div>
        </div>
        {!current ? <div className="flex flex-wrap items-center gap-2 text-xs text-[color:var(--ink-500)]"><span>正在查看历史，输入框仍属于当前创作。</span><InkButton variant="ghost" size={32} onClick={() => setPreviewId("")}>返回当前创作</InkButton><InkButton variant="ghost" size={32} disabled={pending} onClick={() => { useComposerStore.getState().activateConversation(conversation.id); setPreviewId(""); }}>继续这次创作</InkButton></div> : null}
        {!conversation.entries.length ? <p className="py-6 text-sm leading-7 text-[color:var(--ink-500)]">在下方描述想法，点击「先讨论」与模型确认方案；也可以直接生成。</p> : null}
        {closedIndex > 0 ? <details><summary className="cursor-pointer text-xs text-[color:var(--ink-500)]">已确认前面的方案 · 查看讨论与作品</summary><div className="mt-5 space-y-5">{conversation.entries.slice(0, closedIndex).map(renderEntry)}</div></details> : null}
        {conversation.entries.slice(Math.max(0, closedIndex)).map(renderEntry)}
        {current && pending ? <div role="status" className="text-sm leading-7 text-[color:var(--ink-500)]"><p>{stream ? "正在整理回复…" : "正在思考方案…"}</p><InkButton variant="ghost" size={32} onClick={stop}>停止等待回复</InkButton></div> : null}
        {current && error ? <p role="alert" className="text-xs text-[color:var(--zhu-600)]">{error}</p> : null}
        {current && !pending && conversation.entries.some((item) => item.role === "assistant" && item.text) ? <InkButton variant="ghost" size={32} onClick={() => {
            const last = conversation.entries.findLast((item) => item.role === "assistant" && item.text);
            if (last) preparePlan(last.text);
        }}>从回复编辑生成方案</InkButton> : null}
        {unread ? <InkButton variant="ghost" size={32} className="sticky bottom-0" onClick={() => { end.current?.scrollIntoView({ block: "end", behavior: "smooth" }); nearEnd.current = true; setUnread(false); }}><ChevronDown className="size-4" />有新内容</InkButton> : null}
        <div ref={end} />
    </div>;
}

function CreationPlanCard({ scope, conversationId, entry, editable }: { scope: string; conversationId: string; entry: CreationEntry; editable: boolean }) {
    const { message } = App.useApp();
    const plan = entry.plan!;
    const [editing, setEditing] = useState(false);
    const [prompt, setPrompt] = useState(plan.submission.composerContent || plan.submission.prompt);
    const draftPlan = plan.state === "draft";
    const changePlan = (next: CreationPlan) => {
        const state = useComposerStore.getState();
        const id = conversationId;
        const conversation = state.conversations[id];
        state.updateConversation(id, { entries: conversation.entries.map((item) => item.id === entry.id ? { ...item, plan: next } : item) });
    };
    const saveVersion = () => {
        const executor = creationExecutors.get(scope);
        if (!executor || !prompt.trim()) return;
        try {
            const state = useComposerStore.getState();
            const id = conversationId;
            const conversation = state.conversations[id];
            const version = Math.max(0, ...conversation.entries.flatMap((item) => item.plan ? [item.plan.version] : [])) + 1;
            state.updateConversation(id, { entries: [...conversation.entries, { id: nanoid(), role: "assistant", text: "", plan: { ...executor.prepare(prompt, true), id: nanoid(), version, state: "draft" } }] });
            setEditing(false);
        } catch (cause) { showErrorToast(message, cause); }
    };
    const confirm = async () => {
        const state = useComposerStore.getState();
        const current = state.conversations[conversationId]?.entries.find((item) => item.id === entry.id)?.plan;
        const executor = creationExecutors.get(scope);
        if (!current || current.state !== "draft" || !executor) return;
        creationExecutions.add(current.id);
        changePlan({ ...current, state: "submitting", error: undefined });
        let started = false;
        try {
            await flushComposerSave();
            started = true;
            const taskId = await executor.execute(current);
            changePlan({ ...current, taskId, state: taskId ? "submitted" : "unknown", error: taskId ? undefined : "没有取得任务回执，请先核对任务中心与连接状态，不会自动重提。" });
            await flushComposerSave();
        } catch (cause) {
            changePlan({ ...current, state: started && !(cause instanceof CreationNotSubmittedError) ? "unknown" : "draft", error: cause instanceof Error ? cause.message : String(cause) });
            showErrorToast(message, cause);
        } finally { creationExecutions.delete(current.id); }
    };
    return <article className="space-y-3 border-y border-[var(--line)] py-4">
        <header className="flex flex-wrap items-center gap-3 text-sm"><strong>创作方案 · 第 {plan.version} 版</strong><span className="text-xs text-[color:var(--ink-500)]">{draftPlan ? editable ? "待确认" : "历史方案" : plan.state === "submitting" ? creationExecutions.has(plan.id) ? "正在确认受理" : "提交状态待确认 · 请查看原任务" : plan.state === "submitted" ? "已确认" : "提交状态待确认"}</span></header>
        <p className="line-clamp-3 whitespace-pre-wrap text-sm leading-6">{plan.submission.prompt}</p>
        <p className="text-xs text-[color:var(--ink-500)]">{modelOptionName(plan.model)} · {plan.source === "agent" ? "本机 Codex" : "模型 API"} · {plan.source === "agent" ? "按提示词描述 · 1 次本机任务" : plan.submission.mode === "image" ? `${plan.submission.parameters.size} · ${plan.submission.parameters.count} 张` : `${plan.submission.parameters.videoSize} · ${plan.submission.parameters.videoSeconds} 秒`} · {plan.submission.references.length} 张参考图</p>
        {editing ? <div className="space-y-2"><textarea aria-label="编辑生成方案" rows={5} className="w-full rounded border border-[var(--line)] bg-transparent p-3 text-sm leading-6" value={prompt} onChange={(event) => setPrompt(event.target.value)} /><InkButton variant="ghost" size={32} onClick={saveVersion}>保存新版本</InkButton><InkButton variant="ghost" size={32} onClick={() => setEditing(false)}>取消</InkButton></div> : <div className="flex flex-wrap gap-2"><details className="text-xs"><summary className="cursor-pointer py-2">完整提示词</summary><p className="whitespace-pre-wrap py-2 leading-6">{plan.submission.prompt}</p></details>{editable ? <InkButton variant="ghost" size={32} onClick={() => setEditing(true)}>{draftPlan ? "编辑方案" : "基于此方案修改"}</InkButton> : null}{draftPlan && editable ? <InkButton size={32} variant="zhu" onClick={() => void confirm()}>确认并生成</InkButton> : null}</div>}
        {plan.error ? <p role="alert" className="text-xs text-[color:var(--zhu-600)]">{plan.error}</p> : null}
        {!draftPlan ? <CreationArtifacts plan={plan} scope={scope} /> : null}
    </article>;
}
