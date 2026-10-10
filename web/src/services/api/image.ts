import { generationError, prepareGenerationInput } from "@/lib/generation-outcome";
import { observeGeneration, recordCapabilityEvidence } from "@/stores/use-capability-evidence-store";
import { proxyFetch } from "@/services/api/proxy-transport";
import { businessOperation } from "@/lib/write-ownership";
import axios from "axios";

import i18n from "@/i18n";
import { buildApiUrl, resolveModelRequestConfig, resolveModelScript, withLocalProxy, type AiConfig, type ModelChannel } from "@/stores/use-config-store";
import { normalizePluginImages, runModelPlugin } from "./model-plugin";
import { nanoid } from "nanoid";
import { dataUrlToFile } from "@/lib/image-utils";
import { buildImageReferencePromptText } from "@/lib/image-reference-prompt";
import { imageToDataUrl } from "@/services/image-storage";
import { imageChannelFormatOf, planImageRequest, type ImageChannelFormat, type ImageSendPlan } from "@/lib/model-capabilities";
import type { ReferenceImage } from "@/types/image";
import { presetApiFlags } from "@/constant/brand";

const apiText = (key: string, options?: Record<string, unknown>) => i18n.t(`apiErrors.${key}`, options);

export type AiTextMessage = {
    role: "system" | "user" | "assistant";
    content: string | Array<{ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } }>;
};

type ResponseToolCall = {
    id: string;
    type: "function";
    function: { name: string; arguments: string };
    thoughtSignature?: string;
};

type ResponseInputMessage =
    | AiTextMessage
    | { type: "function_call"; call_id: string; name: string; arguments: string; thoughtSignature?: string }
    | { role: "tool"; tool_call_id: string; content: string };

type ResponseFunctionTool = {
    type: "function";
    function: {
        name: string;
        description?: string;
        parameters: Record<string, unknown>;
        strict?: boolean;
    };
};

type ToolResponseResult = {
    content: string;
    toolCalls: ResponseToolCall[];
};

type ToolChoice = "auto" | "required" | { type: "function"; name: string };
type ResponseMessageContent = AiTextMessage["content"] | string;
type ResponseInputContent = { type: "input_text"; text: string } | { type: "input_image"; image_url: string };
type ResponseInputItem =
    | { role: "system" | "user" | "assistant"; content: string | ResponseInputContent[] }
    | { type: "function_call"; call_id: string; name: string; arguments: string }
    | { type: "function_call_output"; call_id: string; output: string };
type ResponseApiToolDefinition = {
    type: "function";
    name: string;
    description?: string;
    parameters: Record<string, unknown>;
    strict?: boolean;
};
type ResponseApiOutputItem =
    | { type?: "message"; content?: Array<{ type?: string; text?: string }> }
    | { type?: "function_call"; id?: string; call_id?: string; name?: string; arguments?: string };
type ResponseApiPayload = {
    id?: string;
    output?: ResponseApiOutputItem[];
    output_text?: string;
    error?: { message?: string };
    code?: number;
    msg?: string;
};
type ResponseStreamState = { buffer: string; text: string; payload?: ResponseApiPayload; error?: string };

type ImageApiResponse = {
    data?: Array<Record<string, unknown>>;
    error?: { message?: string };
    code?: number;
    msg?: string;
};
type GeminiPart = {
    text?: string;
    inlineData?: { mimeType?: string; data?: string };
    inline_data?: { mime_type?: string; mimeType?: string; data?: string };
    fileData?: { mimeType?: string; fileUri?: string };
    functionCall?: { id?: string; name?: string; args?: Record<string, unknown> };
    functionResponse?: { id?: string; name?: string; response?: Record<string, unknown> };
    thoughtSignature?: string;
    thought_signature?: string;
};
type GeminiContent = { role?: "user" | "model"; parts: GeminiPart[] };
type GeminiPayload = {
    candidates?: Array<{ content?: { parts?: GeminiPart[] }; finishReason?: string }>;
    models?: Array<{ name?: string }>;
    error?: { message?: string };
    promptFeedback?: { blockReason?: string };
};
type GeminiStreamState = { buffer: string; text: string; toolCalls: ResponseToolCall[]; error?: string };
type RequestOptions = { signal?: AbortSignal };

const IMAGE_SIZE_STEP = 16;
const IMAGE_MIN_PIXELS = 655360;
const IMAGE_MAX_PIXELS = 8294400;
const IMAGE_MAX_EDGE = 3840;
const IMAGE_MAX_RATIO = 3;
const IMAGE_OUTPUT_FORMAT = "png";
// 与 image-storage 的下载超时保持一致，避免接口挂起时节点一直停在生成中。
const IMAGE_REQUEST_TIMEOUT_MS = 10 * 60_000;

function imageChannelFormat(config: Pick<AiConfig, "apiFormat" | "baseUrl">): ImageChannelFormat {
    return imageChannelFormatOf({ apiFormat: config.apiFormat, imageApi: imageApiOf(config as AiConfig) });
}

/** Channel the image request will use, including a session-detected chat fallback. */
export function imageChannelFormatFor(config: Pick<AiConfig, "apiFormat" | "baseUrl">) {
    return imageChannelFormat(config);
}

function imagePlan(config: Pick<AiConfig, "model" | "size" | "quality" | "background" | "apiFormat" | "baseUrl">) {
    return planImageRequest({ model: config.model, size: config.size, quality: config.quality, background: config.background, channel: imageChannelFormat(config) });
}

