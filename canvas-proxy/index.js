#!/usr/bin/env node
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { Readable } from "node:stream";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { PROXY_PROTOCOL, PROXY_TOKEN_HEADER, normalizeProxyOrigin, normalizeProxyBase, normalizeProxyTarget, isAuthorizedProxyTarget } from "./policy.js";
const pkg = createRequire(import.meta.url)("./package.json");
const METHODS = new Set(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "PROPFIND", "MKCOL"]);
const HOP_HEADERS = ["connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "te", "trailer", "transfer-encoding", "upgrade"];
const SKIP_REQUEST_HEADERS = new Set([...HOP_HEADERS, "host", "content-length", "accept-encoding", "origin", "referer", "cookie", PROXY_TOKEN_HEADER, "sec-fetch-dest", "sec-fetch-mode", "sec-fetch-site"]);
const SKIP_RESPONSE_HEADERS = new Set([...HOP_HEADERS, "content-encoding", "content-length", "set-cookie"]);

function readBody(req) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        req.on("data", (chunk) => chunks.push(chunk));
        req.on("end", () => resolve(Buffer.concat(chunks)));
        req.on("error", reject);
        req.on("aborted", () => reject(new Error("客户端中断请求")));
    });
}
function readTarget(value) {
    if (!value.startsWith("/http://") && !value.startsWith("/https://")) return null;
    try { return new URL(value.slice(1)); } catch { return null; }
}
function validToken(value, expected) {
    if (typeof value !== "string") return false;
    const incoming = Buffer.from(value), token = Buffer.from(expected);
    return incoming.length === token.length && timingSafeEqual(incoming, token);
}
function requestHeaders(req) {
    const skip = new Set([...SKIP_REQUEST_HEADERS, ...(req.headers.connection || "").toLowerCase().split(",").map((key) => key.trim())]);
    return Object.fromEntries(Object.entries(req.headers).filter(([key, value]) => !skip.has(key) && value !== undefined).map(([key, value]) => [key, Array.isArray(value) ? value.join(", ") : value]));
}
function cors(origin) {
    return { "access-control-allow-origin": origin, vary: "Origin", "access-control-expose-headers": "content-type, retry-after, x-request-id, etag" };
}
function sendJson(res, status, payload, headers = {}) {
    res.writeHead(status, { ...headers, "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
    res.end(JSON.stringify(payload));
}

export function createProxyServer({ origins = [], targets = [], token = randomBytes(32).toString("base64url"), logger = console.log } = {}) {
    const allowedOrigins = new Set(origins.map(normalizeProxyOrigin));
    const allowedTargets = [...new Set(targets.map(normalizeProxyTarget))];
    if (!allowedOrigins.size || !allowedTargets.length || !token) throw new Error("请通过 --origin 明确授权网页来源，通过 --target 明确授权服务地址");
    return createServer(async (req, res) => {
        const origin = req.headers.origin;
        const headers = typeof origin === "string" && allowedOrigins.has(origin) ? cors(origin) : {};
        const reject = (status, code, message) => sendJson(res, status, { code, error: message }, headers);
        try {
            try { normalizeProxyBase(`http://${req.headers.host}`); } catch { reject(403, "PROXY_HOST_DENIED", "代理仅接受本机地址访问"); return; }
            if (!Object.keys(headers).length) { reject(403, "PROXY_ORIGIN_DENIED", "当前网页来源未授权，请用 --origin 添加实际站点来源并重新配对"); return; }
            const target = readTarget(req.url || "/");
            if (req.url !== "/" && !target) { reject(400, "PROXY_TARGET_INVALID", "无效的转发地址"); return; }
            if (target && (!isAuthorizedProxyTarget(target.href, allowedTargets) || (target.port === String(req.socket.localPort) && ["localhost", "127.0.0.1", "[::1]"].includes(target.hostname)))) { reject(403, "PROXY_TARGET_DENIED", "目标服务未授权，请在启动命令添加对应 --target 后重新配对"); return; }
            if (req.method === "OPTIONS") {
                const method = req.headers["access-control-request-method"];
                if (!METHODS.has(method)) { reject(405, "PROXY_METHOD_DENIED", "请求方法不允许"); return; }
                res.writeHead(204, { ...headers, "access-control-allow-methods": method, "access-control-allow-headers": req.headers["access-control-request-headers"] || "", "access-control-allow-private-network": "true", vary: "Origin, Access-Control-Request-Method, Access-Control-Request-Headers" });
                res.end(); return;
            }
            if (!validToken(req.headers[PROXY_TOKEN_HEADER], token)) { reject(401, "PROXY_PAIRING_REQUIRED", "配对凭据缺失或已失效，请导入当前代理进程生成的配对文件"); return; }
            if (!METHODS.has(req.method)) { reject(405, "PROXY_METHOD_DENIED", "请求方法不允许"); return; }
            if (!target) { sendJson(res, 200, { app: "dianran", proxy: pkg.name, version: pkg.version, protocol: PROXY_PROTOCOL, targets: allowedTargets }, headers); return; }
            const started = Date.now();
            const controller = new AbortController();
            res.on("close", () => controller.abort());
            const body = req.method === "GET" || req.method === "HEAD" ? undefined : await readBody(req);
            const upstream = await fetch(target, { method: req.method, headers: requestHeaders(req), body, redirect: "manual", signal: controller.signal });
            logger(`${req.method} ${target.origin} -> ${upstream.status} ${((Date.now() - started) / 1000).toFixed(1)}s`);
            if (upstream.status >= 300 && upstream.status < 400 && upstream.status !== 304) {
                await upstream.body?.cancel();
                reject(409, "PROXY_REDIRECT_DENIED", "代理不会自动跟随重定向，请核对渠道的最终服务地址；下载服务需单独授权"); return;
            }
            const responseHeaders = { ...headers };
            const responseSkip = new Set([...SKIP_RESPONSE_HEADERS, ...(upstream.headers.get("connection") || "").toLowerCase().split(",").map((key) => key.trim())]);
            upstream.headers.forEach((value, key) => { if (!responseSkip.has(key) && !key.startsWith("access-control-")) responseHeaders[key] = value; });
            responseHeaders.vary = [upstream.headers.get("vary"), "Origin"].filter(Boolean).join(", ");
            res.writeHead(upstream.status, responseHeaders);
            if (!upstream.body) { res.end(); return; }
            const stream = Readable.fromWeb(upstream.body);
            stream.on("error", () => res.destroy());
            res.on("close", () => stream.destroy());
            stream.pipe(res);
        } catch {
            // Do not include target queries, request headers, credentials or upstream error text in logs.
            logger("代理转发失败");
            if (res.headersSent) res.destroy();
            else reject(502, "PROXY_FORWARD_FAILED", "本地代理转发失败，请检查目标服务地址、网络与渠道配置");
        }
    });
}

export function startProxy(args = process.argv.slice(2)) {
    const value = (name, fallback) => { const index = args.indexOf(`--${name}`); return index >= 0 ? args[index + 1] : fallback; };
    const values = (name) => args.flatMap((arg, index) => arg === `--${name}` ? [args[index + 1]] : []);
    if (args.includes("--help") || args.includes("-h")) {
        console.log(`${pkg.name} v${pkg.version}\nUsage: npx ${pkg.name}@latest --origin <网页来源> --target <服务基础地址> [--target <其他服务>] [--port 23210] [--host 127.0.0.1] [--pairing-file <文件路径>]\n仅监听回环地址。导入生成的配对文件后连接；凭据不输出到终端。`);
        return;
    }
    const port = Number(value("port", process.env.PORT || "23210"));
    const host = value("host", process.env.HOST || "127.0.0.1");
    let proxyUrl = normalizeProxyBase(`http://${host.includes(":") && !host.startsWith("[") ? `[${host}]` : host}:${port}`);
    const origins = values("origin").map(normalizeProxyOrigin), targets = values("target").map(normalizeProxyTarget);
    const token = randomBytes(32).toString("base64url");
    const server = createProxyServer({ origins, targets, token });
    const file = value("pairing-file", join(homedir(), ".dianran", `proxy-pairing-${port}-${process.pid}.json`));
    server.on("error", () => { console.error("代理启动失败，请检查监听地址、端口及配对文件路径"); process.exitCode = 1; });
    server.listen(port, host.replace(/^\[|\]$/g, ""), () => {
        try {
            const address = new URL(proxyUrl);
            address.port = String(server.address().port);
            proxyUrl = address.origin;
            mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
            writeFileSync(file, JSON.stringify({ protocol: PROXY_PROTOCOL, proxyUrl, token, origins, targets }, null, 2), { mode: 0o600, flag: "wx" });
            console.log(`${pkg.name} v${pkg.version} 已启动：${proxyUrl}\n授权来源：${origins.join(", ")}\n授权服务：${targets.join(", ")}\n设置 → 本地代理 → 导入配对文件：${file}`);
            process.on("exit", () => rmSync(file, { force: true }));
            for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => { server.closeAllConnections(); server.close(() => process.exit()); });
        } catch { console.error("无法安全创建配对文件，代理已停止；请换用尚不存在的文件路径"); server.close(); process.exitCode = 1; }
    });
    return server;
}
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
    try { startProxy(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
