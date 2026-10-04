#!/usr/bin/env node
// [dianran] Localize prompt-library cover images: download them once, shrink to small WebP thumbnails under
// web/public/prompt-sources/covers/, and rewrite the snapshot JSON to point at our own domain.
// Covers hosted on X (pbs.twimg.com), GitHub's camo proxy, linux.do and similar hosts are fetched through a list of
// candidate URLs (X "small" renditions, the decoded camo target, the forum's original upload); only images that are
// truly gone (deleted posts, 404) are dropped from the snapshot, as are NSFW-tagged entries. Run after sync-prompts.mjs.
// Usage: node brand/sync-prompt-covers.mjs
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createLocalizer, pool } from "./pipeline/lib/covers.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const srcDir = resolve(root, "web/public/prompt-sources");
const outDir = resolve(srcDir, "covers");
const manifest = JSON.parse(readFileSync(resolve(srcDir, "manifest.json"), "utf8"));
const { localize, stats, failedUrls } = createLocalizer();

const only = process.argv.slice(2);
for (const source of [{ path: "dianran-picks.json" }, { path: "x-trending.json" }, { path: "civitai-trending.json" }, ...manifest.sources].filter((s) => !only.length || only.includes(s.path))) {
    const path = resolve(srcDir, source.path);
    if (!existsSync(path)) continue;
    const items = JSON.parse(readFileSync(path, "utf8"));
    await pool(items, 12, async (item) => {
        // Never self-host images for entries the upstream marks as NSFW; they keep the local placeholder.
        if ((item.tags || []).some((tag) => /nsfw/i.test(tag))) {
            item.coverUrl = "";
            item.referenceImageUrls = [];
            return;
        }
        const cover = item.coverUrl || "";
        const refs = (item.referenceImageUrls || []).filter((url) => url !== cover);
        item.coverUrl = await localize(cover);
        const localRefs = [];
        for (const url of refs) {
            const local = await localize(url);
            if (local) localRefs.push(local);
        }
        item.referenceImageUrls = item.coverUrl ? [item.coverUrl, ...localRefs] : localRefs;
    });
    // Entries without a bundled cover (image gone, or NSFW-tagged) are dropped from the snapshot entirely.
    const kept = items.filter((item) => item.coverUrl);
    writeFileSync(path, JSON.stringify(kept));
    console.log(`${source.path}: done`, JSON.stringify(stats));
}
console.log("covers ->", outDir, stats);
if (failedUrls.length) writeFileSync(resolve(root, "brand/.cover-failures.txt"), failedUrls.join("\n") + "\n");
