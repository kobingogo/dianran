import { App, Button, theme } from "antd";
import { retryAssetSave, useAssetStore } from "@/stores/use-asset-store";
import { useAssetSaveStore } from "@/stores/use-asset-save-store";
import { exportAssets } from "@/pages/assets/asset-transfer";
import { showErrorToast } from "@/features/errors/error-toast";

export function AssetSaveStatus() {
    const { message } = App.useApp();
    const { token } = theme.useToken();
    const { status, error, readFailed } = useAssetSaveStore();
    return (
        <div role={status === "error" ? "alert" : "status"} title={error || undefined} className="flex flex-wrap items-center justify-center gap-2 text-xs" style={{ color: status === "error" ? token.colorError : token.colorTextSecondary }}>
            <span>{status === "loading" ? "正在读取素材…" : status === "saving" ? "正在保存素材…" : status === "error" ? (readFailed ? "素材读取失败，原数据未覆盖" : "素材保存失败，内容仍在当前页面") : "素材已保存到本机"}</span>
            {status === "error" && <>
                <Button type="text" size="small" onClick={() => void retryAssetSave().catch((error) => showErrorToast(message, error, "素材重试失败"))}>重试{readFailed ? "读取" : "保存"}</Button>
                {!readFailed && <Button type="text" size="small" onClick={() => void exportAssets(useAssetStore.getState().assets, "素材抢救包.zip", true).catch((error) => showErrorToast(message, error, "抢救导出失败"))}>导出抢救包</Button>}
            </>}
        </div>
    );
}
