import { useState } from "react";
import { Button, Input, InputNumber, Radio, Select } from "antd";

type Field = { type: string; title?: string; description?: string; format?: string; enum?: string[]; enumNames?: string[]; oneOf?: Array<{ const: string; title: string }>; items?: { enum?: string[]; anyOf?: Array<{ const: string; title: string }> }; minimum?: number; maximum?: number; minLength?: number; maxLength?: number };
type Question = { id: string; header: string; question: string; isOther?: boolean; isSecret?: boolean; options?: Array<{ label: string; description: string }> };
export type CodexInteractionRequest = { requestId: string; method: string; threadId: string; turnId: string; submitted?: boolean; questions?: Question[]; message?: string; serverName?: string; mode?: string; url?: string; requestedSchema?: { properties: Record<string, Field>; required?: string[] } };

/** 私有交互表单只收集用户实际输入；参数与格式最终由本机服务校验。 */
export function CodexInteractionForm({ request, onSubmit, disabled = false }: { request: CodexInteractionRequest; onSubmit: (response: Record<string, unknown>) => Promise<void>; disabled?: boolean }) {
    const [values, setValues] = useState<Record<string, unknown>>({});
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const locked = disabled || busy || Boolean(request.submitted);
    const set = (key: string, value: unknown) => setValues((current) => ({ ...current, [key]: value }));
    const submit = async (response: Record<string, unknown>) => {
        setBusy(true); setError("");
        try { await onSubmit(response); } catch (cause) { setError(cause instanceof Error ? cause.message : "提交失败，请检查连接和任务状态"); }
        finally { setBusy(false); }
    };
    const questions = request.questions || [];
    const fields = Object.entries(request.requestedSchema?.properties || {});
    const missing = questions.length ? questions.some(({ id }) => !String(values[id] || "").trim()) : (request.requestedSchema?.required || []).some((key) => values[key] === undefined || values[key] === "");
    return <div className="space-y-3 text-sm">
        <p>{request.message || "Agent 需要你的回答"}</p>
        {request.serverName && <p className="opacity-60">来源：{request.serverName}</p>}
        {questions.map((question) => <div key={question.id} className="space-y-2">
            <p>{question.header} · {question.question}</p>
            {!!question.options?.length && <Radio.Group disabled={locked} value={values[question.id]} onChange={(event) => set(question.id, event.target.value)} className="flex flex-col gap-2">
                {question.options.map((option) => <Radio key={option.label} value={option.label}><span>{option.label}</span><span className="ml-2 opacity-60">{option.description}</span></Radio>)}
            </Radio.Group>}
            {(!question.options?.length || question.isOther) && (question.isSecret ? <Input.Password disabled={locked} value={String(values[question.id] || "")} placeholder="输入回答" onChange={(event) => set(question.id, event.target.value)} /> : <Input.TextArea disabled={locked} value={String(values[question.id] || "")} placeholder={question.options?.length ? "或补充其他回答" : "输入回答"} onChange={(event) => set(question.id, event.target.value)} />)}
        </div>)}
        {request.mode === "form" && fields.map(([key, field]) => {
            const choices = field.enum?.map((value, index) => ({ value, label: field.enumNames?.[index] || value })) || field.oneOf?.map(({ const: value, title: label }) => ({ value, label })) || field.items?.enum?.map((value) => ({ value, label: value })) || field.items?.anyOf?.map(({ const: value, title: label }) => ({ value, label }));
            return <label key={key} className="block space-y-1"><span>{field.title || key}{request.requestedSchema?.required?.includes(key) ? " *" : ""}</span>{field.description && <p className="opacity-60">{field.description}</p>}
                {choices ? <Select className="w-full" disabled={locked} mode={field.type === "array" ? "multiple" : undefined} value={values[key] as string | string[] | undefined} options={choices} onChange={(value) => set(key, value)} /> : field.type === "boolean" ? <Radio.Group disabled={locked} value={values[key]} onChange={(event) => set(key, event.target.value)} options={[{ label: "是", value: true }, { label: "否", value: false }]} /> : ["number", "integer"].includes(field.type) ? <InputNumber className="w-full" disabled={locked} value={values[key] as number | undefined} min={field.minimum ?? undefined} max={field.maximum ?? undefined} precision={field.type === "integer" ? 0 : undefined} onChange={(value) => set(key, value ?? undefined)} /> : <Input disabled={locked} value={String(values[key] || "")} maxLength={field.maxLength ?? undefined} onChange={(event) => set(key, event.target.value)} />}
            </label>;
        })}
        {request.mode === "url" && <div className="space-y-2"><p>请先核对地址。打开链接不会自动批准，完成后再确认。</p><a href={request.url} target="_blank" rel="noopener noreferrer" className="break-all">{request.url}</a></div>}
        {error && <p role="alert">{error}</p>}
        {request.submitted && <p className="opacity-60">已提交，等待 Agent 确认</p>}
        <div className="flex gap-2"><Button type="text" disabled={locked || missing} onClick={() => void submit(questions.length ? { answers: Object.fromEntries(questions.map(({ id }) => [id, { answers: [String(values[id])] }])) } : { action: "accept", content: request.mode === "url" ? null : values })}>{request.mode === "url" ? "已完成，确认" : "提交回答"}</Button>
            {!questions.length && <Button type="text" disabled={locked} onClick={() => void submit({ action: "decline" })}>拒绝</Button>}
            <Button type="text" disabled={locked} onClick={() => void submit({ action: "cancel" })}>取消</Button>
        </div>
    </div>;
}
