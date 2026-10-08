#!/usr/bin/env node
// [dianran] Merge fetched candidates into the bundled libraries, backfill the unified metadata, score every entry,
// retire stale/broken ones and apply the per-library caps. Writes the libraries in web/public/prompt-sources,
// brand/pipeline/data/{scores,retired,cover-failures}.json and the run report candidates/merge-report.json.
// Unified metadata (added to every record, old fields untouched so the app stays backward compatible):
//   source, sourceUrl, author, postedAt, fetchedAt, engagement {likes, bookmarks, reposts}, authorFollowers, model, status
// Usage: node brand/pipeline/merge.mjs [--no-network-checks] [--additive-only]
// --additive-only: only add new candidates and refresh engagement; skip all destructive steps
// (upstream removals, retirement rules, caps). Used by the twice-daily fast path; the weekly run
// still does full maintenance.
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import {
    CANDIDATE_DIR, DATA_DIR, ageDays, config, contentReject, libPath, libraries, log, modelLabel, nowIso, readJson, scoreEntry, snowflakeDate, toIso,
    tweetIdFromUrl, writeJson, promptKey,
} from "./lib/common.mjs";
import { coverFileOf, createLocalizer, pool } from "./lib/covers.mjs";

const cfg = config("pipeline.json");
const deprecated = config("deprecated-models.json").models;
const additiveOnly = process.argv.includes("--additive-only");
const networkChecks = !additiveOnly && !process.argv.includes("--no-network-checks") && cfg.cleanup.checkXPosts;
const now = Date.now();
const runAt = nowIso();
const usage = readJson(resolve(DATA_DIR, "usage.json"), { status: "unavailable", totals: {}, days: {} });
const retiredArchive = readJson(resolve(DATA_DIR, "retired.json"), {});
const coverFailures = readJson(resolve(DATA_DIR, "cover-failures.json"), {});
const manifest = readJson(libPath("manifest"), { sources: [] });
const { localize, stats: coverStats, failedUrls } = createLocalizer();

const report = { runAt, added: [], retired: [], updated: 0, wouldRetireStale: 0, usageStatus: usage.status, usageTrackingDays: 0, perLibrary: {}, coverStats, xChecks: { checked: 0, gone: 0, refreshed: 0, errors: 0 } };

// ---------- usage helpers ----------
const usageSince = usage.status === "ok" && usage.since ? usage.since : null;
report.usageTrackingDays = usageSince ? Math.floor(ageDays(usageSince, now)) : 0;
function usageFor(id) {
    const out = { copy: 0, use: 0 };
    const from = new Date(now - cfg.score.usageWindowDays * 86_400_000).toISOString().slice(0, 10);
    for (const [day, bucket] of Object.entries(usage.days || {})) {
        if (day < from || !bucket[id]) continue;
        out.copy += bucket[id].copy || 0;
        out.use += bucket[id].use || 0;
    }
    return out;
}

// ---------- metadata backfill ----------
function parseEngagement(description) {
    const m = String(description || "").match(/([\d,]+)\s*赞\s*·\s*([\d,]+)\s*收藏\s*·\s*([\d,]+)\s*转发/);
    if (!m) return null;
    const n = (s) => Number(s.replace(/,/g, ""));
    return { likes: n(m[1]), bookmarks: n(m[2]), reposts: n(m[3]) };
}
function normalize(item, lib, defaults = {}) {
    const tweetId = tweetIdFromUrl(item.sourceUrl);
    item.source ||= lib.source;
    item.sourceUrl ||= "";
    item.author ||= "";
    item.postedAt ||= toIso(item.createdAt) || (tweetId ? snowflakeDate(tweetId) : "");
    item.fetchedAt ||= defaults.fetchedAt || runAt;
    if (item.engagement === undefined) item.engagement = parseEngagement(item.description) || { likes: null, bookmarks: null, reposts: null };
    if (item.authorFollowers === undefined) item.authorFollowers = null;
    item.model ||= modelLabel(item.imageModel, lib.id);
    item.status = "active";
    return item;
}

