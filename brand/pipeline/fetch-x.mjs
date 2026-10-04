#!/usr/bin/env node
// [dianran] X fetcher: keyword searches + an author watchlist via the local `twscrape-x` CLI (no API key, uses the
// logged-in twscrape account DB). Keeps only original posts with real prompt text and an image or video, applies the
// content filters (no real-person likeness, NSFW or face-swap), dedupes against the published libraries, and writes
// candidates to brand/pipeline/candidates/x.json. Nothing is published here.
// Usage: node brand/pipeline/fetch-x.mjs [--dry]   (config: brand/pipeline/config/x-watchlist.json)
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { CANDIDATE_DIR, autoTitle, config, contentReject, detectModel, qualityReject, libPath, libraries, log, nowIso, readJson, writeJson } from "./lib/common.mjs";

const cfg = config("x-watchlist.json");
const BIN = process.env.TWSCRAPE_BIN || "twscrape-x";
const since = new Date(Date.now() - cfg.windowDays * 86_400_000).toISOString().slice(0, 10);

function twscrape(args, timeoutMs = 20 * 60_000) {
    return new Promise((resolvePromise) => {
        const child = spawn(BIN, args, { stdio: ["ignore", "pipe", "pipe"] });
        let out = "";
        let err = "";
        const timer = setTimeout(() => child.kill("SIGTERM"), timeoutMs);
        child.stdout.on("data", (chunk) => (out += chunk));
        child.stderr.on("data", (chunk) => (err += chunk));
        child.on("error", (error) => (err += String(error)));
        child.on("close", (code) => {
            clearTimeout(timer);
            const rows = [];
            for (const line of out.split("\n")) {
                if (!line.trim().startsWith("{")) continue;
                try {
                    rows.push(JSON.parse(line));
                } catch {
                    /* ignore partial lines */
                }
            }
            resolvePromise({ code, rows, err: err.slice(-500) });
        });
    });
}

