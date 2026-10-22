import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import * as policy from "../../canvas-proxy/policy.js";

const ts = createRequire(import.meta.url)("typescript");
function load(path, mocks = {}, globals = {}, base = "") {
    const module = { exports: {} };
    const source = readFileSync(new URL(path, import.meta.url), "utf8").replace("import.meta.env.VITE_MODEL_GATEWAY_URL", JSON.stringify(base));
    const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
    vm.runInNewContext(code, { exports: module.exports, require: (id) => { assert.ok(id in mocks, id); return mocks[id]; }, URL, Headers, Request, Response, Blob, ...globals });
    return module.exports;
}
const origin = "https://dianran.example", gateway = "https://gateway.example/api/model-gateway";
function fixture(respond = async () => new Response("fixture")) {
    const calls = [], limits = [];
    let allowed = true;
    const env = { ALLOWED_ORIGINS: origin, GATEWAY_RATE_LIMITER: { limit: async (input) => { limits.push(input.key); return { success: allowed }; } } };
    const worker = load("../../cloudflare/gateway/worker.ts", {}, { fetch: async (...args) => { calls.push(args); return respond(...args); } }).default;
    const request = (path = "/v1/models", options = {}) => new Request(gateway + "/whatstoken" + path, { ...options, headers: { origin, authorization: "Bearer fixture-only-token", "cf-connecting-ip": "203.0.113.1", ...options.headers } });
    return { worker, env, calls, limits, request, limit: () => { allowed = false; } };
}

test("gateway fixes the upstream host, streams bodies, and strips ambient credentials", async () => {
    let controller;
    const stream = new ReadableStream({ start(value) { controller = value; value.enqueue(new TextEncoder().encode("first")); } });
    const f = fixture(async () => new Response(stream, { headers: { "content-type": "text/event-stream", "set-cookie": "provider=secret" } }));
    const response = await f.worker.fetch(f.request("/v1/images/generations", { method: "POST", body: '{"model":"gpt-image-2-official"}', headers: { "content-type": "application/json", cookie: "session=secret", "x-dianran-proxy-token": "local-secret", "x-forwarded-for": "attacker" } }), f.env);
    assert.equal(f.calls[0][0], "https://www.whatstoken.ai/v1/images/generations");
    const options = f.calls[0][1];
    assert.equal(options.headers.get("authorization"), "Bearer fixture-only-token");
    for (const name of ["cookie", "origin", "x-dianran-proxy-token", "x-forwarded-for"]) assert.equal(options.headers.get(name), null);
    assert.equal(await new Response(options.body).text(), '{"model":"gpt-image-2-official"}');
    assert.equal(options.redirect, "manual");
    assert.equal(options.cache, "no-store");
    assert.equal(response.headers.get("set-cookie"), null);
    assert.equal(response.headers.get("cache-control"), "no-store");
    const reader = response.body.getReader();
    assert.equal(new TextDecoder().decode((await reader.read()).value), "first");
    controller.enqueue(new TextEncoder().encode("last")); controller.close();
    assert.equal(new TextDecoder().decode((await reader.read()).value), "last");
    assert.equal((await reader.read()).done, true);
});

test("gateway rejects wrong origins, arbitrary URLs, queries and methods before forwarding", async () => {
    const f = fixture();
    for (const request of [f.request("/v1/models", { headers: { origin: "https://evil.example" } }), f.request("/v1/models", { headers: { authorization: "" } }), f.request("/v1/models?key=secret"), f.request("/v1/%6dodels"), f.request("/https://evil.example/v1/models"), f.request("/v1/models", { method: "POST" }), f.request("/v1/models", { method: "DELETE" })]) {
        const response = await f.worker.fetch(request, f.env);
        assert.ok(response.status >= 400);
        assert.ok(!(await response.text()).includes("secret"));
    }
    assert.equal(f.calls.length, 0);
    assert.equal(f.limits.length, 0);
});

test("preflight authorizes only the documented method and request headers", async () => {
    const f = fixture();
    const response = await f.worker.fetch(f.request("/v1/models", { method: "OPTIONS", headers: { "access-control-request-method": "GET", "access-control-request-headers": "Authorization, Content-Type" } }), f.env);
    assert.equal(response.status, 204);
    assert.equal(response.headers.get("access-control-allow-origin"), origin);
    assert.equal((await f.worker.fetch(f.request("/v1/models", { method: "OPTIONS", headers: { "access-control-request-method": "GET", "access-control-request-headers": "x-dianran-proxy-token" } }), f.env)).status, 403);
    assert.equal(f.calls.length, 0);
});

