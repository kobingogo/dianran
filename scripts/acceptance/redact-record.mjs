import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
const MODES = ["image", "video", "text", "audio", "agent", "mobile", "docker"];
const STATES = ["not-run", "pending", "success", "failure", "unknown"];
const PARAMS = ["size", "quality", "count", "background", "seconds", "vquality", "videoMode", "audioVoice", "audioFormat", "audioSpeed", "reasoningEffort", "generateAudio", "watermark"];
function alias(value) { return typeof value === "string" && value ? createHash("sha256").update(value).digest("hex") : undefined; }
function scalar(value) { return typeof value === "string" || typeof value === "boolean" || typeof value === "number" && Number.isFinite(value) ? value : undefined; }
function origin(value) { try { const url = new URL(value); return ["https:", "http:"].includes(url.protocol) ? url.origin : undefined; } catch { return undefined; } }
/** Explicit allowlist: never copy request/response bodies, prompts, headers, URLs, files or raw identities. */
export function redactAcceptanceRecord(input) {
    if (!input || typeof input !== "object" || !MODES.includes(input.mode)) throw new Error("请提供明确的验收模式");
    const parameters = Object.fromEntries(PARAMS.filter((key) => scalar(input.parameters?.[key]) !== undefined).map((key) => [key, input.parameters[key]]));
    return {
        schema: "dianran-acceptance-redacted-v1",
        evidence: "user-supplied-record-needs-review",
        mode: input.mode,
        state: STATES.includes(input.state) ? input.state : "not-run",
        environment: { channelOrigin: origin(input.baseUrl), model: scalar(input.model), browser: scalar(input.browser), device: scalar(input.device), gitCommit: /^[a-f0-9]{40}$/.test(input.gitCommit || "") ? input.gitCommit : undefined },
        identities: Object.fromEntries(["taskId", "threadId", "turnId", "itemId", "channelId"].filter((key) => alias(input[key])).map((key) => [key, alias(input[key])])),
        parameters,
        observations: { referenceCount: Number.isInteger(input.referenceCount) && input.referenceCount >= 0 ? input.referenceCount : undefined, outputCount: Number.isInteger(input.outputCount) && input.outputCount >= 0 ? input.outputCount : undefined, postCount: Number.isInteger(input.postCount) && input.postCount >= 0 ? input.postCount : undefined, queryCount: Number.isInteger(input.queryCount) && input.queryCount >= 0 ? input.queryCount : undefined, mediaRestored: typeof input.mediaRestored === "boolean" ? input.mediaRestored : undefined },
    };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    const [inputPath, outputPath] = process.argv.slice(2);
    if (!inputPath || !outputPath) throw new Error("用法：node scripts/acceptance/redact-record.mjs 原始记录.json 脱敏记录.json");
    const record = redactAcceptanceRecord(JSON.parse(readFileSync(inputPath, "utf8")));
    writeFileSync(outputPath, JSON.stringify(record, null, 2) + "\n", { flag: "wx", mode: 0o600 });
}
