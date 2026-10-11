import { recordLocalDiagnostic } from "@/stores/use-local-diagnostics-store";
/** Receiving an HTTP error or losing the response does not prove a billed request was rejected. */
export type RequestOutcome = "rejected" | "unknown" | "not-submitted";
export function requestOutcome(error: unknown): RequestOutcome {
    const item = error as { outcome?: RequestOutcome; status?: number; response?: { status?: number; data?: { code?: unknown } } } | null;
    if (item?.outcome) return item.outcome;
    const status = item?.response?.status ?? item?.status;
    return status && status >= 400 && status < 500 && status !== 408 ? "rejected" : "unknown";
}
export function generationError(error: unknown, message: string) {
    if (error instanceof Error && "outcome" in error) return error;
    const outcome = requestOutcome(error);
    if (outcome === "unknown") void recordLocalDiagnostic("generation-uncertain");
    return Object.assign(new Error(outcome === "unknown" ? `结果未知：${message}。请求可能已被渠道接受；停止本地等待不代表取消远端任务，新请求可能再次计费。` : outcome === "not-submitted" ? `尚未发送生成请求：${message}` : `渠道明确拒绝：${message}`), { outcome, cause: error });
}
export const NEW_REQUEST_WARNING = "这会创建新的生成请求，可能再次计费。原请求可能仍在执行；如有原任务 ID，请先取任务状态。是否继续？";

export async function prepareGenerationInput<T>(prepare: () => Promise<T>): Promise<T> {
    try { return await prepare(); }
    catch (cause) { throw Object.assign(new Error(cause instanceof Error ? cause.message : "生成输入准备失败"), { outcome: "not-submitted" as const, cause }); }
}