test("rate limit rejection never reaches the upstream; errors and redirects never retry", async () => {
    const f = fixture(); f.limit();
    const limited = await f.worker.fetch(f.request(), f.env);
    assert.equal(limited.status, 429);
    assert.equal((await limited.json()).code, "GATEWAY_RATE_LIMITED");
    assert.equal(f.calls.length, 0);
    for (const respond of [async () => { throw Error("secret fixture credential"); }, async () => new Response("", { status: 307, headers: { location: "https://evil.example" } })]) {
        const failed = fixture(respond);
        const response = await failed.worker.fetch(failed.request("/v1/video/generations", { method: "POST", body: "{}" }), failed.env);
        assert.equal(response.status, 502);
        assert.ok(!(await response.text()).includes("secret"));
        assert.equal(failed.calls.length, 1);
    }
});

test("multipart image edits keep their exact image bytes and boundary", async () => {
    const form = new FormData(); form.set("model", "gpt-image-2-official"); form.set("image", new Blob([new Uint8Array([1, 2, 255])], { type: "image/png" }), "ref.png");
    const f = fixture(async (_url, options) => {
        const parsed = await new Response(options.body, { headers: options.headers }).formData();
        assert.equal(parsed.get("model"), "gpt-image-2-official");
        assert.deepEqual([...new Uint8Array(await parsed.get("image").arrayBuffer())], [1, 2, 255]);
        return Response.json({ data: [] });
    });
    assert.equal((await f.worker.fetch(f.request("/v1/images/edits", { method: "POST", body: form }), f.env)).status, 200);
});

test("frontend routing affects WhatsToken only, is idempotent and can be disabled", () => {
    const api = load("../src/services/api/model-gateway.ts", {}, {}, gateway);
    const mapped = api.modelGatewayUrl("https://www.whatstoken.ai/v1/models");
    assert.equal(mapped, gateway + "/whatstoken/v1/models");
    assert.equal(api.modelGatewayUrl(mapped), mapped);
    for (const url of ["https://api.openai.com/v1/models", "https://www.whatstoken.ai.evil.test/v1/models", "https://user:pass@www.whatstoken.ai/v1/models", "https://www.whatstoken.ai/v1/models?token=secret"]) assert.equal(api.modelGatewayUrl(url), "");
    assert.equal(load("../src/services/api/model-gateway.ts").modelGatewayUrl("https://www.whatstoken.ai/v1/models"), "");
    assert.throws(() => load("../src/services/api/model-gateway.ts", {}, {}, "http://untrusted.example").modelGatewayUrl("https://www.whatstoken.ai/v1/models"), (error) => error.outcome === "not-submitted");
});

test("client strips local pairing credentials and preserves submitted versus unknown outcomes", async () => {
    const callbacks = {};
    const routes = load("../src/services/api/model-gateway.ts", {}, {}, gateway);
    const transport = load("../src/services/api/proxy-transport.ts", { axios: { interceptors: { request: { use: (fn) => { callbacks.request = fn; } }, response: { use: (_success, fn) => { callbacks.failure = fn; } } } }, "./model-gateway": routes, "@/stores/use-local-proxy-store": {}, "../../../../canvas-proxy/policy.js": policy });
    const url = routes.modelGatewayUrl("https://www.whatstoken.ai/v1/models");
    assert.equal(transport.proxyRequestHeaders(url, { "x-dianran-proxy-token": "local-secret", authorization: "Bearer own-token" }).get("x-dianran-proxy-token"), null);
    transport.installProxyTransport();
    for (const [code, outcome] of [["GATEWAY_RATE_LIMITED", "not-submitted"], ["GATEWAY_ORIGIN_DENIED", "not-submitted"], ["GATEWAY_FORWARD_FAILED", "unknown"], ["GATEWAY_REDIRECT_DENIED", "unknown"]]) await assert.rejects(callbacks.failure({ config: { url }, response: { data: { code, error: "fixture" } } }), (error) => error.outcome === outcome);
});