function ensureImagePlan(plan: ImageSendPlan) {
    if (plan.invalid) throw new Error(apiText("invalidImageSizeFormat"));
    if (plan.fixedSize || !plan.sizeValue || plan.sizeValue === "auto") return;
    if (plan.sizeField !== "size" && plan.sizeField !== "image_size") return;
    const dimensions = parseImageDimensions(plan.sizeValue);
    if (!dimensions) throw new Error(apiText("invalidImageSizeFormat"));
    validateImageSize(dimensions.width, dimensions.height);
}

function openAiImageFields(plan: ImageSendPlan) {
    return {
        ...(plan.sizeField === "size" && plan.sizeValue ? { size: plan.sizeValue } : {}),
        ...(plan.quality?.param === "quality" ? { quality: plan.quality.value } : {}),
        ...(plan.background ? { background: plan.background } : {}),
    };
}

function pluginImageParams(plan: ImageSendPlan, count: number) {
    const size = plan.sizeField === "none" ? undefined : plan.sizeValue;
    const quality = plan.quality?.value;
    return { ...(size ? { size } : {}), ...(quality ? { quality } : {}), count, ...(plan.background ? { background: plan.background } : {}) };
}

function parseImageDimensions(value: string) {
    const match = value.match(/^(\d+)x(\d+)$/i);
    if (!match) return null;
    return { width: Number(match[1]), height: Number(match[2]) };
}

function validateImageSize(width: number, height: number) {
    if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) throw new Error(apiText("positiveImageDimensions"));
    if (width % IMAGE_SIZE_STEP !== 0 || height % IMAGE_SIZE_STEP !== 0) throw new Error(apiText("imageDimensionStep"));
    if (Math.max(width, height) > IMAGE_MAX_EDGE) throw new Error(apiText("imageEdgeLimit"));
    if (Math.max(width, height) / Math.min(width, height) > IMAGE_MAX_RATIO) throw new Error(apiText("imageRatioLimit"));
    const pixels = width * height;
    if (pixels < IMAGE_MIN_PIXELS || pixels > IMAGE_MAX_PIXELS) throw new Error(apiText("imagePixelLimit"));
}

function resolveGeminiImageConfig(config: AiConfig) {
    const plan = imagePlan(config);
    const image = {
        ...(plan.sizeField === "aspectRatio" && plan.sizeValue ? { aspectRatio: plan.sizeValue } : {}),
        ...(plan.quality?.param === "imageSize" ? { imageSize: plan.quality.value } : {}),
    };
    return Object.keys(image).length ? { imageConfig: image } : {};
}

function resolveImageSource(item: Record<string, unknown>) {
    if (typeof item.b64_json === "string" && item.b64_json) {
        return `data:image/png;base64,${item.b64_json}`;
    }
    if (typeof item.url === "string" && item.url) {
        return item.url;
    }
    return null;
}

function parseImagePayload(payload: ImageApiResponse) {
    if (typeof payload.code === "number" && payload.code !== 0) {
        throw generationError({ outcome: "rejected" }, payload.msg || apiText("requestFailed"));
    }
    // Support data, images, and results response fields used by different APIs.
    const imageList = payload.data
        || (payload as Record<string, unknown>).images as Array<Record<string, unknown>> | undefined
        || (payload as Record<string, unknown>).results as Array<Record<string, unknown>> | undefined
        || [];
    const images = imageList
        .map(resolveImageSource)
        .filter((value): value is string => Boolean(value))
        .map((dataUrl) => ({ id: nanoid(), dataUrl }));

    if (images.length === 0) {
        // Check whether the response contains data in an unrecognized format.
        const rawKeys = Object.keys(payload).filter((k) => k !== "code" && k !== "msg" && k !== "error");
        throw new Error(rawKeys.length > 0
            ? apiText("unknownImageResponse", { fields: rawKeys.join(", ") })
            : apiText("noImageReturned"));
    }

    return images;
}

function readApiErrorMessage(value: unknown): string {
    if (!value) return "";
    if (typeof value === "string") {
        // The value may be serialized JSON, such as error.message, or a plain-text error.
        try {
            const parsed = JSON.parse(value);
            const inner = readApiErrorMessage(parsed) || value;
            // Treat an empty parsed object such as "{}" as having no useful message.
            if (inner === value && typeof parsed === "object" && Object.keys(parsed).length === 0) return "";
            return inner;
        } catch {
            // Detect HTML error pages.
            if (/<[a-z][\s\S]*>/i.test(value)) return apiText("htmlError", { preview: `${value.slice(0, 80)}...` });
            return value;
        }
    }
    if (typeof value !== "object") return "";
    const payload = value as { msg?: unknown; message?: unknown; error?: unknown; detail?: unknown };
    // error may be a string or an object containing a message.
    const errorMsg =
        typeof payload.error === "string"
            ? payload.error
            : (payload.error as { message?: unknown })?.message;
    return (
        readApiErrorMessage(payload.msg) ||
        readApiErrorMessage(payload.message) ||
        readApiErrorMessage(errorMsg) ||
        readApiErrorMessage(payload.detail) ||
        ""
    );
}

function readAxiosError(error: unknown, fallback: string) {
    if (axios.isCancel(error)) return apiText("requestCanceled");
    if (axios.isAxiosError(error)) {
        if (error.code === "ECONNABORTED" || error.code === "ETIMEDOUT") return apiText("imageTimeout");
        if (!error.response && error.code === "ERR_NETWORK") return apiText("networkOrCors"); // [dianran] CORS / network hint
        const responseData = error.response?.data;
        // Prefer the API error from the response body.
        const apiMsg = readApiErrorMessage(responseData);
        if (apiMsg) return apiMsg;
        // Infer the error from the HTTP status when the response body has no usable message.
        const statusMsg = readStatusError(error.response?.status, fallback);
        if (statusMsg) return statusMsg;
        // Fall back to Axios's own error message.
        return error.message || fallback;
    }
    if (error instanceof DOMException && error.name === "AbortError") return apiText("requestCanceled");
    return error instanceof Error ? readApiErrorMessage(error.message) || error.message : fallback;
}

