import { App } from "antd";
import { useNavigate } from "react-router-dom";
import { useReuseCreation } from "@/hooks/use-reuse-creation";
import { showErrorToast } from "@/features/errors/error-toast";
import { flushComposerSave, useComposerStore, type ComposerDraft } from "@/stores/use-composer-store";
import type { ComposerMode } from "@/lib/composer";

export function useOpenCreationDraft() {
    const reuse = useReuseCreation();
    const navigate = useNavigate();
    const { message } = App.useApp();
    return async (mode: ComposerMode, draft: Pick<ComposerDraft, "prompt" | "references">) => {
        try {
            if (!await reuse(mode, { initialized: true, canvas: false, nodeIds: [], parameters: undefined, ...draft })) return false;
            useComposerStore.getState().setMode(mode);
            await flushComposerSave();
            navigate(`/${mode}`);
            window.dispatchEvent(new CustomEvent("creation-focus", { detail: mode }));
            message.info("已载入草稿，请核对提示词、参考图和模型后再生成。");
            return true;
        } catch (error) {
            showErrorToast(message, error, "草稿尚未保存，请保留当前页面并重试");
            return false;
        }
    };
}
