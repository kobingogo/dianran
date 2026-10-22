const PREFIX = "/api/model-gateway/whatstoken";
const UPSTREAM = "https://www.whatstoken.ai";
const endpoints = {
    GET: /^\/v1\/(?:models|video\/generations\/[A-Za-z0-9_-]+|videos\/[A-Za-z0-9_-]+(?:\/content)?)$/,
    POST: /^\/v1\/(?:images\/(?:generations|edits)|video\/generations|videos)$/,
};

export default {
    async fetch(request, env) {
        const url = new URL(request.url);
        const origin = request.headers.get("origin") || "";
        const allowed = env.ALLOWED_ORIGINS.split(",").map((value) => value.trim()).includes(origin) && origin !== "";
        const cors: Record<string, string> = allowed ? { "access-control-allow-origin": origin, "vary": "Origin", "access-control-expose-headers": "retry-after, x-request-id" } : {};
        const fail = (code: string, error: string, status: number) => Response.json({ code, error }, { status, headers: { ...cors, "cache-control": "no-store" } });
        if (!allowed) return fail("GATEWAY_ORIGIN_DENIED", "此网页尚未获准使用点染云端网关", 403);
        if (url.search || url.hash || /%|\\/.test(url.pathname)) return fail("GATEWAY_PATH_DENIED", "云端网关不接受查询参数或编码路径", 400);
        const path = url.pathname.startsWith(PREFIX + "/") ? url.pathname.slice(PREFIX.length) : "";
        if (!Object.values(endpoints).some((pattern) => pattern.test(path))) return fail("GATEWAY_PATH_DENIED", "此接口尚未获准通过云端网关调用", 404);
        if (request.method === "OPTIONS") {
            const method = request.headers.get("access-control-request-method") || "";
            if (!(method in endpoints) || !endpoints[method as keyof typeof endpoints].test(path)) return fail("GATEWAY_METHOD_DENIED", "此请求方法未授权", 405);
            const headers = (request.headers.get("access-control-request-headers") || "").toLowerCase().split(",").map((value) => value.trim()).filter(Boolean);
            if (headers.some((header) => !["authorization", "content-type", "accept"].includes(header))) return fail("GATEWAY_HEADERS_DENIED", "此请求头未授权", 403);
            return new Response(null, { status: 204, headers: { ...cors, "access-control-allow-methods": method, "access-control-allow-headers": "authorization, content-type, accept", "cache-control": "no-store" } });
        }
        if (!(request.method in endpoints) || !endpoints[request.method as keyof typeof endpoints].test(path)) return fail("GATEWAY_METHOD_DENIED", "此请求方法未授权", 405);
        const authorization = request.headers.get("authorization") || "";
        if (!/^Bearer\s+\S+$/i.test(authorization)) return fail("GATEWAY_AUTH_REQUIRED", "请填写自己的渠道 Token", 401);
        const ip = request.headers.get("cf-connecting-ip");
        if (!ip || !env.GATEWAY_RATE_LIMITER) return fail("GATEWAY_UNAVAILABLE", "云端网关尚未就绪，请稍后重试", 503);
        try {
            // Cloudflare's native limiter is approximate per edge location; this is not a billing quota.
            if (!(await env.GATEWAY_RATE_LIMITER.limit({ key: ip })).success) return fail("GATEWAY_RATE_LIMITED", "云端网关访问频繁，请稍后重试；本次请求未转发", 429);
        } catch { return fail("GATEWAY_UNAVAILABLE", "云端网关暂不可用；本次请求未转发", 503); }
        const headers = new Headers({ authorization });
        for (const name of ["content-type", "accept"]) {
            const value = request.headers.get(name);
            if (value) headers.set(name, value);
        }
        try {
            // The host is fixed. Neither cookies nor proxy credentials are forwarded, and redirects never carry the Token.
            const response = await fetch(UPSTREAM + path, { method: request.method, headers, body: request.method === "POST" ? request.body : undefined, redirect: "manual", cache: "no-store", signal: request.signal });
            if (response.status >= 300 && response.status < 400) {
                await response.body?.cancel();
                return fail("GATEWAY_REDIRECT_DENIED", "渠道返回跳转，网关已停止转发，请核对原任务状态", 502);
            }
            const outputHeaders = new Headers({ ...cors, "cache-control": "no-store" });
            for (const name of ["content-type", "content-disposition", "retry-after", "x-request-id"]) {
                const value = response.headers.get(name);
                if (value) outputHeaders.set(name, value);
            }
            return new Response(response.body, { status: response.status, headers: outputHeaders });
        } catch {
            return fail("GATEWAY_FORWARD_FAILED", "网关连接渠道失败，结果可能未知，请勿直接重复提交生成", 502);
        }
    },
} satisfies ExportedHandler<Env>;