const retire = (lib, item, reason, detail = "") => {
    report.retired.push({ id: item.id, library: lib.id, title: item.title, reason, detail, sourceUrl: item.sourceUrl || "", model: item.model || "" });
    retiredArchive[item.id] = { reason, detail, retiredAt: runAt, library: lib.id, title: item.title, sourceUrl: item.sourceUrl || "" };
};
const coverRecentlyFailed = (url) => coverFailures[url] && ageDays(coverFailures[url], now) < 30;

async function addWithCover(item) {
    const remote = item.coverUrl;
    if (!remote) return false;
    if (coverRecentlyFailed(remote)) return false;
    const local = await localize(remote);
    if (!local) {
        coverFailures[remote] = runAt;
        return false;
    }
    const refs = [];
    for (const url of (item.referenceImageUrls || []).filter((u) => u && u !== remote).slice(0, 3)) {
        const l = await localize(url);
        if (l) refs.push(l);
    }
    item.coverSource = remote;
    item.coverUrl = local;
    item.referenceImageUrls = [local, ...refs];
    return true;
}

// ---------- load libraries ----------
const libs = libraries();
const data = {};
for (const lib of libs) {
    const items = readJson(libPath(lib.id), []);
    const defaults = { fetchedAt: lib.source === "github" ? toIso(manifest.generatedAt) : lib.id === "x-trending" ? "2026-10-04T00:00:00.000Z" : runAt };
    data[lib.id] = items.map((item) => normalize(item, lib, defaults));
    report.perLibrary[lib.id] = { before: items.length, added: 0, retired: 0, after: 0 };
}

// --backfill-only: add the unified metadata to every record (incl. 点染精选) without merging or retiring anything.
if (process.argv.includes("--backfill-only")) {
    for (const lib of libs) if (existsSync(libPath(lib.id))) writeJson(libPath(lib.id), data[lib.id], false);
    const picksLib = { id: "dianran-picks", source: "dianran" };
    const picks = readJson(libPath("dianran-picks"), []).map((item) => normalize(item, picksLib, { fetchedAt: runAt }));
    writeJson(libPath("dianran-picks"), picks, false);
    log("backfill done", JSON.stringify(Object.fromEntries(libs.map((l) => [l.id, data[l.id].length]))), `dianran-picks ${picks.length}`);
    process.exit(0);
}

// ---------- merge GitHub upstream ----------
for (const lib of libs.filter((l) => l.source === "github")) {
    const file = resolve(CANDIDATE_DIR, "github", `${lib.id}.json`);
    if (!existsSync(file)) { log(`${lib.id}: no candidates (fetch failed?) — left unchanged`); continue; }
    const { items: upstream, fetchedAt } = readJson(file);
    const current = data[lib.id];
    const byId = new Map(current.map((i) => [i.id, i]));
    const urlCount = new Map();
    for (const i of current) urlCount.set(i.sourceUrl, (urlCount.get(i.sourceUrl) || 0) + 1);
    const byUrl = new Map(current.filter((i) => tweetIdFromUrl(i.sourceUrl) && urlCount.get(i.sourceUrl) === 1).map((i) => [i.sourceUrl, i]));
    const byPrompt = new Map(current.map((i) => [promptKey(i.prompt), i]));
    const matched = new Set();
    const next = [];
    const toAdd = [];
    for (const up of upstream) {
        const hit = byId.get(up.id) || (tweetIdFromUrl(up.sourceUrl) && byUrl.get(up.sourceUrl)) || byPrompt.get(promptKey(up.prompt));
        if (hit && !matched.has(hit.id)) {
            matched.add(hit.id);
            for (const k of ["title", "prompt", "description", "tags", "author", "sourceUrl", "imageModel"]) if (up[k] !== undefined && JSON.stringify(up[k]) !== JSON.stringify(hit[k])) { hit[k] = up[k]; report.updated++; }
            if (up.createdAt && !hit.createdAt) hit.createdAt = up.createdAt;
            hit.upstreamId = up.id !== hit.id ? up.id : undefined;
            hit.model = modelLabel(hit.imageModel, lib.id);
            next.push(hit);
            continue;
        }
        if (retiredArchive[up.id]) continue;
        if ((up.tags || []).some((t) => /nsfw/i.test(t))) continue;
        toAdd.push(normalize({ ...up, sourceId: lib.id, fetchedAt }, lib, { fetchedAt }));
    }
    await pool(toAdd, 8, async (item) => {
        if (await addWithCover(item)) {
            next.push(item);
            report.added.push({ id: item.id, library: lib.id, title: item.title, model: item.model, sourceUrl: item.sourceUrl });
        }
    });
    // [dianran] In --additive-only mode unmatched items are kept (the weekly run decides their fate);
    // otherwise they are retired as removed upstream.
    for (const item of current) {
        if (matched.has(item.id)) continue;
        if (additiveOnly) next.push(item);
        else retire(lib, item, "upstream-removed", `上游 ${lib.repo} 已移除`);
    }
    data[lib.id] = next;
}

