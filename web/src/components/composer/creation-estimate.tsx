import { useEffect, useState } from "react";
import { App, Input, Modal } from "antd";
import { InkChip } from "@/components/ui/chip";
import { InkButton } from "@/components/ui/ink-button";
import { estimateCondition, estimateCreation, type CreationQuote, type EstimateCondition } from "@/lib/creation-estimates";
import { useCreationEstimatesStore } from "@/stores/use-creation-estimates-store";
import type { AiConfig } from "@/stores/use-config-store";
import type { ComposerSubmission } from "@/lib/composer";
import { formatDuration } from "@/lib/image-utils";
import { showErrorToast } from "@/features/errors/error-toast";
export function CreationEstimate({ submission, config, approvedCondition }: { submission?: ComposerSubmission; config: AiConfig; approvedCondition?: EstimateCondition }) {
    const { message } = App.useApp();
    const { quotes, samples } = useCreationEstimatesStore();
    const [open, setOpen] = useState(false),
        [busy, setBusy] = useState(false);
    const [amount, setAmount] = useState(""),
        [currency, setCurrency] = useState("CNY"),
        [source, setSource] = useState("");
    const [unit, setUnit] = useState<CreationQuote["unit"]>("output");
    const [available, setAvailable] = useState(false);
    useEffect(() => {
        void useCreationEstimatesStore
            .getState()
            .load()
            .then(() => setAvailable(true))
            .catch((error) => {
                setAvailable(false);
                showErrorToast(message, error, "读取估算数据失败");
            });
    }, [message]);
    const condition = approvedCondition || (submission ? estimateCondition(config, submission) : undefined);
    const estimate = condition && available ? estimateCreation(condition, quotes, samples) : undefined;
    const action = async (run: () => Promise<void>) => {
        setBusy(true);
        try {
            await run();
        } catch (error) {
            showErrorToast(message, error);
        } finally {
            setBusy(false);
        }
    };
    return (
        <>
            <div className="flex flex-wrap items-center gap-2 text-xs text-[color:var(--ink-500)]">
                <span>{estimate?.amount !== undefined ? `参考费用 ${estimate.amount.toFixed(4)} ${estimate.quote!.currency}` : "费用由所选渠道计费"}</span>
                {estimate?.durationMs !== undefined && (
                    <span>
                        历史耗时中位数 {formatDuration(estimate.durationMs)} · {estimate.samples} 次
                    </span>
                )}
                <InkChip
                    onClick={() => {
                        setAmount(estimate?.quote ? String(estimate.quote.amount) : "");
                        setCurrency(estimate?.quote?.currency || "CNY");
                        setSource(estimate?.quote?.source || "");
                        setUnit(estimate?.quote?.unit || "output");
                        setOpen(true);
                    }}
                >
                    报价与耗时
                </InkChip>
            </div>
            <Modal title="渠道报价与本机耗时" open={open} onCancel={() => setOpen(false)} footer={null}>
                {!condition ? (
                    <p>当前输入尚无法形成有效请求，请先调整模型、参数和引用。</p>
                ) : (
                    <div className="space-y-3">
                        <p className="break-all">
                            {condition.model} · {condition.endpoint} · {condition.calls} 次生成
                        </p>
                        <pre className="overflow-auto text-xs">{JSON.stringify(condition.actual, null, 2)}</pre>
                        <p>报价仅用于此渠道、模型、实际参数和参考数量。参数变化后重新匹配；金额不包括失败重试、端点回退等额外计费。</p>
                        {condition.mode === "text" && <p>文本报价只用于每次完成的固定报价；按 token 计费的渠道请以实际用量为准。</p>}
                        <Input aria-label="渠道单价" placeholder="渠道单价" value={amount} onChange={(event) => setAmount(event.target.value)} />
                        <Input aria-label="报价币种" placeholder="币种，如 CNY / USD" value={currency} onChange={(event) => setCurrency(event.target.value)} />
                        <label>
                            计价单位{" "}
                            <select aria-label="计价单位" className="bg-transparent" value={unit} onChange={(event) => setUnit(event.target.value as CreationQuote["unit"])}>
                                <option value="output">每{condition.mode === "image" ? "张" : "条"}</option>
                                {condition.mode === "video" && <option value="second">每秒成品</option>}
                            </select>
                        </label>
                        <Input aria-label="报价来源" placeholder="报价来源：渠道价目页或合同说明" value={source} onChange={(event) => setSource(event.target.value)} />
                        <InkButton
                            disabled={busy || !amount.trim()}
                            onClick={() =>
                                void action(async () => {
                                    await useCreationEstimatesStore.getState().quote(condition, Number(amount), currency, unit, source);
                                    setAvailable(true);
                                    message.success("当前条件报价已保存");
                                })
                            }
                        >
                            保存当前条件报价
                        </InkButton>
                        {estimate?.quote && (
                            <div>
                                <p className="break-all">
                                    来源：{estimate.quote.source} · 记录于 {new Date(estimate.quote.recordedAt).toLocaleString()}
                                </p>
                                <InkButton disabled={busy} onClick={() => void action(() => useCreationEstimatesStore.getState().removeQuote(estimate.quote!.id))}>
                                    删除当前报价
                                </InkButton>
                            </div>
                        )}
                        <p>耗时只统计同条件的成功运行，包含请求、等待和本地保存；不是完成时间保证。失败不计入，不自动裁剪历史。当前匹配 {estimate?.samples || 0} 次。</p>
                        <InkButton disabled={busy || !samples.length} onClick={() => void action(() => useCreationEstimatesStore.getState().clearSamples())}>
                            清空本机耗时记录
                        </InkButton>
                    </div>
                )}
            </Modal>
        </>
    );
}
