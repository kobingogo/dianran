#!/usr/bin/env node
// [dianran] X fetcher: twscrape-x keyword searches; RedFox is an explicit alternative.
// Keeps real prompt text with an image or video, applies the
// prompt-quality rules, dedupes against the published libraries, and writes
// candidates to the resource repository candidates/x.json. Nothing is published here.
// Usage: node brand/pipeline/fetch-x.mjs [--verify-search|--replay-search]   (config: brand/pipeline/config/x-watchlist.json)
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { redfoxX, parseXPage } from "./lib/redfox-x.mjs";
import { CANDIDATE_DIR, autoTitle, config, detectModel, qualityReject, libPath, libraries, log, nowIso, readJson, writeJson, promptKey } from "./lib/common.mjs";

const cfg = config("x-watchlist.json");
const verifyOnly = process.argv.includes("--verify-search");
const replayOnly = process.argv.includes("--replay-search");
const BIN = process.env.TWSCRAPE_BIN || resolve(import.meta.dirname, "twscrape-x");
const provider = process.env.X_PROVIDER || "twscrape";
if (!["redfox", "twscrape"].includes(provider)) throw new Error("X_PROVIDER 必须是 redfox 或 twscrape");
// [dianran] X_WINDOW_DAYS overrides the config window for high-frequency runs (e.g. twice-daily fast path).
const windowDays = Number(process.env.X_WINDOW_DAYS) || cfg.windowDays;
const since = new Date(Date.now() - windowDays * 86_400_000).toISOString().slice(0, 10);