// ---------- merge X + Civitai candidates ----------
for (const [libId, file, maxNew] of [["x-trending", "x.json", Infinity], ["civitai-trending", "civitai.json", cfg.civitai.maxNewPerRun]]) {
    const lib = libs.find((l) => l.id === libId);
    const path = resolve(CANDIDATE_DIR, file);
    if (!existsSync(path)) { log(`${libId}: no candidates file`); continue; }
    const { items } = readJson(path);
    const current = data[libId];
    const byId = new Map(current.map((i) => [i.id, i]));
    const keys = new Set(current.map((i) => promptKey(i.prompt)));
    const fresh = [];
    for (const cand of items) {
        const hit = byId.get(cand.id);
        if (hit) { hit.engagement = cand.engagement; hit.authorFollowers = cand.authorFollowers ?? hit.authorFollowers; hit.fetchedAt = cand.fetchedAt; report.updated++; continue; }
        if (retiredArchive[cand.id] || keys.has(promptKey(cand.prompt))) continue;
        fresh.push({ ...cand, status: "active" });
    }
    const accepted = [];
    await pool(fresh.slice(0, maxNew === Infinity ? fresh.length : maxNew), 6, async (item) => {
        if (await addWithCover(item)) accepted.push(item);
    });
    for (const item of accepted) {
        current.push(item);
        report.added.push({ id: item.id, library: libId, title: item.title, model: item.model, sourceUrl: item.sourceUrl });
    }
    data[libId] = current;
    void lib;
}

// ---------- source checks (X posts via the public syndication endpoint; only HTTP 404 counts as gone) ----------
async function checkTweet(id) {
    const token = ((Number(id) / 1e15) * Math.PI).toString(36).replace(/(0+|\.)/g, "");
    try {
        const r = await fetch(`https://cdn.syndication.twimg.com/tweet-result?id=${id}&token=${token}`, { signal: AbortSignal.timeout(20_000), headers: { "User-Agent": "Mozilla/5.0 (dianran-pipeline)" } });
        if (r.status === 404) return { gone: true };
        if (!r.ok) return { error: r.status };
        const body = await r.json();
        if (body.__typename === "TweetTombstone") return { gone: true };
        return { likes: typeof body.favorite_count === "number" ? body.favorite_count : null, sensitive: Boolean(body.possibly_sensitive) };
    } catch (error) {
        return { error: error.message };
    }
}
const goneIds = new Set();
if (networkChecks) {
    const targets = [];
    for (const lib of libs) for (const item of data[lib.id]) if (tweetIdFromUrl(item.sourceUrl)) targets.push({ lib, item });
    log(`checking ${targets.length} X source posts…`);
    await pool(targets, 6, async ({ item }) => {
        const res = await checkTweet(tweetIdFromUrl(item.sourceUrl));
        report.xChecks.checked++;
        if (res.gone) { goneIds.add(item.id); report.xChecks.gone++; return; }
        if (res.error) { report.xChecks.errors++; return; }
        if (res.likes !== null) {
            item.engagement = { ...(item.engagement || {}), likes: res.likes };
            item.engagementCheckedAt = runAt;
            report.xChecks.refreshed++;
        }
    });
    log(`X checks: ${JSON.stringify(report.xChecks)}`);
}

