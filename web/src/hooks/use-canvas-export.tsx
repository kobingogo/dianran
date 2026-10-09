import { useCallback } from "react";
import { App } from "antd";
import { CanvasBackupError } from "@/lib/canvas/canvas-archive";
import { exportCanvasProjects } from "@/lib/canvas/canvas-export";
import { showErrorToast } from "@/features/errors/error-toast";
import type { CanvasProject } from "@/stores/canvas/use-canvas-store";
import { recordLocalDiagnostic } from "@/stores/use-local-diagnostics-store";

export function useCanvasExport() {
    const { message, modal } = App.useApp();
    return useCallback(async (projects: CanvasProject[], name: string, rescue = false) => {
        const snapshot = structuredClone(projects);
        const hide = message.loading("正在核对并导出项目…", 0);
        try {
            await exportCanvasProjects(snapshot, name, rescue);
            void recordLocalDiagnostic("backup-exported");
            message.success(rescue ? "抢救包已导出，请保留缺失清单" : "项目完整备份已导出");
        } catch (error) {
            if (!(error instanceof CanvasBackupError)) return showErrorToast(message, error, "项目导出失败");
            hide();
            modal.confirm({
                title: "无法生成完整备份",
                content: <div className="max-h-64 overflow-auto text-sm">
                    <p>以下媒体缺失或没有打包。可以导出项目结构及可读取文件的抢救包，抢救包不代表完整恢复。</p>
                    {[...error.report.unavailableFiles, ...error.report.externalLinks].map((issue, index) => <p key={index} className="mt-2 break-all">{snapshot.find((project) => project.id === issue.projectId)?.title} · {issue.reference}：{issue.reason}</p>)}
                </div>,
                okText: "导出抢救包",
                cancelText: "取消",
                onOk: async () => {
                    try {
                        await exportCanvasProjects(snapshot, name, true);
                        message.warning("抢救包已导出，缺失文件与远程链接未恢复");
                    } catch (error) {
                        showErrorToast(message, error, "抢救导出失败");
                        throw error;
                    }
                },
            });
        } finally { hide(); }
    }, [message, modal]);
}
