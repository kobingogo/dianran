import { useCallback } from "react";
import { App } from "antd";
import { showErrorToast } from "@/features/errors/error-toast";
import { useAssetSaveStore } from "@/stores/use-asset-save-store";

export function useAssetMutation() {
    const { message } = App.useApp();
    return useCallback(async (action: () => Promise<unknown>, successText: string) => {
        try {
            await action();
            message.success(successText);
            return true;
        } catch (error) {
            showErrorToast(message, error, useAssetSaveStore.getState().readFailed ? "素材读取失败，请到我的素材重试读取" : "保存失败，内容仍在当前页面；可到我的素材重试或导出");
            return false;
        }
    }, [message]);
}
