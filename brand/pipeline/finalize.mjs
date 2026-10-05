#!/usr/bin/env node
// [dianran] Finalize a pipeline run: drop cover files no library references any more, refresh manifest counts and
// bump the bundled-data version (BUILT_IN_SNAPSHOT_VERSION in web/src/services/api/prompts.ts) so browsers refetch.
// Usage: node brand/pipeline/finalize.mjs [YYYY-MM-DD]
import { readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { COVER_DIR, LIB_DIR, ROOT, libPath, log, nowIso, readJson, today, writeJson } from "./lib/common.mjs";
import { PUBLIC_PREFIX } from "./lib/covers.mjs";

const date = process.argv[2] || today();
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
for (const s of manifest.sources) if (counts[s.id] !== undefined) s.count = counts[s.id];
manifest.generatedAt = nowIso();
writeJson(libPath("manifest"), manifest);

const tsPath = resolve(ROOT, "web/src/services/api/prompts.ts");
const ts = readFileSync(tsPath, "utf8");
const current = ts.match(/const BUILT_IN_SNAPSHOT_VERSION = "([^"]+)";/)?.[1] || "";
let version = `prompts-${date}`;
if (current.startsWith(version)) version = `${version}.${(Number(current.split(".")[1]) || 1) + 1}`;
writeFileSync(tsPath, ts.replace(/const BUILT_IN_SNAPSHOT_VERSION = "[^"]+";/, `const BUILT_IN_SNAPSHOT_VERSION = "${version}";`));
log(`finalize: version ${current} -> ${version}; pruned ${pruned} unreferenced covers; counts ${JSON.stringify(counts)}`);
writeJson(resolve(ROOT, "brand/pipeline/candidates/finalize.json"), { version, previousVersion: current, pruned, counts });
