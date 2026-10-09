const SOURCE_PREFIX = "/prompt-sources/";
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
const types = { json: "application/json; charset=utf-8", webp: "image/webp", md: "text/markdown; charset=utf-8" };
export default {
    async fetch(request, env) {
        const url = new URL(request.url);
        if (url.pathname === "/api/usage") {
            if (request.method === "GET") return json({ ok: true, enabled: false, protocol: 2 });
            if (request.method === "POST") return json({ enabled: false, error: "statistics disabled on this deployment" }, 503);
            return json({ error: "method not allowed" }, 405);
        }
        if (url.pathname === "/api" || url.pathname.startsWith("/api/")) return json({ error: "API not implemented" }, 404);
        if (url.pathname === "/prompt-sources" || url.pathname.startsWith(SOURCE_PREFIX)) {
            if (!["GET", "HEAD"].includes(request.method)) return json({ error: "method not allowed" }, 405);
            let resource;
            try { resource = decodeURIComponent(url.pathname.slice(SOURCE_PREFIX.length)); } catch { return json({ error: "invalid resource path" }, 400); }
            // Public prompt snapshots contain JSON/Markdown and content-addressed covers only.
            if (!resource || resource.includes("\\") || resource.includes("%") || resource.split("/").some((part) => !part || part === "." || part === "..") || !/^(?:[A-Za-z0-9_-]+\.(?:json|md)|covers\/[A-Za-z0-9_-]+\.webp)$/.test(resource)) return json({ error: "invalid resource path" }, 400);
            if (!env.PROMPTS || !/^[a-f0-9]{40}$/.test(env.PROMPT_SNAPSHOT || "")) return json({ error: "prompt snapshot binding not configured" }, 503);
            let object;
            try { object = await env.PROMPTS.get(`snapshots/${env.PROMPT_SNAPSHOT}/${resource}`); } catch { return json({ error: "prompt storage unavailable" }, 502); }
            if (!object) return json({ error: "resource not found" }, 404);
            const headers = new Headers({ "content-type": types[resource.split(".").at(-1)] });
            if(resource.startsWith("covers/"))headers.set("cache-control","public, max-age=31536000, immutable");
            else if(resource.endsWith(".json"))headers.set("cache-control","public, max-age=60, must-revalidate");
            if (object.httpEtag) headers.set("etag", object.httpEtag);
            if (request.headers.get("if-none-match") === object.httpEtag) return new Response(null, { status: 304, headers });
            return new Response(request.method === "HEAD" ? null : object.body, { headers });
        }
        return env.ASSETS.fetch(request);
    },
};
