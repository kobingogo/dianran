import type { VideoGenerationTask } from "@/services/api/video";

/** A received remote ID remains recoverable even when the required local receipt fails. */
export async function persistVideoTask(task: VideoGenerationTask, persist: () => Promise<unknown>) {
    try { await persist(); }
    catch (cause) {
        throw Object.assign(new Error(`原视频任务 ID：${task.id}；本地保存失败，请复制此 ID 抢救。停止本地等待不代表取消远端任务；修复保存后取原任务状态，不要自动重新提交。`), { outcome: "unknown" as const, task, cause });
    }
}
