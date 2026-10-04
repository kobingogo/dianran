#!/usr/bin/env node
// [dianran] GitHub upstream fetcher: re-syncs the bundled upstream prompt repositories through the normalized
// yukkcat/image-prompts registry (MIT) and writes the full upstream lists to candidates/github/<id>.json.
// brand/pipeline/merge.mjs adds new records, refreshes metadata and retires records removed upstream.
// Usage: node brand/pipeline/fetch-github.mjs
import { resolve } from "node:path";
import { CANDIDATE_DIR, config, libPath, log, nowIso, readJson, writeJson } from "./lib/common.mjs";

const gh = config("github-sources.json");
const fetchedAt = nowIso();
const summary = {};
for (const source of gh.sources) {
    let items = null;
    let error = "";
    for (let attempt = 0; attempt < 3 && !items; attempt++) {
        try {
            const response = await fetch(`${gh.registry}/${source.id}.json`, { signal: AbortSignal.timeout(60_000) });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const data = await response.json();
            if (!Array.isArray(data) || !data.length) throw new Error("empty list");
            items = data;
        } catch (e) {
            error = e.message;
        }
    }
    if (!items) {
        summary[source.id] = { error };
        log(`${source.id}: FAILED ${error}`);
        continue;
    }
    const current = new Set(readJson(libPath(source.id), []).map((i) => i.id));
    const upstream = new Set(items.map((i) => i.id));
    const newIds = items.filter((i) => !current.has(i.id)).length;
    const gone = [...current].filter((id) => !upstream.has(id)).length;
    writeJson(resolve(CANDIDATE_DIR, "github", `${source.id}.json`), { fetcher: "github", source, fetchedAt, items }, false);
    summary[source.id] = { upstream: items.length, notInLibrary: newIds, removedUpstream: gone };
    log(`${source.id}: upstream ${items.length}, not in library ${newIds}, removed upstream ${gone}`);
}
writeJson(resolve(CANDIDATE_DIR, "github.json"), { fetcher: "github", fetchedAt, summary });