function readStatusError(status: number | undefined, fallback: string) {
    if (status === 401 || status === 403) return apiText("authenticationFailed");
    if (status === 429) return apiText("rateLimited");
    if (status === 404) return apiText("notFound");
    if (status === 502) return apiText("badGateway");
    if (status === 503) return apiText("serviceBusy");
    return status ? apiText("httpFailed", { status }) : fallback;
}

// ---- [dianran] Responses API -> Chat Completions fallback (SiliconFlow, OpenRouter, many relays) ----
class ApiStatusError extends Error {
    constructor(message: string, readonly status: number) {
        super(message);
    }
}

/** Base URLs that proved to need /chat/completions in this session (auto-detected after a 404 / unsupported reply). */
const chatTextHosts = new Set<string>();
const chatImageHosts = new Set<string>();
const hostKey = (config: Pick<AiConfig, "baseUrl">) => config.baseUrl.trim().replace(/\/+$/, "").toLowerCase();

function prefersChatText(config: AiConfig) {
    return presetApiFlags(config.baseUrl).textApi === "chat" || chatTextHosts.has(hostKey(config));
}

function imageApiOf(config: AiConfig) {
    return chatImageHosts.has(hostKey(config)) ? "chat" : presetApiFlags(config.baseUrl).imageApi || "openai";
}

/** 404 / 405 / 501, or a 400 that says the endpoint itself is unknown -> the provider lacks this API, try the other one. */
function isUnsupportedEndpoint(error: unknown) {
    const status = error instanceof ApiStatusError ? error.status : axios.isAxiosError(error) ? error.response?.status : undefined;
    if (status === 404 || status === 405 || status === 501) return true;
    const text = error instanceof Error ? error.message : "";
    return status === 400 && /(unknown|unsupported|not supported|invalid).{0,20}(url|endpoint|path|route|api)|no route|responses api/i.test(text);
}

async function requestStreamingChat(config: AiConfig, messages: AiTextMessage[], onDelta?: (text: string) => void, options?: RequestOptions): Promise<string> {
    const response = await proxyFetch(aiApiUrl(config, "/chat/completions"), {
        method: "POST",
        headers: { ...aiHeaders(config, "application/json"), Accept: "text/event-stream" },
        body: JSON.stringify({ model: config.model, messages, stream: true, ...(config.reasoningEffort === "auto" ? {} : { reasoning_effort: config.reasoningEffort }) }),
        signal: options?.signal,
    });
    if (!response.ok) throw new ApiStatusError(await readFetchError(response, apiText("requestFailed")), response.status);
    if (!response.body || !(response.headers.get("content-type") || "").includes("event-stream")) {
        const payload = (await response.json()) as { choices?: Array<{ message?: { content?: string } }>; error?: { message?: string } };
        if (payload.error?.message) throw generationError({ outcome: "rejected" }, payload.error.message);
        const text = payload.choices?.[0]?.message?.content || "";
        onDelta?.(text);
        return text;
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let text = "";
    const consume = (line: string) => {
        if (!line.startsWith("data:")) return;
        const data = line.slice(5).trim();
        if (!data || data === "[DONE]") return;
        const event = JSON.parse(data) as { choices?: Array<{ delta?: { content?: string } }>; error?: { message?: string } };
        if (event.error?.message) throw new Error(event.error.message);
        const delta = event.choices?.[0]?.delta?.content;
        if (delta) {
            text += delta;
            onDelta?.(text);
        }
    };
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() || "";
        lines.forEach(consume);
    }
    consume((buffer + decoder.decode()).trim());
    return text;
}

type ChatImagePayload = { choices?: Array<{ message?: { content?: unknown; images?: Array<{ image_url?: { url?: string }; url?: string }> } }>; error?: { message?: string } };

/** Image generation through /chat/completions with modalities (OpenRouter style). */
async function requestChatImages(config: AiConfig, prompt: string, references: ReferenceImage[], count: number, options?: RequestOptions) {
    const refs = await Promise.all(references.map((image) => prepareGenerationInput(() => imageToDataUrl(image))));
    const content = [{ type: "text", text: withSystemPrompt(config, prompt) }, ...refs.map((url) => ({ type: "image_url", image_url: { url } }))];
    const once = async () => {
        const response = await axios.post<ChatImagePayload>(aiApiUrl(config, "/chat/completions"), { model: config.model, messages: [{ role: "user", content }], modalities: ["image", "text"] }, { headers: aiHeaders(config, "application/json"), signal: options?.signal, timeout: IMAGE_REQUEST_TIMEOUT_MS });
        if (response.data.error?.message) throw generationError({ outcome: "rejected" }, response.data.error.message);
        const message = response.data.choices?.[0]?.message;
        const urls = (message?.images || []).map((image) => image.image_url?.url || image.url || "").filter(Boolean);
        if (!urls.length && Array.isArray(message?.content)) {
            (message.content as Array<{ type?: string; image_url?: { url?: string } }>).forEach((part) => part.type === "image_url" && part.image_url?.url && urls.push(part.image_url.url));
        }
        if (!urls.length) throw new Error(apiText("noImageReturned"));
        return urls.map((dataUrl) => ({ id: nanoid(), dataUrl }));
    };
    return (await Promise.all(Array.from({ length: count }, once))).flat();
}

