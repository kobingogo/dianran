#!/usr/bin/env node
// [dianran] Localize prompt-library cover images: download them once, shrink to small WebP thumbnails under
// web/public/prompt-sources/covers/, and rewrite the snapshot JSON to point at our own domain.
// Covers hosted on X (pbs.twimg.com), GitHub's camo proxy, linux.do and similar hosts are fetched through a list of
// candidate URLs (X "small" renditions, the decoded camo target, the forum's original upload); only images that are
// truly gone (deleted posts, 404) fall back to the local placeholder in the UI. Run after sync-prompts.mjs.
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
const ALLOWED_HOSTS = new Set([
    "raw.githubusercontent.com", "cdn.jsdelivr.net", "github.com", "cms-assets.youmind.com", "cdn.imgedify.com",
    "pbs.twimg.com", "camo.githubusercontent.com", "linux.do", "i.mji.rip", "storage.googleapis.com", "bibigpt-apps.chatvid.ai",
]);

// Alternative URLs to try for one cover, best first.
function candidates(url) {
    const parsed = new URL(url);
    const list = [];
    if (parsed.hostname === "pbs.twimg.com" && parsed.pathname.startsWith("/media/")) {
        const [, id, ext] = parsed.pathname.match(/^\/media\/([^.]+)(?:\.(\w+))?$/) || [];
        const format = parsed.searchParams.get("format") || ext || "jpg";
        if (id) for (const name of ["small", "medium"]) for (const fmt of [...new Set([format, "jpg", "png"])]) list.push(`https://pbs.twimg.com/media/${id}?format=${fmt}&name=${name}`);
    }
    if (parsed.hostname === "pbs.twimg.com" && /_video_thumb\//.test(parsed.pathname)) {
        for (const name of ["small", "medium"]) list.push(`https://pbs.twimg.com${parsed.pathname}?name=${name}`);
    }
    if (parsed.hostname === "camo.githubusercontent.com") {
        const hex = parsed.pathname.split("/").pop() || "";
        if (/^[0-9a-f]+$/i.test(hex) && hex.length % 2 === 0) {
            const target = Buffer.from(hex, "hex").toString("utf8");
            if (/^https?:\/\//.test(target)) list.push(target);
        }
    }
    if (parsed.hostname === "linux.do") {
        const m = parsed.pathname.match(/^\/uploads\/default\/optimized\/(.+?)\/([0-9a-f]{40})_\d+_\d+x\d+\.(\w+)$/);
        if (m) for (const ext of [m[3], "png", "jpeg", "jpg", "webp"]) list.push(`https://linux.do/uploads/default/original/${m[1]}/${m[2]}.${ext}`);
    }
    list.push(url);
    return [...new Set(list)];
}

async function download(url) {
    let lastError;
    for (const candidate of candidates(url)) {
        try {
            const response = await fetch(candidate, { signal: AbortSignal.timeout(30_000), headers: { "User-Agent": "Mozilla/5.0 (dianran-sync/1.0)" } });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const type = response.headers.get("content-type") || "";
            if (type && !type.startsWith("image/") && !type.startsWith("application/octet-stream")) throw new Error(`not an image (${type})`);
            return Buffer.from(await response.arrayBuffer());
        } catch (error) {
            lastError = error;
        }
    }
    throw lastError;
}
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
        const input = await download(url);
        await sharp(input, { animated: false }).resize({ width: WIDTH, withoutEnlargement: true }).webp({ quality: 55, effort: 6 }).toFile(file);
        stats.ok++;
        return PUBLIC_PREFIX + name;
    } catch (error) {
        stats.failed++;
        failedUrls.push(url);
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

const only = process.argv.slice(2);
const failedUrls = [];
for (const source of [{ path: "dianran-picks.json" }, { path: "x-trending.json" }, ...manifest.sources].filter((s) => !only.length || only.includes(s.path))) {
    const path = resolve(srcDir, source.path);
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
    writeFileSync(path, JSON.stringify(items));
    console.log(`${source.path}: done`, JSON.stringify(stats));
}
console.log("covers ->", outDir, stats);
if (failedUrls.length) writeFileSync(resolve(root, "brand/.cover-failures.txt"), failedUrls.join("\n") + "\n");
