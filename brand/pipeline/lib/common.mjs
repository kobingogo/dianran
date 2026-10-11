// [dianran] Shared helpers for the prompt-library pipeline (paths, JSON IO, model labels, content filters, scoring).
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const PIPELINE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const CODE_ROOT = resolve(PIPELINE_DIR, "../..");
if (!process.env.DIANRAN_PROMPT_PIPELINE_ROOT) throw new Error("请设置 DIANRAN_PROMPT_PIPELINE_ROOT 指向独立提示词资源仓库");
export const ROOT = realpathSync(resolve(process.env.DIANRAN_PROMPT_PIPELINE_ROOT));
if (ROOT === realpathSync(CODE_ROOT) || execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd: ROOT, encoding: "utf8" }).trim() !== ROOT) throw new Error("提示词资源路径必须是独立 Git 仓库根目录，不能使用点染主仓库");
export const LIB_DIR = resolve(ROOT, "prompt-sources");
export const COVER_DIR = resolve(LIB_DIR, "covers");
export const CANDIDATE_DIR = resolve(ROOT, "candidates");
export const DATA_DIR = resolve(ROOT, "data");
export const REPORT_DIR = resolve(ROOT, "reports");

export const readJson = (path, fallback) => (existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : fallback);
export function writeJson(path, value, pretty = true) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, pretty ? JSON.stringify(value, null, 2) + "\n" : JSON.stringify(value));
}
export const config = (name) => readJson(resolve(PIPELINE_DIR, "config", name));
export const libPath = (id) => resolve(LIB_DIR, `${id}.json`);
export const nowIso = () => new Date().toISOString();
export const today = () => new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Taipei" }).format(new Date());
export const log = (...args) => console.log(`[${new Date().toLocaleTimeString("sv-SE", { timeZone: process.env.TZ || "Asia/Taipei" })}]`, ...args);

// Libraries the pipeline maintains, with their origin.
export function libraries() {
    const gh = config("github-sources.json").sources;
    return [
        { id: "x-trending", name: "X 热门", source: "x" },
        { id: "civitai-trending", name: "Civitai 热门", source: "civitai" },
        ...gh.map((s) => ({ id: s.id, name: s.name, source: "github", repo: s.repo, license: s.license })),
    ];
}

// ---------- model labels ----------
const MODEL_RULES = [
    ["Seedance", /seedance/i], ["Kling", /kling|可灵/i], ["Veo", /\bveo\b|veo ?3/i], ["Hailuo", /hailuo|海螺/i], ["Sora", /\bsora\b/i],
    ["Wan", /\bwan(?: ?video| ?2| ?3)|万相/i],
    ["GPT Image", /gpt[\s\-—_]*image|gpt[\s\-]*4o|chatgpt|gpt-images|dall-?e/i],
    ["Nano Banana", /nano[\s\-]?banana|nanobanana|gemini|ai studio|🍌/i],
    ["Seedream", /seedream|即梦|jimeng|dreamina/i],
    ["Midjourney", /midjourney|--sref|--ar\b|\bniji\b|\bmj ?v?[78]/i],
    ["Flux", /\bflux/i], ["Qwen Image", /qwen[\s\-]*image|^qwen$/i], ["Grok Imagine", /grok ?imagine|\bgrok\b/i],
];
const LIB_DEFAULT_MODEL = { "banana-prompt-quicker": "Nano Banana", "dianran-picks": "通用" };

// Normalised model family used for scoring caps and the `model` field.
export function modelLabel(raw, libraryId = "") {
    let value = String(raw || "").trim();
    const half = value.length / 2;
    if (value.length > 1 && Number.isInteger(half) && value.slice(0, half) === value.slice(half)) value = value.slice(0, half);
    if (value) {
        if (/^gpt-?4o$/i.test(value)) return "GPT Image";
        for (const [label, rx] of MODEL_RULES) if (rx.test(value)) return label;
        return value;
    }
    return LIB_DEFAULT_MODEL[libraryId] || "";
}

// Detect a model from free text (X posts); video models win when the post carries a video.
export function detectModel(text, hasVideo) {
    const t = String(text || "").toLowerCase().replace(/@grok\b/g, "");
    const found = [];
    for (const [label, rx] of MODEL_RULES) {
        const m = t.match(rx);
        if (m) found.push({ at: m.index, label, video: ["Seedance", "Kling", "Veo", "Hailuo", "Sora", "Wan"].includes(label) });
    }
    if (!found.length) return "";
    const videos = found.filter((f) => f.video).sort((a, b) => a.at - b.at);
    if (hasVideo && videos.length) return videos[0].label;
    if (/nano ?banana|nanobanana/.test(t)) return "Nano Banana";
    for (const label of ["GPT Image", "Seedream", "Midjourney", "Flux", "Qwen Image", "Nano Banana", "Grok Imagine"]) if (found.some((f) => f.label === label)) return label;
    return found.sort((a, b) => a.at - b.at)[0].label;
}

const OFFTOPIC = /\bai tools\b|\d\s?\$\s?\/\s?(sec|s\b|min)|\bpricing\b|\bprix\b|coûtent|claude code|\bcursor\b|agents\.md|api key|productivity|flowgpt|promptbase|\$\s?\d[\d.,]*\s?\/\s?sec|free generations|promo code|coupon|discount|% off|sign up|link in (my )?bio|newsletter|giveaway/i;
const VISUAL = /image|photo|portrait|cinematic|scene|poster|illustration|\bshot\b|lighting|style|render|video|camera|frame|composition|aspect|\d+:\d+|画|图|镜头|风格|海报|写真|照片|视频|构图|光影/i;