/** SiliconFlow /images/generations body: image_size + batch_size (+ image for edits). */
async function requestSiliconFlowImages(config: AiConfig, prompt: string, references: ReferenceImage[], count: number, requestSize: string | undefined, options?: RequestOptions) {
    const image = references[0] ? await imageToDataUrl(references[0]) : undefined;
    const response = await axios.post<ImageApiResponse>(
        aiApiUrl(config, "/images/generations"),
        { model: config.model, prompt: withSystemPrompt(config, prompt), batch_size: Math.min(4, count), ...(requestSize && /^\d+x\d+$/.test(requestSize) ? { image_size: requestSize } : {}), ...(image ? { image } : {}) },
        { headers: aiHeaders(config, "application/json"), signal: options?.signal, timeout: IMAGE_REQUEST_TIMEOUT_MS },
    );
    return parseImagePayload(response.data);
}

/** Run the OpenAI-style image call; providers flagged (or detected) as siliconflow/chat use their own endpoint. */
async function requestOpenAiCompatibleImages(config: AiConfig, prompt: string, references: ReferenceImage[], count: number, requestSize: string | undefined, standard: () => Promise<Array<{ id: string; dataUrl: string }>>, options?: RequestOptions) {
    const api = imageApiOf(config);
    if (api === "siliconflow") return requestSiliconFlowImages(config, prompt, references, count, requestSize, options);
    if (api === "chat") return requestChatImages(config, prompt, references, count, options);
    try {
        return await standard();
    } catch (error) {
        if (!isUnsupportedEndpoint(error)) throw error;
        try {
            const images = await requestChatImages(config, prompt, references, count, options);
            chatImageHosts.add(hostKey(config));
            return images;
        } catch (fallbackError) {
            throw fallbackError; // Preserve the actual last attempt, which may have been accepted before response loss.
        }
    }
}

function withSystemPrompt(config: AiConfig, prompt: string) {
    const systemPrompt = config.systemPrompt.trim();
    return systemPrompt ? `${systemPrompt}\n\n${prompt}` : prompt;
}

function aiApiUrl(config: AiConfig, path: string) {
    return buildApiUrl(config.baseUrl, path);
}

function aiHeaders(config: AiConfig, contentType?: string) {
    return {
        Authorization: `Bearer ${config.apiKey}`,
        ...(contentType ? { "Content-Type": contentType } : {}),
    };
}

function geminiBaseUrl(config: Pick<AiConfig, "baseUrl">) {
    const normalizedBaseUrl = config.baseUrl.trim().replace(/\/+$/, "");
    const lowerBaseUrl = normalizedBaseUrl.toLowerCase();
    return lowerBaseUrl.endsWith("/v1") || lowerBaseUrl.endsWith("/v1beta") ? normalizedBaseUrl : `${normalizedBaseUrl}/v1beta`;
}

