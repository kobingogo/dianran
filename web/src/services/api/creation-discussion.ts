import { requestImageQuestion, type AiTextMessage } from "./image";
import { AgentApiError, fetchAgentJson } from "./canvas-agent";
import { useAgentStore } from "@/stores/use-agent-store";
import { isAiConfigReady, useConfigStore } from "@/stores/use-config-store";
import { parseDiscussionResponse } from "@/lib/creation-conversation";

type DiscussionResponse = { reply: string; prompt: string | null; native?: { threadId: string; turnId: string; itemId: string } };
export async function requestCreationDiscussion(model: string, messages: AiTextMessage[], signal: AbortSignal, onDelta: (text: string) => void): Promise<DiscussionResponse> {
    if (model.startsWith("local:")) {
        const agent = useAgentStore.getState();
        const selected = model.slice(6);
        if (!agent.connected || !agent.models.some((item) => item.model === selected)) throw new Error("本机对话模型不可用，请连接 Agent 并重新选择");
        const images: string[] = [];
        const history = messages.map((message) => ({ ...message, content: Array.isArray(message.content) ? message.content.map((part) => {
            if (part.type === "text") return part;
            const index = images.push(part.image_url.url);
            return { type: "text", text: `附图 ${index}` };
        }) : message.content }));
        try {
            const result = await fetchAgentJson<{ data: DiscussionResponse }>(agent.url, agent.token, "/agent/codex/creation-discussion", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model: selected, prompt: JSON.stringify(history), images }), signal });
            return result.data;
        } catch (cause) {
            if (cause instanceof AgentApiError && cause.status === 404) throw new Error("当前 Agent 尚未包含创作讨论接口，请以本轮项目源码启动 Agent 后再试；草稿已保留");
            throw cause;
        }
    }
    const config = useConfigStore.getState().config;
    if (!isAiConfigReady(config, model)) throw new Error("请配置可用的文本对话模型；图片或视频模型不能自动替代对话模型");
    return parseDiscussionResponse(await requestImageQuestion({ ...config, model }, messages, onDelta, { signal }));
}
