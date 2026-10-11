// [dianran] Anonymous prompt-usage counter (Vercel serverless function, Node runtime).
// The browser batches "copy" / "use" counts per prompt id locally and flushes them here at most about once a day.
// Each immutable batch is stored under its identity in a private Vercel Blob (usage/<batchId>.json)
// and later summed by brand/pipeline/usage-read.mjs. Stored: prompt ids, counts and the UTC day. Not stored: IP,
// user agent, cookies, or user identifiers. A random batch identity is retained for deduplication. No cookies are set.
import { put, get } from "@vercel/blob";

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
    if (req.method === "GET") return res.status(200).json({ ok: true, enabled: Boolean(process.env.BLOB_READ_WRITE_TOKEN), protocol: 2 });
    if (req.method !== "POST") return res.status(405).json({ error: "method not allowed" });
    if (!process.env.BLOB_READ_WRITE_TOKEN) return res.status(503).json({ error: "statistics disabled", enabled: false });
    const origin = req.headers.origin || "";
    try { if (origin && new URL(origin).host !== req.headers.host) return res.status(403).json({ error: "forbidden" }); } catch { return res.status(403).json({ error: "forbidden" }); }

    let body;
    try {
        body = await readBody(req);
    } catch {
        return res.status(400).json({ error: "bad body" });
    }
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body?.batchId || "") || !/^\d{4}-\d{2}-\d{2}$/.test(body?.day || "")) return res.status(400).json({ error: "batch identity required" });
    const events = body && typeof body.events === "object" && body.events ? body.events : {};
    const clean = {};
    for (const [id, value] of Object.entries(events).slice(0, MAX_IDS)) {
        if (!ID.test(id) || !value || typeof value !== "object") continue;
        const copy = Math.min(MAX_COUNT, Math.max(0, Math.floor(Number(value.copy) || 0)));
        const use = Math.min(MAX_COUNT, Math.max(0, Math.floor(Number(value.use) || 0)));
        if (copy || use) clean[id] = { copy, use };
    }
    if (!Object.keys(clean).length || Object.keys(events).length > MAX_IDS || JSON.stringify(clean) !== JSON.stringify(events)) return res.status(400).json({ error: "invalid counters" });

    if (Date.now() - windowStart > 3_600_000) {
        windowStart = Date.now();
        writesInWindow = 0;
    }
    if (++writesInWindow > WRITES_PER_HOUR) return res.status(429).json({ error: "busy" });

    const day = body.day;
    const pathname = `usage/${body.batchId}.json`;
    const stored = JSON.stringify({ v: 2, batchId: body.batchId, day, events: clean });
    try {
        await put(pathname, stored, { access: "private", addRandomSuffix: false, allowOverwrite: false, contentType: "application/json" });
    } catch {
        // The first accepted payload owns this identity, including a retry after its response was lost.
        try {
            const existing = await get(pathname, { access: "private", useCache: false });
            if (!existing || existing.statusCode !== 200) throw new Error("not stored");
            if (await new Response(existing.stream).text() !== stored) return res.status(409).json({ error: "batch identity conflict" });
        } catch { return res.status(502).json({ error: "store unavailable" }); }
    }
    return res.status(200).json({ accepted: true, batchId: body.batchId });
}
