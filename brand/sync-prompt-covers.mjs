#!/usr/bin/env node
// [dianran] Localize prompt-library cover images: download them once, shrink to small WebP thumbnails under
// web/public/prompt-sources/covers/, and rewrite the snapshot JSON to point at our own domain.
// Images whose host is not part of the licensed upstream repositories (e.g. X/Twitter, forums) are NOT bundled;
// those records fall back to the local placeholder in the UI. Run after sync-prompts.mjs.
// Usage: node brand/sync-prompt-covers.mjs
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const srcDir = resolve(root, "web/public/prompt-sources");
const outDir = resolve(srcDir, "covers");
const PUBLIC_PREFIX = "/prompt-sources/covers/";
// Hosts that serve the upstream repositories' own (MIT / CC BY 4.0) image assets.
const ALLOWED_HOSTS = new Set(["raw.githubusercontent.com", "cdn.jsdelivr.net", "github.com", "cms-assets.youmind.com", "cdn.imgedify.com"]);
const WIDTH = 400;

mkdirSync(outDir, { recursive: true });
const manifest = JSON.parse(readFileSync(resolve(srcDir, "manifest.json"), "utf8"));
const stats = { ok: 0, cached: 0, skipped: 0, failed: 0 };

async function localize(url) {
    if (!url || url.startsWith("/")) return url;
    let host = "";
    try {
        host = new URL(url).hostname;
    } catch {
        return "";
    }
    if (!ALLOWED_HOSTS.has(host)) return (stats.skipped++, "");
    const name = `${createHash("sha1").update(url).digest("hex").slice(0, 16)}.webp`;
    const file = resolve(outDir, name);
    if (existsSync(file)) return (stats.cached++, PUBLIC_PREFIX + name);
    try {
        const response = await fetch(url, { signal: AbortSignal.timeout(30_000), headers: { "User-Agent": "dianran-sync/1.0" } });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const input = Buffer.from(await response.arrayBuffer());
        await sharp(input, { animated: false }).resize({ width: WIDTH, withoutEnlargement: true }).webp({ quality: 55, effort: 6 }).toFile(file);
        stats.ok++;
        return PUBLIC_PREFIX + name;
    } catch (error) {
        stats.failed++;
        console.warn(`skip ${url}: ${error.message}`);
        return "";
    }
}

async function pool(items, size, fn) {
    let index = 0;
    await Promise.all(Array.from({ length: size }, async () => {
        while (index < items.length) await fn(items[index++]);
    }));
}

for (const source of [{ path: "dianran-picks.json" }, ...manifest.sources]) {
    const path = resolve(srcDir, source.path);
    const items = JSON.parse(readFileSync(path, "utf8"));
    await pool(items, 12, async (item) => {
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
    writeFileSync(path, JSON.stringify(items));
    console.log(`${source.path}: done`, JSON.stringify(stats));
}
console.log("covers ->", outDir, stats);
