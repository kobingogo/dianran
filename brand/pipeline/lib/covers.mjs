// [dianran] Download remote cover images once and store them as small WebP thumbnails under
// web/public/prompt-sources/covers/ (the app never loads prompt images from external hosts).
import { createHash } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import sharp from "sharp";
import { COVER_DIR } from "./common.mjs";

export const PUBLIC_PREFIX = "/prompt-sources/covers/";
export const ALLOWED_HOSTS = new Set([
    "raw.githubusercontent.com", "cdn.jsdelivr.net", "github.com", "cms-assets.youmind.com", "cdn.imgedify.com",
    "pbs.twimg.com", "camo.githubusercontent.com", "linux.do", "i.mji.rip", "storage.googleapis.com", "bibigpt-apps.chatvid.ai",
    "image.civitai.com",
]);
const WIDTH = 400;

// Alternative URLs to try for one cover, best first.
export function candidates(url) {
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
    if (parsed.hostname === "image.civitai.com") list.push(url.replace(/\/original=true\//, "/width=450/"));
    list.push(url);
    return [...new Set(list)];
}

export async function download(url) {
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

export const coverName = (url) => `${createHash("sha1").update(url).digest("hex").slice(0, 16)}.webp`;
export const coverFileOf = (publicUrl) => (publicUrl && publicUrl.startsWith(PUBLIC_PREFIX) ? resolve(COVER_DIR, publicUrl.slice(PUBLIC_PREFIX.length)) : "");

// Returns the local public URL ("/prompt-sources/covers/<hash>.webp") or "" when the image cannot be fetched.
export function createLocalizer() {
    const stats = { ok: 0, cached: 0, skipped: 0, failed: 0 };
    const failedUrls = [];
    mkdirSync(COVER_DIR, { recursive: true });
    async function localize(url) {
        if (!url || url.startsWith("/")) return url;
        let host = "";
        try {
            host = new URL(url).hostname;
        } catch {
            return "";
        }
        if (!ALLOWED_HOSTS.has(host)) return (stats.skipped++, "");
        const name = coverName(url);
        const file = resolve(COVER_DIR, name);
        if (existsSync(file)) return (stats.cached++, PUBLIC_PREFIX + name);
        try {
            const input = await download(url);
            await sharp(input, { animated: false }).resize({ width: WIDTH, withoutEnlargement: true }).webp({ quality: 55, effort: 6 }).toFile(file);
            stats.ok++;
            return PUBLIC_PREFIX + name;
        } catch (error) {
            stats.failed++;
            failedUrls.push(url);
            console.warn(`cover skip ${url}: ${error.message}`);
            return "";
        }
    }
    return { localize, stats, failedUrls };
}

export async function pool(items, size, fn) {
    let index = 0;
    await Promise.all(Array.from({ length: size }, async () => {
        while (index < items.length) {
            const i = index++;
            await fn(items[i], i);
        }
    }));
}
