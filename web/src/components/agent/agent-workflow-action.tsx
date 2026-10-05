import { App } from "antd";
import { useAgentStore } from "@/stores/use-agent-store";
import { useEffectiveConfig } from "@/stores/use-config-store";
import { agentWorkflowBlock, agentWorkflowPlan } from "@/lib/canvas/agent-workflow-plan";
import { useWorkflowStore } from "@/stores/canvas/use-workflow-store";
import { showErrorToast } from "@/features/errors/error-toast";

export function AgentWorkflowAction({ id, text, streaming }: { id: string; text: string; streaming: boolean }) {
    const { message } = App.useApp();
    const config = useEffectiveConfig();
    if (streaming || !agentWorkflowBlock(text)) return null;
    const inspect = async () => {
        try {
            const agent = useAgentStore.getState();
            const item = agent.messages.find((item) => item.id === id);
            const projectId = agent.canvasContext?.snapshot.projectId;
            if (!item?.threadId || !item.turnId || !item.itemId || !projectId) throw new Error("计划缺少会话归属或目标画布，请在画布内重新提出计划");
            const { useCanvasStore } = await import("@/stores/canvas/use-canvas-store");
            const project = useCanvasStore.getState().openProject(projectId);
            if (!project) throw new Error("目标画布不存在");
            const plan = agentWorkflowPlan(text, project.nodes, config, { threadId: item.threadId, turnId: item.turnId, itemId: item.itemId });
            useWorkflowStore.setState({ proposal: { projectId, plan } });
        } catch (error) {
            showErrorToast(message, error, "计划无法预览");
        }
    };
    return (
        <button className="mt-3 rounded px-2 py-1 text-xs hover:bg-black/5 dark:hover:bg-white/10" onClick={() => void inspect()}>
            审阅创作计划
        </button>
    );
}