function geminiModelName(model: string) {
    return model.trim().replace(/^models\//, "");
}

function geminiApiUrl(config: Pick<AiConfig, "baseUrl" | "model">, action?: "generateContent" | "streamGenerateContent") {
    const baseUrl = geminiBaseUrl(config);
    if (!action) return withLocalProxy(`${baseUrl}/models`);
    return withLocalProxy(`${baseUrl}/models/${encodeURIComponent(geminiModelName(config.model))}:${action}`);
}

function geminiHeaders(config: Pick<AiConfig, "apiKey">) {
    return {
        "x-goog-api-key": config.apiKey,
        "Content-Type": "application/json",
    };
}

function withSystemMessage<T extends ResponseInputMessage>(config: AiConfig, messages: T[]): ResponseInputMessage[] {
    const systemPrompt = config.systemPrompt.trim();
    return systemPrompt ? [{ role: "system" as const, content: systemPrompt }, ...messages] : messages;
}

function toResponseInput(messages: ResponseInputMessage[]): ResponseInputItem[] {
    return messages.flatMap((message): ResponseInputItem[] => {
        if ("type" in message) return [message];
        if (message.role === "tool") return [{ type: "function_call_output", call_id: message.tool_call_id, output: message.content }];
        return [{ role: message.role, content: toResponseContent(message.content || "") }];
    });
}

function toResponseContent(content: ResponseMessageContent): string | ResponseInputContent[] {
    if (!Array.isArray(content)) return String(content || "");
    return content.map((item) => (item.type === "text" ? { type: "input_text" as const, text: item.text } : { type: "input_image" as const, image_url: item.image_url.url }));
}

function toResponseTool(tool: ResponseFunctionTool): ResponseApiToolDefinition {
    return {
        type: "function",
        name: tool.function.name,
        description: tool.function.description,
        parameters: tool.function.parameters,
        strict: tool.function.strict,
    };
}

function parseToolResponse(payload: ResponseApiPayload): ToolResponseResult {
    const output = payload.output || [];
    const content =
        payload.output_text ||
        output
            .flatMap((item) => (item.type === "message" ? item.content || [] : []))
            .map((item) => item.text || "")
            .join("");
    const toolCalls = output
        .filter((item): item is Extract<ResponseApiOutputItem, { type?: "function_call" }> => item.type === "function_call")
        .map((item) => ({
            id: item.call_id || item.id || "",
            type: "function" as const,
            function: { name: item.name || "", arguments: item.arguments || "{}" },
        }))
        .filter((item) => item.id && item.function.name);
    return { content, toolCalls };
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function responseErrorMessage(value: unknown) {
    if (!isRecord(value)) return "";
    const error = isRecord(value.error) ? value.error : undefined;
    const response = isRecord(value.response) ? value.response : undefined;
    const responseError = response && isRecord(response.error) ? response.error : undefined;
    return stringValue(value.msg) || stringValue(error?.message) || stringValue(responseError?.message);
}

function stringValue(value: unknown) {
    return typeof value === "string" ? value : "";
}

function validateResponsePayload(payload: ResponseApiPayload) {
    if (typeof payload.code === "number" && payload.code !== 0) throw generationError({ outcome: "rejected" }, payload.msg || apiText("requestFailed"));
    if (payload.error?.message) throw generationError({ outcome: "rejected" }, payload.error.message);
}

function validateGeminiPayload(payload: GeminiPayload) {
    if (payload.error?.message) throw generationError({ outcome: "rejected" }, payload.error.message);
    if (payload.promptFeedback?.blockReason) throw generationError({ outcome: "rejected" }, apiText("geminiRejected", { reason: payload.promptFeedback.blockReason }));
}

async function readFetchError(response: Response, fallback: string) {
    const text = await response.text();
    if (!text) return readStatusError(response.status, fallback);
    try {
        return responseErrorMessage(JSON.parse(text)) || readStatusError(response.status, fallback);
    } catch {
        return text.slice(0, 300) || readStatusError(response.status, fallback);
    }
}

function consumeResponseStreamBlock(block: string, state: ResponseStreamState, onDelta?: (text: string) => void) {
    const data = block
        .split(/\r?\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).replace(/^ /, ""))
        .join("\n")
        .trim();
    if (!data || data === "[DONE]") return;
    const event = JSON.parse(data) as Record<string, unknown>;
    const type = stringValue(event.type);
    const errorMessage = responseErrorMessage(event);
    if (errorMessage) state.error = errorMessage;
    if (type === "response.output_text.delta" && typeof event.delta === "string") {
        state.text += event.delta;
        onDelta?.(state.text);
    }
    if (type === "response.output_text.done" && !state.text && typeof event.text === "string") {
        state.text = event.text;
        onDelta?.(state.text);
    }
    if (type === "response.completed" && isRecord(event.response)) {
        state.payload = event.response as ResponseApiPayload;
    } else if (Array.isArray(event.output)) {
        state.payload = event as ResponseApiPayload;
    }
}

function consumeResponseStreamText(state: ResponseStreamState, text: string, onDelta?: (text: string) => void, flush = false) {
    state.buffer += text;
    for (;;) {
        const match = state.buffer.match(/\r?\n\r?\n/);
        if (!match) break;
        const index = match.index ?? 0;
        consumeResponseStreamBlock(state.buffer.slice(0, index), state, onDelta);
        state.buffer = state.buffer.slice(index + match[0].length);
    }
    if (flush && state.buffer.trim()) {
        consumeResponseStreamBlock(state.buffer, state, onDelta);
        state.buffer = "";
    }
}

async function requestStreamingResponse(config: AiConfig, body: Record<string, unknown>, onDelta?: (text: string) => void, options?: RequestOptions): Promise<ToolResponseResult> {
    const response = await proxyFetch(aiApiUrl(config, "/responses"), {
        method: "POST",
        headers: { ...aiHeaders(config, "application/json"), Accept: "text/event-stream" },
        body: JSON.stringify({ ...body, stream: true }),
        signal: options?.signal,
    });
    if (!response.ok) throw new ApiStatusError(await readFetchError(response, apiText("requestFailed")), response.status);
    if (!response.body) {
        const payload = (await response.json()) as ResponseApiPayload;
        validateResponsePayload(payload);
        return parseToolResponse(payload);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const state: ResponseStreamState = { buffer: "", text: "" };
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        consumeResponseStreamText(state, decoder.decode(value, { stream: true }), onDelta);
        if (state.error) throw new Error(state.error);
    }
    consumeResponseStreamText(state, decoder.decode(), onDelta, true);
    if (state.error) throw new Error(state.error);
    if (!state.payload) return { content: state.text, toolCalls: [] };
    validateResponsePayload(state.payload);
    const result = parseToolResponse(state.payload);
    return { ...result, content: state.text || result.content };
}

function toGeminiBody(config: AiConfig, messages: ResponseInputMessage[], extra?: Record<string, unknown>) {
    const systemText = [
        config.systemPrompt.trim(),
        ...messages.flatMap((message) => (!("type" in message) && message.role === "system" ? [geminiTextContent(message.content)] : [])),
    ]
        .filter(Boolean)
        .join("\n\n");
    const contents = toGeminiContents(messages.filter((message) => ("type" in message ? true : message.role !== "system")));
    return {
        contents,
        ...(systemText ? { systemInstruction: { parts: [{ text: systemText }] } } : {}),
        ...extra,
    };
}

function toGeminiContents(messages: ResponseInputMessage[]): GeminiContent[] {
    const callNameById = new Map<string, string>();
    return messages.flatMap((message): GeminiContent[] => {
        if ("type" in message) {
            callNameById.set(message.call_id, message.name);
            return [{ role: "model", parts: [{ functionCall: { id: message.call_id, name: message.name, args: jsonObject(message.arguments) }, ...(message.thoughtSignature ? { thoughtSignature: message.thoughtSignature } : {}) }] }];
        }
        if (message.role === "tool") {
            const name = callNameById.get(message.tool_call_id) || "tool_result";
            return [{ role: "user", parts: [{ functionResponse: { id: message.tool_call_id, name, response: { result: jsonValue(message.content) } } }] }];
        }
        return [{ role: message.role === "assistant" ? "model" : "user", parts: toGeminiParts(message.content) }];
    });
}

function toGeminiParts(content: ResponseMessageContent): GeminiPart[] {
    if (!Array.isArray(content)) return [{ text: String(content || "") }];
    return content.map((item) => (item.type === "text" ? { text: item.text } : toGeminiImagePart(item.image_url.url)));
}

function toGeminiImagePart(url: string): GeminiPart {
    const match = url.match(/^data:([^;,]+);base64,(.+)$/);
    if (match) return { inlineData: { mimeType: match[1], data: match[2] } };
    return { fileData: { fileUri: url, mimeType: "image/png" } };
}

function geminiTextContent(content: ResponseMessageContent) {
    if (!Array.isArray(content)) return String(content || "");
    return content.map((item) => (item.type === "text" ? item.text : item.image_url.url)).join("\n");
}

function jsonObject(value: string): Record<string, unknown> {
    const parsed = jsonValue(value);
    return isRecord(parsed) ? parsed : {};
}

function jsonValue(value: string): unknown {
    try {
        return JSON.parse(value);
    } catch {
        return value;
    }
}

function toGeminiToolOptions(tools: ResponseFunctionTool[], toolChoice: ToolChoice) {
    if (!tools.length) return {};
    const functionDeclarations = tools.map((tool) => ({
        name: tool.function.name,
        description: tool.function.description,
        parameters: tool.function.parameters,
    }));
    const functionCallingConfig =
        typeof toolChoice === "object"
            ? { mode: "ANY", allowedFunctionNames: [toolChoice.name] }
            : { mode: toolChoice === "required" ? "ANY" : "AUTO" };
    return {
        tools: [{ functionDeclarations }],
        toolConfig: { functionCallingConfig },
    };
}

async function requestGeminiStreamingResponse(config: AiConfig, body: Record<string, unknown>, onDelta?: (text: string) => void, options?: RequestOptions): Promise<ToolResponseResult> {
    const response = await proxyFetch(`${geminiApiUrl(config, "streamGenerateContent")}?alt=sse`, {
        method: "POST",
        headers: geminiHeaders(config),
        body: JSON.stringify(body),
        signal: options?.signal,
    });
    if (!response.ok) throw new ApiStatusError(await readFetchError(response, apiText("requestFailed")), response.status);
    if (!response.body) {
        const payload = (await response.json()) as GeminiPayload;
        return parseGeminiToolResponse(payload);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const state: GeminiStreamState = { buffer: "", text: "", toolCalls: [] };
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        consumeGeminiStreamText(state, decoder.decode(value, { stream: true }), onDelta);
        if (state.error) throw new Error(state.error);
    }
    consumeGeminiStreamText(state, decoder.decode(), onDelta, true);
    if (state.error) throw new Error(state.error);
    return { content: state.text, toolCalls: state.toolCalls };
}

function consumeGeminiStreamText(state: GeminiStreamState, text: string, onDelta?: (text: string) => void, flush = false) {
    state.buffer += text;
    for (;;) {
        const match = state.buffer.match(/\r?\n\r?\n/);
        if (!match) break;
        const index = match.index ?? 0;
        consumeGeminiStreamBlock(state.buffer.slice(0, index), state, onDelta);
        state.buffer = state.buffer.slice(index + match[0].length);
    }
    if (flush && state.buffer.trim()) {
        consumeGeminiStreamBlock(state.buffer, state, onDelta);
        state.buffer = "";
    }
}

function consumeGeminiStreamBlock(block: string, state: GeminiStreamState, onDelta?: (text: string) => void) {
    const data = block
        .split(/\r?\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).replace(/^ /, ""))
        .join("\n")
        .trim();
    if (!data || data === "[DONE]") return;
    const result = parseGeminiToolResponse(JSON.parse(data) as GeminiPayload);
    if (result.content) {
        state.text += result.content;
        onDelta?.(state.text);
    }
    state.toolCalls.push(...result.toolCalls);
}