const MARK = /(prompts?|提示词|提示詞|プロンプト|コピペ用)\s*(?:[:：]|👇|⤵️|⬇️|🔽|⏬|below|here|\n)/i;
const cleanText = (t) => String(t || "").replace(/\s*https:\/\/t\.co\/\S+/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").trim();
function afterMarker(text) {
    const m = String(text || "").match(MARK);
    if (!m) return "";
    return cleanText(text.slice(m.index + m[0].length)).replace(/^[\s:：👇⤵️⬇️🔽⏬🏻\-—]+/u, "");
}
const promptKey = (p) => String(p).toLowerCase().replace(/[\W_]+/gu, "").slice(0, 160);

const stats = { queries: {}, authorsSearched: 0, raw: 0, unique: 0, noMedia: 0, reply: 0, noPrompt: 0, noModel: 0, rejected: {}, duplicate: 0, threadLookups: 0, candidates: 0, errors: [] };
const byId = new Map();
function collect(rows, tag) {
    for (const row of rows) {
        stats.raw++;
        if (!byId.has(row.id_str)) byId.set(row.id_str, { ...row, _query: tag });
    }
}

log(`X fetch since ${since}: ${cfg.queries.length} keyword queries, ${cfg.authors.length} watchlist authors`);
for (const q of cfg.queries) {
    const res = await twscrape(["search", `${q.query} since:${since}`, "--limit", String(q.limit || cfg.limitPerQuery)]);
    stats.queries[q.tag] = res.rows.length;
    if (res.code !== 0 && !res.rows.length) stats.errors.push(`${q.tag}: exit ${res.code} ${res.err}`);
    collect(res.rows, q.tag);
    log(`  query ${q.tag}: ${res.rows.length}`);
}
for (let i = 0; i < cfg.authors.length; i += cfg.authorBatchSize) {
    const batch = cfg.authors.slice(i, i + cfg.authorBatchSize);
    const query = `(${batch.map((a) => `from:${a}`).join(" OR ")}) min_faves:${cfg.authorMinFaves} -filter:replies since:${since}`;
    const res = await twscrape(["search", query, "--limit", String(cfg.limitPerQuery)]);
    stats.authorsSearched += batch.length;
    stats.queries[`authors-${i / cfg.authorBatchSize + 1}`] = res.rows.length;
    if (res.code !== 0 && !res.rows.length) stats.errors.push(`authors batch ${i}: exit ${res.code} ${res.err}`);
    collect(res.rows, "watchlist");
    log(`  watchlist batch ${i / cfg.authorBatchSize + 1}: ${res.rows.length}`);
}
stats.unique = byId.size;

// Existing prompts (all libraries) for dedupe.
const existing = new Set();
const existingIds = new Set();
for (const lib of libraries()) for (const item of readJson(libPath(lib.id), [])) {
    existing.add(promptKey(item.prompt));
    existingIds.add(item.id);
}
const retired = new Set(Object.keys(readJson(resolve(CANDIDATE_DIR, "../data/retired.json"), {})));

const pending = [];
for (const t of [...byId.values()].sort((a, b) => b.likeCount - a.likeCount)) {
    if (t.retweetedTweet || t.inReplyToTweetIdStr) { stats.reply++; continue; }
    const photos = t.media?.photos || [];
    const videos = t.media?.videos || [];
    const cover = photos[0]?.url || videos[0]?.thumbnailUrl || "";
    if (!cover) { stats.noMedia++; continue; }
    if (existingIds.has(`x-trending:${t.id_str}`) || retired.has(`x-trending:${t.id_str}`)) { stats.duplicate++; continue; }
    pending.push({ t, cover, photos, videos, prompt: afterMarker(t.rawContent), where: "post" });
}

// Prompts posted as a self-reply: look up the thread for the most-liked posts that lack inline prompt text.
let lookups = 0;
for (const p of pending) {
    if (p.prompt.length >= 60 || lookups >= cfg.maxThreadLookups) continue;
    lookups++;
    const res = await twscrape(["tweet_replies", p.t.id_str, "--limit", "20"], 5 * 60_000);
    const own = res.rows.filter((r) => r.user?.id_str === p.t.user?.id_str).sort((a, b) => String(a.date).localeCompare(String(b.date)));
    for (const r of own) {
        const text = cleanText(r.rawContent).replace(/^(@\w+\s*)+/, "").trim();
        const marked = afterMarker(r.rawContent);
        if (marked.length >= 30) { p.prompt = marked; p.where = "reply"; break; }
        if (text.length >= 60 && !/^(prompt|提示词)/i.test(text)) { p.prompt = text; p.where = "reply"; break; }
    }
}
stats.threadLookups = lookups;

const fetchedAt = nowIso();
const out = [];
const seenKeys = new Set();
for (const { t, cover, photos, videos, prompt, where } of pending) {
    if (prompt.length < 40) { stats.noPrompt++; continue; }
    const handle = t.user?.username || "";
    const blob = `${t.rawContent}\n${prompt}`;
    const model = detectModel(blob, videos.length > 0);
    if (!model) { stats.noModel++; continue; }
    const reason = contentReject(blob.toLowerCase(), { sensitive: t.possibly_sensitive, author: handle, excludeAuthors: cfg.excludeAuthors }) || qualityReject(prompt, t.rawContent);
    if (reason) { stats.rejected[reason] = (stats.rejected[reason] || 0) + 1; continue; }
    const key = promptKey(prompt);
    if (existing.has(key) || seenKeys.has(key)) { stats.duplicate++; continue; }
    seenKeys.add(key);
    const postedAt = new Date(t.date).toISOString();
    out.push({
        id: `x-trending:${t.id_str}`,
        sourceId: "x-trending",
        title: autoTitle(t.rawContent, prompt, model),
        titleAuto: true,
        prompt,
        description: `${t.likeCount.toLocaleString("en-US")} 赞 · ${(t.bookmarkedCount || 0).toLocaleString("en-US")} 收藏 · ${(t.retweetCount || 0).toLocaleString("en-US")} 转发（抓取于 ${fetchedAt.slice(0, 10)}）`,
        coverUrl: cover,
        referenceImageUrls: [cover, ...photos.slice(1, 4).map((ph) => ph.url)],
        tags: [model, videos.length ? "视频" : "图像", `@${handle}`],
        author: `@${handle}`,
        sourceUrl: `https://x.com/${handle}/status/${t.id_str}`,
        createdAt: postedAt.slice(0, 10),
        imageMode: "generate",
        imageModel: model,
        source: "x",
        postedAt,
        fetchedAt,
        engagement: { likes: t.likeCount || 0, bookmarks: t.bookmarkedCount || 0, reposts: t.retweetCount || 0 },
        authorFollowers: t.user?.followersCount ?? null,
        model,
        status: "candidate",
        mediaType: videos.length ? "video" : "image",
        promptFrom: where,
        query: t._query,
    });
}
stats.candidates = out.length;
writeJson(resolve(CANDIDATE_DIR, "x.json"), { fetcher: "x", fetchedAt, since, stats, items: out });
log("X done", JSON.stringify(stats));
