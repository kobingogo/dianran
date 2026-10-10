#!/usr/bin/env node
// [dianran] Finalize a pipeline run: drop cover files no library references any more, and refresh manifest
// counts plus generatedAt. Browsers refetch when that timestamp changes; the app bundle is not rewritten.
// Usage: node brand/pipeline/finalize.mjs [YYYY-MM-DD]
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { COVER_DIR, LIB_DIR, ROOT, libPath, log, nowIso, readJson, writeJson } from "./lib/common.mjs";
import { PUBLIC_PREFIX } from "./lib/covers.mjs";

// Fields a visitor can actually see. Engagement, fetch time and pick score churn must not
// advance the snapshot clock or the site will refetch an unchanged library.
const VISIBLE = ["id", "title", "prompt", "description", "tags", "coverUrl", "referenceImageUrls", "model", "imageModel", "author", "sourceUrl", "status", "pickOf", "pickLibrary"];
function digestItems(items) {
    const rows = (Array.isArray(items) ? items : []).map((item) => {
        const row = {};
        for (const key of VISIBLE) if (item?.[key] !== undefined) row[key] = item[key];
        return row;
    });
    rows.sort((a, b) => String(a.id).localeCompare(String(b.id)));
    return createHash("sha256").update(JSON.stringify(rows)).digest("hex");
}
function headJson(rel) {
    try {
        return JSON.parse(execFileSync("git", ["show", `HEAD:${rel}`], { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }));
    } catch {
        return null;
    }
}
function publicChanged() {
    const covers = execFileSync("git", ["status", "--porcelain", "-uall", "--", "web/public/prompt-sources/covers"], { cwd: ROOT, encoding: "utf8" });
    if (covers.trim()) return true;
    for (const file of readdirSync(LIB_DIR).filter((f) => f.endsWith(".json") && f !== "manifest.json")) {
        const current = readJson(resolve(LIB_DIR, file), []);
        const previous = headJson(`web/public/prompt-sources/${file}`);
        if (!previous || digestItems(current) !== digestItems(previous)) return true;
    }
    return false;
}
const referenced = new Set();
const counts = {};
for (const file of readdirSync(LIB_DIR).filter((f) => f.endsWith(".json") && f !== "manifest.json")) {
    const items = readJson(resolve(LIB_DIR, file), []);
    counts[file.replace(/\.json$/, "")] = items.length;
    for (const item of items) for (const url of [item.coverUrl, ...(item.referenceImageUrls || [])]) if (url?.startsWith(PUBLIC_PREFIX)) referenced.add(url.slice(PUBLIC_PREFIX.length));
}
for (const entry of Object.values(readJson(resolve(ROOT, "brand/pipeline/data/picks-archive.json"), {}))) if (entry.coverUrl?.startsWith(PUBLIC_PREFIX)) referenced.add(entry.coverUrl.slice(PUBLIC_PREFIX.length));
let pruned = 0;
for (const file of readdirSync(COVER_DIR)) if (file.endsWith(".webp") && !referenced.has(file)) { rmSync(resolve(COVER_DIR, file)); pruned++; }

const manifest = readJson(libPath("manifest"), { sources: [] });
const previousVersion = manifest.generatedAt || "";
const changed = publicChanged();
const version = changed ? nowIso() : previousVersion;
if (changed) {
    for (const s of manifest.sources) if (counts[s.id] !== undefined) s.count = counts[s.id];
    manifest.generatedAt = version;
    writeJson(libPath("manifest"), manifest);
}
log(`finalize: snapshot ${changed ? `${previousVersion} -> ${version}` : `${version} (unchanged)`}; pruned ${pruned} unreferenced covers; counts ${JSON.stringify(counts)}`);
writeJson(resolve(ROOT, "brand/pipeline/candidates/finalize.json"), { version, previousVersion, changed, pruned, counts });