function parseGeminiToolResponse(payload: GeminiPayload): ToolResponseResult {
    validateGeminiPayload(payload);
    const parts = payload.candidates?.flatMap((candidate) => candidate.content?.parts || []) || [];
    const content = parts.map((part) => part.text || "").join("");
    const toolCalls = parts
        .map((part) => part.functionCall)
        .filter((call): call is NonNullable<GeminiPart["functionCall"]> => Boolean(call?.name))
        .map((call) => {
            const part = parts.find((item) => item.functionCall === call);
            const thoughtSignature = part?.thoughtSignature || part?.thought_signature;
            return {
                id: call.id || nanoid(),
                type: "function" as const,
                function: { name: call.name || "", arguments: JSON.stringify(call.args || {}) },
                ...(thoughtSignature ? { thoughtSignature } : {}),
            };
        });
    return { content, toolCalls };
}

async function requestGeminiImages(config: AiConfig, prompt: string, references: ReferenceImage[], count: number, options?: RequestOptions) {
    const requests = Array.from({ length: count }, () => requestGeminiImagesOnce(config, prompt, references, options));
    return (await Promise.all(requests)).flat();
}

async function requestGeminiImagesOnce(config: AiConfig, prompt: string, references: ReferenceImage[], options?: RequestOptions) {
    const parts: GeminiPart[] = [{ text: prompt }];
    for (const image of references) {
        parts.push(toGeminiImagePart(await prepareGenerationInput(() => imageToDataUrl(image))));
    }
    const response = await axios.post<GeminiPayload>(
        geminiApiUrl(config, "generateContent"),
        {
            ...toGeminiBody(config, [{ role: "user", content: prompt }], { generationConfig: { responseModalities: ["TEXT", "IMAGE"], ...resolveGeminiImageConfig(config) } }),
            contents: [{ role: "user", parts }],
        },
        { headers: geminiHeaders(config), signal: options?.signal, timeout: IMAGE_REQUEST_TIMEOUT_MS },
    );
    return parseGeminiImagePayload(response.data);
}

