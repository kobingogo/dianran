#!/usr/bin/env node
// [dianran] Civitai fetcher: public REST API, images sorted by "Most Reactions" over the past week,
// with generation metadata (withMeta=true). Keeps prompt + base model + reaction stats and
// stores attribution (creator username + link to the image page). No API key needed; requests are paced and identified
// with a User-Agent; CIVITAI_API_TOKEN is sent when set (recommended by Civitai ToS §11.4). Writes candidates/civitai.json; nothing is published here.
// Usage: node brand/pipeline/fetch-civitai.mjs
import { resolve } from "node:path";
import { CANDIDATE_DIR, autoTitle, config, libPath, log, modelLabel, nowIso, readJson, writeJson, promptKey } from "./lib/common.mjs";

const cfg = config("pipeline.json").civitai;
const UA = "dianran-prompt-pipeline/1.0 (+https://github.com/kobingogo/dianran)";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fetchedAt = nowIso();
const stats = { authenticated: Boolean(process.env.CIVITAI_API_TOKEN), pages: 0, raw: 0, notImage: 0, noPrompt: 0, lowReactions: 0, duplicate: 0, candidates: 0, errors: [] };

const reactionsOf = (img) => ["likeCount", "heartCount", "laughCount", "cryCount"].reduce((sum, k) => sum + (img.stats?.[k] || 0), 0);
async function getPage(url) {
    for (let attempt = 0; attempt < 10; attempt++) {
        try {
            const headers = { "User-Agent": UA, Accept: "application/json" };
            // Civitai ToS §11.4 allows automated access through the public API "with your own valid credentials":
            // set CIVITAI_API_TOKEN (civitai.com → Account → API keys) to send them; the images endpoint itself is public.
            if (process.env.CIVITAI_API_TOKEN) headers.Authorization = `Bearer ${process.env.CIVITAI_API_TOKEN}`;
            const response = await fetch(url, { headers, signal: AbortSignal.timeout(60_000) });
            const data = await response.json().catch(() => ({}));
            if (response.ok && Array.isArray(data.items)) return data;
            stats.errors.push(`HTTP ${response.status} ${data.error || ""}`.trim());
        } catch (error) {
            stats.errors.push(error.message);
        }
        await sleep(Math.min(30_000, 4000 * (attempt + 1)));
    }
    return null;
}

const existing = new Set(readJson(libPath("civitai-trending"), []).map((i) => promptKey(i.prompt)));
const seen = new Set();
const out = [];
let url = `https://civitai.com/api/v1/images?sort=Most%20Reactions&period=Week&withMeta=true&limit=${cfg.pageSize}`;
for (let page = 0; page < cfg.pages && url; page++) {
    const data = await getPage(url);
    if (!data) break;
    stats.pages++;
    for (const img of data.items) {
        stats.raw++;
        if (img.type !== "image") { stats.notImage++; continue; }
        const prompt = String(img.meta?.prompt || "").trim();
        if (prompt.length < cfg.minPromptLength) { stats.noPrompt++; continue; }
        const s = img.stats || {};
        const reactions = reactionsOf(img);
        if (reactions < cfg.minReactions) { stats.lowReactions++; continue; }
        if (prompt.replace(/\s/g, "").length < cfg.minPromptLength) { stats.noPrompt++; continue; }
        const key = promptKey(prompt);
        if (seen.has(key)) { stats.duplicate++; continue; }
        seen.add(key);
        const model = modelLabel(img.baseModel || img.meta?.baseModel || "");
        const postedAt = new Date(img.createdAt).toISOString();
        out.push({
            id: `civitai-trending:${img.id}`,
            sourceId: "civitai-trending",
            title: autoTitle("", prompt, model),
            titleAuto: true,
            prompt,
            negativePrompt: String(img.meta?.negativePrompt || ""),
            description: `${reactions.toLocaleString("en-US")} 次点赞/表情 · ${(s.commentCount || 0).toLocaleString("en-US")} 条评论 · 基础模型 ${img.baseModel || "未知"}（Civitai 用户 ${img.username} 发布，抓取于 ${fetchedAt.slice(0, 10)}）`,
            coverUrl: img.url,
            referenceImageUrls: [img.url],
            tags: [model, "Civitai", `@${img.username}`],
            author: img.username,
            sourceUrl: `https://civitai.com/images/${img.id}`,
            createdAt: postedAt.slice(0, 10),
            imageMode: "generate",
            imageModel: img.baseModel || "",
            source: "civitai",
            postedAt,
            fetchedAt,
            engagement: { likes: reactions, bookmarks: null, reposts: null, comments: s.commentCount || 0, hearts: s.heartCount || 0 },
            authorFollowers: null,
            model,
            status: "candidate",
            attribution: `© ${img.username} on Civitai — https://civitai.com/images/${img.id}`,
            alreadyInLibrary: existing.has(key),
        });
    }
    url = data.metadata?.nextPage || "";
    await sleep(1500);
}
out.sort((a, b) => b.engagement.likes - a.engagement.likes);
stats.candidates = out.length;
writeJson(resolve(CANDIDATE_DIR, "civitai.json"), { fetcher: "civitai", fetchedAt, stats, items: out });
log("Civitai done", JSON.stringify(stats));
if (!stats.pages && stats.errors.length) process.exitCode = 1;
