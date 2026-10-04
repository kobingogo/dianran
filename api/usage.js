// [dianran] Anonymous prompt-usage counter (Vercel serverless function, Node runtime).
// The browser batches "copy" / "use" counts per prompt id locally and flushes them here at most about once a day.
// Each flush is stored as one small private JSON blob in the project's Vercel Blob store (usage/YYYY-MM-DD/<random>.json)
// and later summed by brand/pipeline/usage-read.mjs. Stored: prompt ids, counts and the UTC day. Not stored: IP,
// user agent, cookies, or any identifier. No cookies are set.
import { put } from "@vercel/blob";

const ID = /^[a-z0-9][a-z0-9-]{1,40}:[A-Za-z0-9._:@\-]{1,120}$/;
const MAX_IDS = 60;
const MAX_COUNT = 30;
// Soft per-instance guard so a misbehaving client cannot burn the free Blob operation quota.
let windowStart = Date.now();
let writesInWindow = 0;
const WRITES_PER_HOUR = 60;

function readBody(req) {
    if (req.body && typeof req.body === "object") return Promise.resolve(req.body);
    if (typeof req.body === "string") return Promise.resolve(JSON.parse(req.body));
    return new Promise((resolve, reject) => {
        let raw = "";
        req.on("data", (chunk) => {
            raw += chunk;
            if (raw.length > 8192) reject(new Error("too large"));
        });
        req.on("end", () => {
            try {
                resolve(JSON.parse(raw || "{}"));
            } catch (error) {
                reject(error);
            }
        });
        req.on("error", reject);
    });
}

export default async function handler(req, res) {
    res.setHeader("Cache-Control", "no-store");
    if (req.method === "GET") return res.status(200).json({ ok: true, enabled: Boolean(process.env.BLOB_READ_WRITE_TOKEN) });
    if (req.method !== "POST") return res.status(405).json({ error: "method not allowed" });
    if (!process.env.BLOB_READ_WRITE_TOKEN) return res.status(204).end();
    const origin = req.headers.origin || "";
    if (origin && new URL(origin).host !== req.headers.host) return res.status(403).json({ error: "forbidden" });

    let body;
    try {
        body = await readBody(req);
    } catch {
        return res.status(400).json({ error: "bad body" });
    }
    const events = body && typeof body.events === "object" && body.events ? body.events : {};
    const clean = {};
    for (const [id, value] of Object.entries(events).slice(0, MAX_IDS)) {
        if (!ID.test(id) || !value || typeof value !== "object") continue;
        const copy = Math.min(MAX_COUNT, Math.max(0, Math.floor(Number(value.copy) || 0)));
        const use = Math.min(MAX_COUNT, Math.max(0, Math.floor(Number(value.use) || 0)));
        if (copy || use) clean[id] = { copy, use };
    }
    if (!Object.keys(clean).length) return res.status(204).end();

    if (Date.now() - windowStart > 3_600_000) {
        windowStart = Date.now();
        writesInWindow = 0;
    }
    if (++writesInWindow > WRITES_PER_HOUR) return res.status(429).json({ error: "busy" });

    const day = new Date().toISOString().slice(0, 10);
    try {
        await put(`usage/${day}/batch.json`, JSON.stringify({ v: 1, day, events: clean }), {
            access: "private",
            addRandomSuffix: true,
            contentType: "application/json",
        });
    } catch (error) {
        console.error("usage put failed", error?.message);
        return res.status(502).json({ error: "store unavailable" });
    }
    return res.status(204).end();
}
