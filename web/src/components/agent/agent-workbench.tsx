import { useEffect, useRef, useState } from "react";
import { useAgentMediaStore } from "@/stores/use-agent-media-store";
import { AgentMediaPanel } from "./agent-media-panel";
import { InkChip } from "@/components/ui/chip";
import { useShallow } from "zustand/shallow";
import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";
import { useAgentStore } from "@/stores/use-agent-store";
import { postCodexInteraction } from "@/services/api/canvas-agent";
import { InkButton } from "@/components/ui/ink-button";
import { AgentChatTimeline, AgentTaskProgress } from "./agent-chat";
import { CodexInteractionForm } from "./codex-interaction-form";

/** Main workspace for the same conversation shown in the optional assistant panel. */
export function AgentWorkbench() {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const state = useAgentStore(useShallow((state) => ({ connected: state.connected, sending: state.sending, waiting: state.waiting, actions: state.composerActions, pendingTool: state.pendingTool, pendingApprovals: state.pendingApprovals, interactions: state.pendingInteractions, threadId: state.activeThreadId, conversation: state.conversation, url: state.url, token: state.token, messageCount: state.messages.length })));
    const receipts = useAgentMediaStore((state) => state.receipts);
    const [view, setView] = useState<"chat" | "works">("chat");
    const seenThread = useRef(state.threadId);
    const current = Object.values(receipts).filter(({ task }) => task.native?.threadId === state.threadId);
    const latestCompleted = current.filter(({ task }) => task.status === "completed").sort((a, b) => b.task.createdAt - a.task.createdAt)[0]?.task.id;
    const seenCompleted = useRef(latestCompleted);
    useEffect(() => {
        if (seenThread.current !== state.threadId) {
            seenThread.current = state.threadId;
            seenCompleted.current = latestCompleted;
            setView("chat");
        } else if (latestCompleted && seenCompleted.current !== latestCompleted && !state.sending && !state.waiting) {
            seenCompleted.current = latestCompleted;
            setView("works");
        }
    }, [state.threadId, latestCompleted, state.sending, state.waiting]);
    const showChat = view === "chat" || Boolean(state.pendingTool || state.pendingApprovals.length || state.interactions.some((item) => item.threadId === state.threadId && !item.submitted));
    const openDetails = (activeTab: "chat" | "setup" | "skills") => {
        useAgentStore.getState().setAgentState({ activeTab });
        useAgentStore.getState().openPanel();
    };
    return <section className="flex min-h-0 flex-1 flex-col" aria-label="Agent 创作会话">
        <header className="flex flex-wrap items-center gap-3 border-b border-[var(--line)] px-4 py-3 sm:px-8">
            <h2 className="m-0 font-[family-name:var(--font-serif)] text-[17px] font-semibold">Agent 创作</h2>
            <div role="tablist" aria-label="Agent 会话与作品" className="flex gap-1">
                <InkChip role="tab" aria-selected={showChat} selected={showChat} onClick={() => setView("chat")}>对话</InkChip>
                <InkChip role="tab" aria-selected={!showChat} selected={!showChat} onClick={() => setView("works")}>作品 · {current.length}</InkChip>
            </div>
            <span className="flex-1 text-xs text-[color:var(--ink-500)]" aria-live="polite">{!state.connected ? "未连接" : state.sending || state.waiting ? "正在处理" : ["ready", "warning"].includes(state.conversation.status) ? "可继续协作" : "会话准备中"}</span>
            <InkButton onClick={() => openDetails("skills")}>管理 Skill</InkButton>
            <InkButton onClick={() => openDetails(state.connected ? "chat" : "setup")}>{state.connected ? "协作详情" : "连接本机 Agent"}</InkButton>
        </header>
        {showChat ? <>
        {!state.messageCount && !state.sending && !state.waiting ? <div className="px-4 pt-8 text-sm leading-7 text-[color:var(--ink-500)] sm:px-8">描述你的创作目标，或在下方输入 / 选择 Skill。对话、执行进度和需要你确认的操作会显示在这里。</div> : null}
        <AgentChatTimeline theme={theme} pendingTool={state.pendingTool} pendingApprovals={state.pendingApprovals} sending={state.sending} waiting={state.waiting} onRejectTool={() => state.actions?.rejectTool()} onApproveTool={() => state.actions?.approveTool()} onApprovalDecision={(approval, decision) => state.actions?.decideApproval(approval, decision)} />
        {state.interactions.filter((item) => item.threadId === state.threadId).map((request) => <CodexInteractionForm key={`${request.threadId}:${request.turnId}:${request.requestId}`} request={request} disabled={!state.connected} onSubmit={async (response) => {
            await postCodexInteraction(state.url, state.token, request, response);
            const agent = useAgentStore.getState();
            agent.setAgentState({ pendingInteractions: agent.pendingInteractions.map((item) => item.requestId === request.requestId && item.threadId === request.threadId && item.turnId === request.turnId ? { ...item, submitted: true } : item) });
        }} />)}
        <AgentTaskProgress theme={theme} busy={state.sending || state.waiting} />
        </> : <div className="thin-scrollbar min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-8">
            {current.length ? <AgentMediaPanel embedded history threadId={state.threadId} /> : <p className="text-sm text-[color:var(--ink-500)]">当前会话还没有图片作品，生成后的图片会显示在这里。</p>}
        </div>}
    </section>;
}