function parseGeminiImagePayload(payload: GeminiPayload) {
    validateGeminiPayload(payload);
    const images =
        payload.candidates
            ?.flatMap((candidate) => candidate.content?.parts || [])
            .map((part) => {
                const inlineData = part.inlineData || (part.inline_data ? { mimeType: part.inline_data.mimeType || part.inline_data.mime_type, data: part.inline_data.data } : undefined);
                if (inlineData?.data) return `data:${inlineData.mimeType || "image/png"};base64,${inlineData.data}`;
                return part.fileData?.fileUri || null;
            })
            .filter((value): value is string => Boolean(value))
            .map((dataUrl) => ({ id: nanoid(), dataUrl })) || [];
    if (!images.length) throw new Error(apiText("geminiNoImage"));
    return images;
}

async function requestGenerationOwned(config: AiConfig, prompt: string, options?: RequestOptions) {
    const requestConfig = resolveModelRequestConfig(config, config.model || config.imageModel);
    const n = Math.max(1, Math.min(15, Math.floor(Math.abs(Number(config.count)) || 1)));
    const script = resolveModelScript(config, config.model || config.imageModel);
    if (script) {
        const plan = imagePlan(requestConfig);
        ensureImagePlan(plan);
        try {
            const result = await runModelPlugin({
                capability: "image",
                script,
                config: requestConfig,
                prompt: withSystemPrompt(requestConfig, prompt),
                images: [],
                params: pluginImageParams(plan, n),
                signal: options?.signal,
            });
            return normalizePluginImages(result).map((dataUrl) => ({ id: nanoid(), dataUrl }));
        } catch (error) {
            throw generationError(error, readAxiosError(error, apiText("requestFailed")));
        }
    }
    if (requestConfig.apiFormat === "gemini") {
        try {
            return await requestGeminiImages(requestConfig, prompt, [], n, options);
        } catch (error) {
            throw generationError(error, readAxiosError(error, apiText("requestFailed")));
        }
    }
    const plan = imagePlan(requestConfig);
    ensureImagePlan(plan);
    const fields = openAiImageFields(plan);
    const requestSize = plan.sizeField === "size" || plan.sizeField === "image_size" ? plan.sizeValue : undefined;
    try {
        return await requestOpenAiCompatibleImages(requestConfig, prompt, [], n, requestSize, async () => {
            const response = await axios.post<ImageApiResponse>(
                aiApiUrl(requestConfig, "/images/generations"),
                {
                    model: requestConfig.model,
                    prompt: withSystemPrompt(requestConfig, prompt),
                    n,
                    ...fields,
                    // gpt-image models reject response_format; they always return b64.
                    ...(/gpt-image/.test(requestConfig.model) ? {} : { response_format: "b64_json" }),
                    output_format: IMAGE_OUTPUT_FORMAT,
                },
                {
                    headers: aiHeaders(requestConfig, "application/json"),
                    signal: options?.signal,
                    timeout: IMAGE_REQUEST_TIMEOUT_MS,
                },
            );
            return parseImagePayload(response.data);
        }, options);
    } catch (error) {
        throw generationError(error, readAxiosError(error, apiText("requestFailed")));
    }
}

async function requestEditOwned(config: AiConfig, prompt: string, references: ReferenceImage[], options?: RequestOptions) {
    const requestConfig = resolveModelRequestConfig(config, config.model || config.imageModel);
    const n = Math.max(1, Math.min(15, Math.floor(Math.abs(Number(config.count)) || 1)));
    const requestPrompt = buildImageReferencePromptText(prompt, references);
    const script = resolveModelScript(config, config.model || config.imageModel);
    if (script) {
        const plan = imagePlan(requestConfig);
        ensureImagePlan(plan);
        const refs = await Promise.all(references.map((image) => prepareGenerationInput(() => imageToDataUrl(image))));
        try {
            const result = await runModelPlugin({
                capability: "image",
                script,
                config: requestConfig,
                prompt: withSystemPrompt(requestConfig, requestPrompt),
                images: refs,
                params: pluginImageParams(plan, n),
                signal: options?.signal,
            });
            return normalizePluginImages(result).map((dataUrl) => ({ id: nanoid(), dataUrl }));
        } catch (error) {
            throw generationError(error, readAxiosError(error, apiText("requestFailed")));
        }
    }
    if (requestConfig.apiFormat === "gemini") {
        try {
            return await requestGeminiImages(requestConfig, requestPrompt, references, n, options);
        } catch (error) {
            throw generationError(error, readAxiosError(error, apiText("requestFailed")));
        }
    }

    const plan = imagePlan(requestConfig);
    ensureImagePlan(plan);
    const fields = openAiImageFields(plan);
    const requestSize = plan.sizeField === "size" || plan.sizeField === "image_size" ? plan.sizeValue : undefined;
    const formData = new FormData();
    formData.set("model", requestConfig.model);
    formData.set("prompt", withSystemPrompt(requestConfig, requestPrompt));
    formData.set("n", String(n));
    // gpt-image models reject response_format; they always return b64.
    if (!/gpt-image/.test(requestConfig.model)) {
        formData.set("response_format", "b64_json");
    }
    formData.set("output_format", IMAGE_OUTPUT_FORMAT);
    Object.entries(fields).forEach(([key, value]) => formData.set(key, value));
    const files = await Promise.all(references.map(async (image) => dataUrlToFile({ ...image, dataUrl: await prepareGenerationInput(() => imageToDataUrl(image)) })));
    const imageField = files.length > 1 ? "image[]" : "image";
    files.forEach((file) => formData.append(imageField, file));

    try {
        return await requestOpenAiCompatibleImages(requestConfig, requestPrompt, references, n, requestSize, async () => {
            const response = await axios.post<ImageApiResponse>(aiApiUrl(requestConfig, "/images/edits"), formData, { headers: aiHeaders(requestConfig), signal: options?.signal, timeout: IMAGE_REQUEST_TIMEOUT_MS });
            return parseImagePayload(response.data);
        }, options);
    } catch (error) {
        throw generationError(error, readAxiosError(error, apiText("requestFailed")));
    }
}