function twscrape(args, timeoutMs = 20 * 60_000) {
    if (replayOnly) {
        if (args[0] !== "search") return { code: 0, rows: [], err: "" };
        const sample = readJson(resolve(CANDIDATE_DIR, "redfox-search-sample.json"));
        return { code: 0, rows: parseXPage(sample.data).rows, err: "" };
    }
    if (provider === "redfox") return redfoxX(args, timeoutMs, fetch, verifyOnly, sample => writeJson(resolve(CANDIDATE_DIR, "redfox-search-sample.json"), sample));
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


const stats = { provider, queries: {}, authorsSearched: 0, raw: 0, unique: 0, noMedia: 0, reply: 0, noPrompt: 0, noModel: 0, rejected: {}, duplicate: 0, threadLookups: 0, candidates: 0, errors: [] };
const byId = new Map();
function collect(rows, tag) {
    for (const row of rows) {
        stats.raw++;
        if (!byId.has(row.id_str)) byId.set(row.id_str, { ...row, _query: tag });
    }
}

log(`X fetch (${provider}) since ${since}: ${cfg.queries.length} keyword queries`);
// [dianran] Tiered watchlist: S = top prompt authorities (no fave gate), A = active sharers/educators,
// B = Chinese image/video prompt creators. Falls back to the legacy flat `authors` list if authorTiers is absent.
const tiers = Array.isArray(cfg.authorTiers) && cfg.authorTiers.length
    ? cfg.authorTiers
    : [{ tier: "default", minFaves: cfg.authorMinFaves ?? 0, authors: cfg.authors || [] }];
const tierOfAuthor = new Map();
for (const t of tiers) for (const a of t.authors || []) tierOfAuthor.set(String(a).toLowerCase(), t.tier);
const totalAuthors = tiers.reduce((n, t) => n + (t.authors || []).length, 0);
log(`watchlist (scoring only; author collection ${cfg.collectAuthors ? "enabled" : "disabled"}): ${totalAuthors} authors in ${tiers.length} tiers (${tiers.map((t) => `${t.tier}:${(t.authors || []).length}`).join(", ")})`);
for (const q of (verifyOnly || replayOnly) ? cfg.queries.slice(0, 1) : cfg.queries) {
    const res = await twscrape(["search", provider === "redfox" ? `${q.redfoxKeyword} -filter:replies -filter:retweets` : `${q.query} since:${since}`, "--limit", String(q.limit || cfg.limitPerQuery)]);
    stats.queries[q.tag] = res.rows.length;
    if (res.code !== 0 && !res.rows.length) stats.errors.push(`${q.tag}: exit ${res.code} ${res.err}`);
    const minimum = Number(q.query.match(/min_faves:(\d+)/)?.[1] || 0);
    collect(res.rows.filter(row => provider !== "redfox" || (Number.isFinite(Date.parse(row.date)) && Date.parse(row.date) >= Date.parse(since) && row.likeCount !== null && row.likeCount >= minimum)), q.tag);
    log(`  query ${q.tag}: ${res.rows.length}`);
}
if (!verifyOnly && !replayOnly && provider === "twscrape" && cfg.collectAuthors) for (const t of tiers) {
    const authors = t.authors || [];
    for (let i = 0; i < authors.length; i += cfg.authorBatchSize) {
        const batch = authors.slice(i, i + cfg.authorBatchSize);
        const tag = `watchlist-${t.tier}-${i / cfg.authorBatchSize + 1}`;
        const query = `(${batch.map((a) => `from:${a}`).join(" OR ")}) min_faves:${t.minFaves ?? 0} -filter:replies since:${since}`;
        const res = await twscrape(["search", query, "--limit", String(cfg.limitPerQuery)]);
        stats.authorsSearched += batch.length;
        stats.queries[tag] = res.rows.length;
        if (res.code !== 0 && !res.rows.length) stats.errors.push(`${tag}: exit ${res.code} ${res.err}`);
        collect(res.rows, tag);
        log(`  ${tag}: ${res.rows.length}`);
    }
}
stats.unique = byId.size;
if (verifyOnly) {
    writeJson(resolve(CANDIDATE_DIR, `${provider}-search-verification.json`), { fetchedAt: nowIso(), stats, rows: [...byId.values()] });
    log("X search verification (no merge or publish)", JSON.stringify(stats));
    process.exit(stats.errors.length ? 1 : 0);
}

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
    if (replayOnly || p.prompt.length >= 60 || lookups >= cfg.maxThreadLookups) continue;
    lookups++;
    const res = await twscrape(["tweet_replies", p.t.id_str, "--limit", "20"], 5 * 60_000);
    log(`  replies ${lookups}/${cfg.maxThreadLookups}: ${p.t.id_str}, ${res.rows.length} rows, exit ${res.code}`);
    if (res.code !== 0) stats.errors.push(`replies ${p.t.id_str}: exit ${res.code} ${res.err}`);
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
    const reason = qualityReject(prompt, t.rawContent);
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
        description: `${t.likeCount === null ? "未知" : t.likeCount.toLocaleString("en-US")} 赞 · ${t.bookmarkedCount === null ? "未知" : t.bookmarkedCount.toLocaleString("en-US")} 收藏 · ${t.retweetCount === null ? "未知" : t.retweetCount.toLocaleString("en-US")} 转发（抓取于 ${fetchedAt.slice(0, 10)}）`,
        coverUrl: cover,
        referenceImageUrls: [cover, ...photos.slice(1, 4).map((ph) => ph.url)],
        tags: [model, videos.length ? "视频" : "图像", `@${handle}`],
        author: `@${handle}`,
        authorTier: tierOfAuthor.get(handle.toLowerCase()) || "",
        sourceUrl: `https://x.com/${handle}/status/${t.id_str}`,
        createdAt: postedAt.slice(0, 10),
        imageMode: "generate",
        imageModel: model,
        source: "x",
        postedAt,
        fetchedAt,
        engagement: { likes: t.likeCount ?? null, bookmarks: t.bookmarkedCount ?? null, reposts: t.retweetCount ?? null },
        authorFollowers: t.user?.followersCount ?? null,
        model,
        status: "candidate",
        mediaType: videos.length ? "video" : "image",
        promptFrom: where,
        query: t._query,
    });
}
stats.candidates = out.length;
writeJson(resolve(CANDIDATE_DIR, replayOnly ? "redfox-replay-candidates.json" : "x.json"), { fetcher: "x", fetchedAt, since, stats, items: out });
log("X done", JSON.stringify(stats));
if (!stats.raw && stats.errors.length) process.exitCode = 1;
