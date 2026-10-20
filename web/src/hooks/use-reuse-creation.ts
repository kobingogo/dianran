import { App } from "antd";
import { useComposerStore, type ComposerDraft } from "@/stores/use-composer-store";
import type { ComposerMode } from "@/lib/composer";

export function useReuseCreation() {
    const { modal } = App.useApp();
    return async (mode: ComposerMode, next: Partial<ComposerDraft>, configure?: () => void) => {
        const draft = useComposerStore.getState()[mode];
        if (draft.prompt.trim() || draft.references.length) {
            const accepted = await new Promise<boolean>((resolve) => modal.confirm({ title: "替换当前草稿？", content: "当前输入尚未提交，复用这次创作会替换提示词与引用。", okText: "替换草稿", cancelText: "保留草稿", onOk: () => resolve(true), onCancel: () => resolve(false) }));
            if (!accepted) return false;
        }
        useComposerStore.getState().patch(mode, next);
        configure?.();
        return true;
    };
}