async function requestImageQuestionOwned(config: AiConfig, messages: AiTextMessage[], onDelta: (text: string) => void, options?: RequestOptions) {
    const requestConfig = resolveModelRequestConfig(config, config.model || config.textModel);
    const script = resolveModelScript(config, config.model || config.textModel);
    if (script) {
        try {
            const answer = await runModelPlugin<string>({
                capability: "text",
                script,
                config: requestConfig,
                messages: withSystemMessage(requestConfig, messages),
                signal: options?.signal,
                onDelta,
            });
            const text = String(answer ?? "").trim();
            if (!text) throw new Error(apiText("noContent"));
            return text;
        } catch (error) {
            throw generationError(error, readAxiosError(error, apiText("requestFailed")));
        }
    }
    try {
        if (requestConfig.apiFormat === "gemini") {
            const answer = (await requestGeminiStreamingResponse(requestConfig, toGeminiBody(requestConfig, messages), onDelta, options)).content;
            if (!answer.trim()) throw new Error(apiText("noContent"));
            return answer;
        }
        const chatMessages = withSystemMessage(requestConfig, messages) as AiTextMessage[];
        const viaChat = () => requestStreamingChat(requestConfig, chatMessages, onDelta, options);
        let answer = "";
        if (prefersChatText(requestConfig)) answer = await viaChat();
        else {
            try {
                answer = (await requestStreamingResponse(requestConfig, {
                    model: requestConfig.model,
                    input: toResponseInput(chatMessages),
                    ...(requestConfig.reasoningEffort === "auto" ? {} : { reasoning: { effort: requestConfig.reasoningEffort } }),
                }, onDelta, options)).content;
            } catch (error) {
                // [dianran] Provider without the Responses API: retry once on /chat/completions and remember the choice.
                if (!isUnsupportedEndpoint(error)) throw error;
                try {
                    answer = await viaChat();
                } catch (fallbackError) {
                    throw fallbackError;
                }
                chatTextHosts.add(hostKey(requestConfig));
            }
        }
        if (!answer.trim()) throw new Error(apiText("noContent"));
        return answer;
    } catch (error) {
        throw generationError(error, readAxiosError(error, apiText("requestFailed")));
    }
}

export async function fetchImageModels(config: Pick<AiConfig, "baseUrl" | "apiKey" | "apiFormat">) {
    try {
        if (config.apiFormat === "gemini") {
            const response = await axios.get<GeminiPayload>(geminiApiUrl({ ...defaultGeminiConfig, ...config }), { headers: geminiHeaders({ ...defaultGeminiConfig, ...config }) });
            validateGeminiPayload(response.data);
            return (response.data.models || [])
                .map((model) => model.name?.replace(/^models\//, ""))
                .filter((id): id is string => Boolean(id))
                .sort((a, b) => a.localeCompare(b));
        }
        const response = await axios.get<{ data?: Array<{ id?: string }>; error?: { message?: string } }>(buildApiUrl(config.baseUrl, "/models"), {
            headers: {
                Authorization: `Bearer ${config.apiKey}`,
            },
        });
        return (response.data.data || [])
            .map((model) => model.id)
            .filter((id): id is string => Boolean(id))
            .sort((a, b) => a.localeCompare(b));
    } catch (error) {
        throw new Error(readAxiosError(error, apiText("modelReadFailed")));
    }
}

export async function fetchChannelModels(channel: ModelChannel) {
    try {
        const models = await fetchImageModels({ baseUrl: channel.baseUrl, apiKey: channel.apiKey, apiFormat: channel.apiFormat });
        await recordCapabilityEvidence(channel, "models", "").catch(() => {});
        return models;
    } catch (error) {
        await recordCapabilityEvidence(channel, "models", "", error instanceof Error ? error.message : "模型读取失败").catch(() => {});
        throw error;
    }
}

const defaultGeminiConfig: Pick<AiConfig, "baseUrl" | "apiKey" | "apiFormat" | "model" | "systemPrompt"> = {
    baseUrl: "https://generativelanguage.googleapis.com",
    apiKey: "",
    apiFormat: "gemini",
    model: "",
    systemPrompt: "",
};

export const requestGeneration = businessOperation((...args: Parameters<typeof requestGenerationOwned>) => observeGeneration(args[0], "image", args[0].model || args[0].imageModel, () => requestGenerationOwned(...args)));

export const requestEdit = businessOperation((...args: Parameters<typeof requestEditOwned>) => observeGeneration(args[0], "image", args[0].model || args[0].imageModel, () => requestEditOwned(...args)));

export const requestImageQuestion = businessOperation((...args: Parameters<typeof requestImageQuestionOwned>) => observeGeneration(args[0], "text", args[0].model || args[0].textModel, () => requestImageQuestionOwned(...args)));
