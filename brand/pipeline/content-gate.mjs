#!/usr/bin/env node
// [dianran] List new prompt-library rows in <commit> that are not in <base> and that fail contentReject.
// Pick copies of an already published id are ignored. Prints one JSON object: { hits }.
// Usage: node brand/pipeline/content-gate.mjs [commit] [base]
import { execFileSync } from "node:child_process";
import { contentReject, config, ROOT } from "./lib/common.mjs";

const commit = process.argv[2] || "HEAD";
const base = process.argv[3] || "origin/main";

function git(args) {
    return execFileSync("git", args, { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
}
function show(ref, path) {
    try {
        return git(["show", `${ref}:${path}`]);
    } catch {
        return null;
    }
}

let files;
try {
    files = git(["ls-tree", "-r", "--name-only", commit, "web/public/prompt-sources"])
        .split("\n")
        .filter((path) => path.endsWith(".json") && !path.endsWith("/manifest.json") && path !== "web/public/prompt-sources/manifest.json");
} catch (error) {
    console.log(JSON.stringify({ hits: [], error: error.message }));
    process.exit(1);
}

const excludeAuthors = config("x-watchlist.json").excludeAuthors || [];
const baseIds = new Set();
const baseByFile = new Map();
for (const path of files) {
    const raw = show(base, path);
    const rows = raw ? JSON.parse(raw) : [];
    baseByFile.set(path, new Set(rows.map((item) => item.id)));
    for (const item of rows) baseIds.add(item.id);
}

const hits = [];
for (const path of files) {
    const raw = show(commit, path);
    if (!raw) continue;
    const known = baseByFile.get(path) || new Set();
    for (const item of JSON.parse(raw)) {
        if (known.has(item.id) || baseIds.has(item.id)) continue;
        if (item.pickOf && baseIds.has(item.pickOf)) continue;
        const reason = contentReject(String(item.prompt || "").toLowerCase(), { author: item.author, excludeAuthors, likeness: true });
        if (!reason) continue;
        hits.push({ id: item.id, library: path.split("/").pop().replace(/\.json$/, ""), title: item.title || "", reason, sourceUrl: item.sourceUrl || "" });
    }
}
console.log(JSON.stringify({ hits }));
