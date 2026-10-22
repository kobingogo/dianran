import { App } from "antd";
import { useComposerStore, type ComposerDraft } from "@/stores/use-composer-store";
import type { ComposerMode } from "@/lib/composer";

export function useReuseCreation() {
    const { modal, message } = App.useApp();
    return async (mode: ComposerMode, next: Partial<ComposerDraft>, configure?: () => void) => {
        if (!useComposerStore.getState().hydrated) {
            message.info("草稿尚未读取完成，请稍后重试；读取失败时请刷新页面。");
            return false;
        }
        const draft = useComposerStore.getState()[mode];
        if (draft.prompt.trim() || draft.references.length) {
            const accepted = await new Promise<boolean>((resolve) => modal.confirm({ title: "替换当前草稿？", content: "当前输入尚未提交，复用这次创作会替换提示词与引用。", okText: "替换草稿", cancelText: "保留草稿", onOk: () => resolve(true), onCancel: () => resolve(false) }));
            if (!accepted) return false;
        }
        if (useComposerStore.getState()[mode] !== draft) {
            message.info("草稿已发生变化，请核对后重新选择。");
            return false;
        }
        useComposerStore.getState().patch(mode, next);
        configure?.();
        return true;
    };
}