// ---------- retirement rules (skipped in --additive-only: destructive maintenance stays in the weekly run) ----------
const isDeprecated = (item) => deprecated.find((d) => [item.model, item.imageModel].some((v) => v && String(v).toLowerCase() === d.match.toLowerCase()));
const trackingMature = report.usageTrackingDays >= cfg.cleanup.minUsageTrackingDays;
if (!additiveOnly) for (const lib of libs) {
    const keep = [];
    for (const item of data[lib.id]) {
        const coverFile = coverFileOf(item.coverUrl);
        if (!item.coverUrl || (coverFile && !existsSync(coverFile))) { retire(lib, item, "cover-missing", "封面图已失效"); continue; }
        if (goneIds.has(item.id)) { retire(lib, item, "source-deleted", "原帖已删除或不可访问"); continue; }
        const dep = isDeprecated(item);
        if (dep) { retire(lib, item, "deprecated-model", dep.reason); continue; }
        if (lib.source === "x" || lib.source === "civitai") {
            const reason = contentReject(String(item.prompt).toLowerCase(), { author: item.author, excludeAuthors: config("x-watchlist.json").excludeAuthors, likeness: false });
            // (the stricter "keep the uploaded face" likeness rule only gates new candidates; published entries were reviewed by hand)
            if (reason) { retire(lib, item, "content-filter", reason); continue; }
        }
        const age = ageDays(item.postedAt, now);
        const used = usage.totals?.[item.id] && ageDays(usage.totals[item.id].last, now) <= cfg.cleanup.maxAgeDays;
        if (age !== null && age > cfg.cleanup.maxAgeDays && !used) {
            if (trackingMature) { retire(lib, item, "stale", `发布超过 6 个月且站内无使用`); continue; }
            report.wouldRetireStale++;
        }
        keep.push(item);
    }
    data[lib.id] = keep;
}

// ---------- scoring ----------
const scores = {};
for (const lib of libs) for (const item of data[lib.id]) {
    const s = scoreEntry(item, lib.id, usageFor(item.id), cfg, now);
    scores[item.id] = { ...s, library: lib.id, model: item.model, hasCover: Boolean(item.coverUrl) };
}

// ---------- caps (skipped in --additive-only) ----------
if (!additiveOnly) for (const [libId, cap] of Object.entries(cfg.cleanup.caps)) {
    const lib = libs.find((l) => l.id === libId);
    const sorted = [...data[libId]].sort((a, b) => scores[b.id].total - scores[a.id].total);
    for (const item of sorted.slice(cap)) { retire(lib, item, "cap", `超出 ${lib.name} 上限 ${cap} 条（得分 ${scores[item.id].total}）`); delete scores[item.id]; }
    data[libId] = sorted.slice(0, cap);
}

// ---------- write ----------
for (const lib of libs) {
    const items = data[lib.id];
    for (const item of items) for (const k of Object.keys(item)) if (item[k] === undefined) delete item[k];
    if (items.length || existsSync(libPath(lib.id))) writeJson(libPath(lib.id), items, false);
    const p = report.perLibrary[lib.id];
    p.after = items.length;
    p.added = report.added.filter((a) => a.library === lib.id).length;
    p.retired = report.retired.filter((r) => r.library === lib.id).length;
}
// Re-added entries leave the archive; then persist state.
for (const a of report.added) delete retiredArchive[a.id];
writeJson(resolve(DATA_DIR, "retired.json"), retiredArchive);
writeJson(resolve(DATA_DIR, "cover-failures.json"), coverFailures);
writeJson(resolve(DATA_DIR, "scores.json"), { runAt, usageStatus: usage.status, scores });
writeJson(resolve(CANDIDATE_DIR, "merge-report.json"), report);
if (failedUrls.length) log(`cover failures: ${failedUrls.length}`);
log("merge done", JSON.stringify(report.perLibrary), `added ${report.added.length}, retired ${report.retired.length}, wouldRetireStale ${report.wouldRetireStale}`);
