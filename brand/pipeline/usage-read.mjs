#!/usr/bin/env node
// [dianran] Read anonymous prompt usage counts back from the dianran-next Vercel Blob store.
// Raw batches written by /api/usage (usage/YYYY-MM-DD/batch-<rand>.json) are folded into one aggregate blob
// (usage-agg/totals.json), the processed raw batches are deleted, and a copy of the aggregate is written to
// brand/pipeline/data/usage.json for scoring. Needs BLOB_READ_WRITE_TOKEN (env, or the file named by
// DIANRAN_USAGE_ENV, default ~/.config/dianran/dianran-next.env, created with `vercel env pull`).
// Without a token the step reports "unavailable" and scoring falls back to engagement + freshness.
// Usage: node brand/pipeline/usage-read.mjs
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { del, get, list, put } from "@vercel/blob";
import { DATA_DIR, log, nowIso, readJson, writeJson } from "./lib/common.mjs";

const OUT = resolve(DATA_DIR, "usage.json");
const AGG = "usage-agg/totals.json";
const KEEP_DAYS = 200;

function loadToken() {
    if (process.env.BLOB_READ_WRITE_TOKEN) return process.env.BLOB_READ_WRITE_TOKEN;
    const file = process.env.DIANRAN_USAGE_ENV || resolve(homedir(), ".config/dianran/dianran-next.env");
    if (!existsSync(file)) return "";
    const line = readFileSync(file, "utf8").split("\n").find((l) => l.startsWith("BLOB_READ_WRITE_TOKEN="));
    return line ? line.slice("BLOB_READ_WRITE_TOKEN=".length).trim().replace(/^"|"$/g, "") : "";
}

async function readJsonBlob(pathname, token) {
    const result = await get(pathname, { access: "private", token, useCache: false });
    if (!result || result.statusCode !== 200) return null;
    return JSON.parse(await new Response(result.stream).text());
}

const previous = readJson(OUT, null);
const token = loadToken();
if (!token) {
    const status = { ...(previous || {}), status: "unavailable", reason: "no BLOB_READ_WRITE_TOKEN", checkedAt: nowIso() };
    writeJson(OUT, { since: null, days: {}, totals: {}, ...status });
    log("usage: unavailable (no BLOB_READ_WRITE_TOKEN) -> scoring uses engagement + freshness only");
    process.exit(0);
}

try {
    let agg = null;
    try {
        agg = await readJsonBlob(AGG, token);
    } catch (error) {
        if (!/not.?found/i.test(error?.message || "")) throw error;
    }
    // Fall back to the committed copy if the aggregate blob does not exist yet.
    if (!agg && previous?.status === "ok") agg = previous;
    agg = agg || { since: nowIso(), days: {}, totals: {} };

    const blobs = [];
    let cursor;
    do {
        const page = await list({ prefix: "usage/", cursor, limit: 1000, token });
        blobs.push(...page.blobs);
        cursor = page.hasMore ? page.cursor : undefined;
    } while (cursor);

    let events = 0;
    const processed = [];
    for (const blob of blobs) {
        try {
            const batch = await readJsonBlob(blob.pathname, token);
            const day = /^\d{4}-\d{2}-\d{2}$/.test(batch?.day || "") ? batch.day : String(blob.uploadedAt).slice(0, 10);
            for (const [rawId, value] of Object.entries(batch?.events || {})) {
                const id = rawId.startsWith("dianran-picks:") && rawId.split(":").length > 2 ? rawId.slice("dianran-picks:".length) : rawId;
                const copy = Number(value.copy) || 0;
                const use = Number(value.use) || 0;
                const dayBucket = (agg.days[day] ||= {});
                const d = (dayBucket[id] ||= { copy: 0, use: 0 });
                d.copy += copy;
                d.use += use;
                const t = (agg.totals[id] ||= { copy: 0, use: 0, last: day });
                t.copy += copy;
                t.use += use;
                if (day > t.last) t.last = day;
                events += copy + use;
            }
            processed.push(blob.url);
        } catch (error) {
            log(`usage: skip ${blob.pathname}: ${error.message}`);
        }
    }
    const cutoff = new Date(Date.now() - KEEP_DAYS * 86_400_000).toISOString().slice(0, 10);
    for (const day of Object.keys(agg.days)) if (day < cutoff) delete agg.days[day];
    agg.updatedAt = nowIso();
    agg.status = "ok";
    agg.lastRun = { rawBatches: blobs.length, processed: processed.length, events };
    await put(AGG, JSON.stringify(agg), { access: "private", token, allowOverwrite: true, addRandomSuffix: false, contentType: "application/json" });
    if (processed.length) await del(processed, { token });
    writeJson(OUT, agg);
    log(`usage: ok — ${blobs.length} raw batches, ${events} events folded; ${Object.keys(agg.totals).length} prompts with usage since ${agg.since}`);
} catch (error) {
    const status = { since: previous?.since || null, days: previous?.days || {}, totals: previous?.totals || {}, status: "error", reason: error.message, checkedAt: nowIso() };
    writeJson(OUT, status);
    log(`usage: read failed (${error.message}) -> keeping previous counts, scoring falls back where missing`);
}
