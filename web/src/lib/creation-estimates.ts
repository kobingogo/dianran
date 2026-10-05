import type { WorkflowPlan, WorkflowStep } from "@/lib/canvas/workflow";
import { resolveModelRequestConfig, type AiConfig } from "@/stores/use-config-store";
import type { ComposerSubmission, ComposerMode } from "@/lib/composer";
export type EstimateCondition = { mode: ComposerMode; model: string; endpoint: string; apiFormat: string; actual: Record<string, string | number>; references: number; videos: number; audios: number; calls: number };
export type CreationQuote = { id: string; condition: EstimateCondition; amount: number; currency: string; unit: "output" | "second"; source: string; recordedAt: number };
export type TimingSample = { id: string; condition: EstimateCondition; durationMs: number; recordedAt: number };
export function estimateCondition(config: AiConfig, submission: ComposerSubmission): EstimateCondition {
    const model = submission.parameters[submission.mode === "image" ? "imageModel" : "videoModel"];
    const request = resolveModelRequestConfig(config, model);
    const input = (submission as ComposerSubmission & { input?: { referenceVideos: unknown[]; referenceAudios: unknown[] } }).input;
    return {
        mode: submission.mode,
        model,
        endpoint: request.baseUrl,
        apiFormat: request.apiFormat,
        actual: { ...submission.actual },
        references: submission.references.length,
        videos: input?.referenceVideos.length || 0,
        audios: input?.referenceAudios.length || 0,
        calls: submission.mode === "image" ? Number(submission.parameters.count) : 1,
    };
}
export function workflowEstimateCondition(step: WorkflowStep, plan: WorkflowPlan, config: AiConfig): EstimateCondition {
    const model = step.parameters[step.mode === "image" ? "imageModel" : "videoModel"];
    const inputs = new Map(
        step.inputs.map((input) => {
            const node = plan.resources.find((node) => node.id === input.nodeId);
            const type = input.stepId ? plan.steps.find((producer) => producer.id === input.stepId)?.mode : node?.type;
            return [`${type}:${input.stepId || node?.metadata?.storageKey || input.nodeId}`, type];
        }),
    );
    const types = [...inputs.values()];
    return {
        mode: step.mode,
        model,
        endpoint: step.endpoint,
        apiFormat: resolveModelRequestConfig(config, model).apiFormat,
        actual: step.actual,
        calls: step.calls,
        references: types.filter((type) => type === "image").length,
        videos: types.filter((type) => type === "video").length,
        audios: 0,
    };
}
export function conditionKey(condition: EstimateCondition, includeCalls = false) {
    return JSON.stringify([
        condition.mode,
        condition.model,
        condition.endpoint,
        condition.apiFormat,
        Object.entries(condition.actual).sort(([a], [b]) => a.localeCompare(b)),
        condition.references,
        condition.videos,
        condition.audios,
        ...(includeCalls ? [condition.calls] : []),
    ]);
}
export function estimateCreation(condition: EstimateCondition, quotes: CreationQuote[], samples: TimingSample[]) {
    const quote = quotes.findLast((quote) => conditionKey(quote.condition) === conditionKey(condition));
    const durations = samples
        .filter((sample) => conditionKey(sample.condition, true) === conditionKey(condition, true) && sample.durationMs > 0)
        .map((sample) => sample.durationMs)
        .sort((a, b) => a - b);
    const seconds = Number(condition.actual.seconds ?? condition.actual.durationSeconds ?? condition.actual.duration);
    const factor = quote?.unit === "second" ? seconds : condition.calls;
    const amount = quote && Number.isFinite(factor) && factor > 0 ? quote.amount * factor : undefined;
    const middle = Math.floor(durations.length / 2);
    const durationMs = durations.length ? (durations.length % 2 ? durations[middle] : (durations[middle - 1] + durations[middle]) / 2) : undefined;
    return { quote, amount, durationMs, samples: durations.length };
}
export function validateQuote(amount: number, currency: string, source: string, unit: CreationQuote["unit"], condition: EstimateCondition) {
    if (!Number.isFinite(amount) || amount < 0 || !currency.trim() || !source.trim()) throw new Error("请填写有效非负单价、币种和报价来源");
    if (unit === "second" && condition.mode !== "video") throw new Error("生图报价按张计费");
}