// Quality gate for scraped prompts (X / Civitai): must read like an image/video prompt, not a promo or tool list.
export function qualityReject(prompt, post = "") {
    const text = String(prompt || "");
    const bare = text.replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}\s]/gu, "");
    if (bare.length < 40) return "too-short";
    if (OFFTOPIC.test(`${post}\n${text}`)) return "off-topic";
    if (!VISUAL.test(text)) return "not-visual";
    if (/(prompts?|提示词)\s*[:：]?\s*$/i.test(text.replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}\s⤵️]/gu, ""))) return "too-short";
    return "";
}

// ---------- dates ----------
export function tweetIdFromUrl(url) {
    const m = String(url || "").match(/(?:x|twitter)\.com\/[^/]+\/status\/(\d{8,})/);
    return m ? m[1] : "";
}
export function snowflakeDate(id) {
    try {
        return new Date(Number((BigInt(id) >> 22n) + 1288834974657n)).toISOString();
    } catch {
        return "";
    }
}
export function toIso(value) {
    if (!value) return "";
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? "" : d.toISOString();
}
export const ageDays = (iso, now = Date.now()) => (iso ? Math.max(0, (now - new Date(iso).getTime()) / 86_400_000) : null);

// ---------- titles (heuristic, no model calls) ----------
export function autoTitle(post, prompt, model) {
    const clean = (s) => String(s || "")
        .replace(/<lora:[^>]*>|<[^>]+>/gi, " ")
        .replace(/https?:\/\/\S+/g, "")
        .replace(/[@#][\w\u4e00-\u9fff]+/g, "")
        .replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu, "")
        .replace(/\b(prompts?|提示词|提示詞|プロンプト)\b\s*[:：]?/gi, "")
        .replace(/\b(masterpiece|best quality|very aesthetic|absurdres|amazing quality|high quality|highly detailed|ultra detailed|8k|4k|hdr|score_\d+\w*)\b,?/gi, "")
        .replace(/\s+/g, " ")
        .trim();
    const head = clean(String(post || "").split(/(?:prompts?|提示词|提示詞|プロンプト)\s*[:：👇⬇️]/i)[0]);
    const words = (t) => (/[\u4e00-\u9fff]/.test(t) ? t.length >= 4 : t.split(/\s+/).length >= 3);
    let title = head.split(/(?<=[.!?。！？])\s|\n/)[0] || "";
    // Captions that only name the tool ("Made with Seedance 2.5", "GPT image on ChatGPT") make poor titles.
    if (/^(made|created|generated|video generated|image generated|done|try|using)\b/i.test(title) || (detectModel(title, false) && title.split(/\s+/).length <= 6)) title = "";
    if (!words(title)) title = clean(prompt).split(/[.;:，。；\n]|,\s/).map((x) => x.trim()).find(words) || "";
    title = title.replace(/^[\s\-—:：,.()]+|[\s\-—:：,.()]+$/g, "");
    const limit = /[\u4e00-\u9fff]/.test(title) ? 24 : 60;
    if (title.length > limit) title = title.slice(0, limit).replace(/\s+\S*$/, "") + "…";
    return title || `${model || "AI"} 提示词`;
}

// ---------- scoring ----------
// Unknown bookmarks/reposts are imputed from likes (median ratios of the hand-curated X library) so entries whose
// source only exposes likes (GitHub records refreshed from X) stay comparable. Not applied to Civitai (no bookmarks/reposts there).
export function engagementTotal(e, weights, impute = {}, isXPost = true) {
    if (!e) return null;
    const filled = { ...e };
    if (isXPost && typeof e.likes === "number") for (const k of ["bookmarks", "reposts"]) if (typeof e[k] !== "number" && impute[k]) filled[k] = e.likes * impute[k];
    const vals = ["likes", "bookmarks", "reposts"].map((k) => (typeof filled[k] === "number" ? filled[k] * (weights[k] ?? 1) : 0));
    const known = ["likes", "bookmarks", "reposts"].some((k) => typeof e[k] === "number");
    return known ? vals.reduce((a, b) => a + b, 0) : null;
}

// Score = engagement normalised by author followers (log scale) + freshness decay + on-site usage.
export function scoreEntry(entry, libraryId, usage, cfg, now = Date.now()) {
    const s = cfg.score;
    const eng = engagementTotal(entry.engagement, s.engagementWeights, s.imputeFromLikes, Boolean(tweetIdFromUrl(entry.sourceUrl)));
    let engagementScore;
    if (eng === null) engagementScore = s.unknownEngagementPrior[libraryId] ?? s.unknownEngagementPrior.default;
    else {
        const followers = Math.max(s.followerFloor, typeof entry.authorFollowers === "number" ? entry.authorFollowers : s.assumedFollowers);
        const rate = eng / followers;
        // [dianran] Watchlist author tiers (S/A/B from x-watchlist.json) multiply the engagement score.
        const tierMult = s.tierMultiplier?.[entry.authorTier] ?? 1;
        engagementScore = (s.absWeight * Math.log10(1 + eng) + s.rateWeight * Math.log10(1 + 100 * rate)) * (s.sourceMultiplier[entry.source] ?? 1) * tierMult;
    }
    const age = ageDays(entry.postedAt, now);
    const freshness = age === null ? s.unknownDateFreshness : Math.pow(0.5, age / s.freshnessHalfLifeDays);
    const u = usage || { copy: 0, use: 0 };
    const usageScore = Math.log10(1 + (u.copy || 0) + s.usageUseWeight * (u.use || 0));
    const total = engagementScore + s.freshnessWeight * freshness + s.usageWeight * usageScore;
    return { total: Math.round(total * 1000) / 1000, engagement: +engagementScore.toFixed(3), freshness: +freshness.toFixed(3), usage: +usageScore.toFixed(3) };
}

// Content identity must retain Chinese and the complete prompt.
export const promptKey = (prompt) => String(prompt || "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
