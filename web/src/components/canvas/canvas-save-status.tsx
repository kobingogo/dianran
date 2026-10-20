import { App } from "antd";
import { showErrorToast } from "@/features/errors/error-toast";
import { useCanvasSaveStore } from "@/stores/canvas/use-canvas-save-store";
import { retryCanvasSave, useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { useCanvasExport } from "@/hooks/use-canvas-export";
import { useThemeStore } from "@/stores/use-theme-store";
import { canvasThemes } from "@/lib/canvas-theme";

export function CanvasSaveStatus() {
    const { message } = App.useApp();
    const exportProjects = useCanvasExport();
    const status = useCanvasSaveStore((state) => state.status);
    const error = useCanvasSaveStore((state) => state.error);
    const readFailed = useCanvasSaveStore((state) => state.readFailed);
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    return (
        <div role={status === "error" ? "alert" : "status"} title={error || undefined} className="flex flex-wrap items-center gap-2 text-xs" style={{ color: theme.node.muted }}>
            <span>{status === "error" ? (readFailed ? "画布读取失败，原数据未覆盖" : "保存失败，内容仍在当前页面") : status === "saving" ? "正在保存…" : status === "loading" ? "正在读取…" : "已保存到本机"}</span>
            {status === "error" && (
                <>
                    <button className="rounded px-1 hover:bg-black/5 dark:hover:bg-white/10" onClick={() => void retryCanvasSave().catch((error) => showErrorToast(message, error, "画布重试失败"))}>
                        重试{readFailed ? "读取" : "保存"}
                    </button>
                    {!readFailed && (
                        <button className="rounded px-1 hover:bg-black/5 dark:hover:bg-white/10" onClick={() => void exportProjects(useCanvasStore.getState().projects, "画布备份", true)}>
                            导出抢救包
                        </button>
                    )}
                </>
            )}
        </div>
    );
}
