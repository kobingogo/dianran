import { AjvJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/ajv";
import type { JsonRecord } from "../utils/value.js";

const validator = new AjvJsonSchemaValidator();
export const USER_INPUT_METHOD = "item/tool/requestUserInput";
export const ELICITATION_METHOD = "mcpServer/elicitation/request";
export type CodexInteraction = { requestId: string; method: string; threadId: string; turnId: string; submitted?: boolean } & JsonRecord;

/** 只支持标准 MCP 平面表单；扩展表单必须显式拒绝。 */
export function supportedInteraction(method: string, params: JsonRecord) {
    if (method === USER_INPUT_METHOD) {
        if (!Array.isArray(params.questions) || !params.questions.length) return false;
        const ids = new Set<string>();
        return params.questions.every((question) => {
            if (!question || typeof question !== "object" || typeof question.id !== "string" || !question.id || ids.has(question.id) || typeof question.question !== "string") return false;
            ids.add(question.id);
            return !question.options || (Array.isArray(question.options) && question.options.every((option: JsonRecord) => typeof option.label === "string" && typeof option.description === "string"));
        });
    }
    if (method !== ELICITATION_METHOD) return false;
    if (params.mode === "url") {
        try { const url = new URL(String(params.url)); return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password; } catch { return false; }
    }
    const schema = params.requestedSchema as JsonRecord | undefined;
    if (params.mode !== "form" || schema?.type !== "object" || !schema.properties) return false;
    return Object.values(schema.properties as JsonRecord).every((value) => {
        if (!value || typeof value !== "object") return false;
        const field = value as JsonRecord;
        if (!["string", "integer", "number", "boolean", "array"].includes(String(field.type))) return false;
        const items = field.items as JsonRecord | undefined;
        return field.type !== "array" || Boolean(items && (Array.isArray(items.enum) || Array.isArray(items.anyOf)));
    });
}

export function interactionCancellation(method: string) {
    return method === USER_INPUT_METHOD ? { answers: {} } : { action: "cancel", content: null };
}

/** SDK 的 JSON Schema 验证器负责枚举、格式与字段约束，不自行解析标准。 */
export function validateInteractionResponse(method: string, params: JsonRecord, response: JsonRecord) {
    if (method === USER_INPUT_METHOD) {
        const answers = response.answers as Record<string, { answers: unknown }> | undefined;
        const questions = params.questions as Array<{ id: string; isOther?: boolean; options?: Array<{ label: string }> }>;
        if (!answers || Object.keys(response).some((key) => key !== "answers")) throw new Error("提问响应格式无效");
        const ids = new Set(questions.map(({ id }) => id));
        if (Object.keys(answers).some((id) => !ids.has(id))) throw new Error("回答包含未知问题");
        for (const question of questions) {
            const values = answers[question.id]?.answers;
            if (!Array.isArray(values) || !values.length || values.some((value) => typeof value !== "string" || !value.trim())) throw new Error("请回答全部问题，或明确取消提问");
            if (question.options?.length && !question.isOther && values.some((value) => !question.options!.some(({ label }) => label === value))) throw new Error("回答不是允许的选项");
        }
        return { answers };
    }
    if (!["accept", "decline", "cancel"].includes(String(response.action))) throw new Error("请选择接受、拒绝或取消");
    if (response.action !== "accept") return { action: response.action, content: null };
    if (params.mode === "url") return { action: "accept", content: null };
    if (params.mode !== "form") throw new Error("不支持该表单模式");
    // 锁定协议允许 optional schema 字段为 null，标准 JSON Schema 将其视为未指定。
    const clean = (value: unknown): unknown => Array.isArray(value) ? value.map(clean) : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).filter(([, v]) => v !== null).map(([k, v]) => [k, clean(v)])) : value;
    const schema = clean(params.requestedSchema) as JsonRecord;
    const result = validator.getValidator({ ...schema, additionalProperties: false })(response.content);
    if (!result.valid) throw new Error(`表单未通过校验：${result.errorMessage}`);
    return { action: "accept", content: result.data };
}
