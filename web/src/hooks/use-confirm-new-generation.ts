import { useCallback } from "react";
import { App } from "antd";
import { NEW_REQUEST_WARNING } from "@/lib/generation-outcome";

export function useConfirmNewGeneration() {
    const { modal } = App.useApp();
    return useCallback(() => new Promise<boolean>((resolve) => modal.confirm({ title: "创建新的生成请求", content: NEW_REQUEST_WARNING, okText: "新建请求", cancelText: "先不提交", onOk: () => resolve(true), onCancel: () => resolve(false) })), [modal]);
}
