import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { webcrypto } from "node:crypto";
const require = createRequire(import.meta.url), ts = require("typescript");
function load(file, mocks, globals = {}, replace = (s) => s) {
 const source = replace(readFileSync(new URL(file, import.meta.url), "utf8"));
 const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
 const module = { exports: {} };
 new Function("require", "module", "exports", ...Object.keys(globals), code)((id) => { if (!(id in mocks)) throw new Error(`Unexpected import ${id}`); return mocks[id]; }, module, module.exports, ...Object.values(globals));
 return module.exports;
}
function pluginFixture() {
 let evaluations = 0, source = "snapshot-one", plugins = [];
 const store = { get plugins() { return plugins; }, upsert: (record) => { plugins = [...plugins.filter((p) => p.id !== record.id), record]; }, remove: (id) => {plugins = plugins.filter((p) => p.id !== id);}, setEnabled: (id, enabled) => { plugins.find((p) => p.id === id).enabled = enabled; } };
 const plugin = { id: "safe", name: "Safe", nodes: [{}] };
 const api = load("../src/lib/canvas/plugin-loader.ts", { "./image-tools-plugin": { imageToolsPlugin: { id: "dianran-image-tools", nodes: [] } }, "@/lib/canvas/node-registry": { registerNodeDefinitions() {}, unregisterPluginNodes() {} }, "@/lib/canvas/plugin-runtime": { getPluginRuntime: () => ({}) }, "@/stores/canvas/use-plugin-store": { usePluginStore: { getState: () => store, persist: { rehydrate: async () => {} } } }, "@/i18n": { t: (v) => v }, "@/lib/write-ownership": { assertBusinessWriter() {} }, "blob:test": { __esModule: true, default: () => { evaluations++; return plugin; } } }, { crypto: webcrypto, URL: { createObjectURL: () => "blob:test", revokeObjectURL() {} }, fetch: async (url) => url === "/plugins/index.json" ? Response.json(["/plugins/local.js"]) : new Response(source) }, (s) => s.replace("import.meta.env.VITE_DEV_PLUGINS", '""'));
 return { api, store, evaluations: () => evaluations, change: (next) => { source = next; } };
}
test("download cancellation and disabled local discovery never evaluate source", async () => {
 const f = pluginFixture(); let review;
 assert.equal(await f.api.installPluginFromUrl("https://example/plugin.js", { authorize: async (value) => { review = value; return false; } }), null);
 assert.match(review.digest, /^[a-f0-9]{64}$/); assert.equal(f.evaluations(), 0); assert.equal(f.store.plugins.length, 0);
 await f.api.ensurePluginsLoaded(); assert.equal(f.evaluations(), 0); assert.equal(f.store.plugins[0].enabled, false);
});
test("authorized exact snapshot is pinned and changed update requires fresh review", async () => {
 const f = pluginFixture(); await f.api.installPluginFromUrl("https://example/plugin.js", { authorize: async () => true });
 const record = f.store.plugins[0]; assert.equal(f.evaluations(), 1);
 f.change("snapshot-two"); let review;
 await f.api.updatePlugin(record, async (value) => { review = value; return false; });
 assert.equal(f.evaluations(), 1); assert.equal(review.previousDigest, record.sourceDigest); assert.notEqual(review.digest, record.sourceDigest); assert.equal(f.store.plugins[0].source, "snapshot-one");
 await f.api.setPluginEnabled(record, true, async () => { throw new Error("unexpected review"); }); assert.equal(f.evaluations(), 2);
 await assert.rejects(f.api.setPluginEnabled({ ...record, source: "tampered" }, true, async () => true), /摘要/);
});
test("model HTTP helper keeps default Key within channel origin and path and permits explicit foreign auth", async () => {
 const calls = [];
 const api = load("../src/services/api/model-plugin.ts", { axios: { request: async (v) => {calls.push(v); return {data: "ok"};}, isCancel: () => false }, "@/i18n": {t: (v) => v}, "@/lib/write-ownership": {assertBusinessWriter() {}}, "@/stores/use-config-store": { withLocalProxy: (url) => url, buildApiUrl: (base, path) => `${base}${path}` } });
 const config = {baseUrl: "https://channel.example/v1", apiKey: "channel-secret", model: "mock"};
 await api.runModelPlugin({capability: "text", config, script: 'await http.get("/models"); await http.get("https://other.example/v1/models"); await http.get("https://channel.example/v10/models"); await http.get("https://other.example/v1/models", {headers:{Authorization:"Bearer explicit"}}); return "ok";'});
 assert.equal(calls[0].fetchOptions.redirect, "error"); assert.equal(calls[0].adapter, "fetch"); assert.equal(calls[0].headers.Authorization, "Bearer channel-secret"); assert.equal(calls[1].headers.Authorization, undefined); assert.equal(calls[2].headers.Authorization, undefined); assert.equal(calls[3].headers.Authorization, "Bearer explicit");
 assert.equal(api.isBoundPluginTarget(config.baseUrl, "https://channel.example/v1/../private"), false);
});
function usageFixture() {
 const db = new Map(); let mode = "lost", calls = [], enabled = true;
 const localforage = { getItem: async (k) => structuredClone(db.get(k)), setItem: async (k, v) => {db.set(k, structuredClone(v));} };
 const api = load("../src/services/usage-stats.ts", {localforage, "@/constant/brand": {STORAGE_NS:"test"}, "@/lib/write-ownership": { assertBusinessWriter() {}, writeOwnership: {canWrite: () => true} } }, {crypto: webcrypto, window: {}, navigator: {}, fetch: async (_, options) => { if (options?.method !== "POST") return Response.json({enabled, protocol: 2}); const batch = JSON.parse(options.body); calls.push(batch); if(mode === "lost") throw new TypeError("response lost"); if(mode === "refuse") return Response.json({error:"busy"}, {status:429}); return Response.json({accepted:true,batchId:batch.batchId}); } }, (s) => s.replace("import.meta.env.PROD", "true"));
 return {api,db,calls,mode:(v)=>{mode=v;},disabled:()=>{enabled=false;}};
}
test("uncertain and refused statistics retain identity until confirmed; new interactions remain queued", async () => {
 const f = usageFixture(); f.api.trackPromptUsage("x-trending:123"); await f.api.flushPromptUsage(true);
 const first = f.calls[0]; assert.ok(first.batchId); assert.ok([...f.db.values()][0].pending);
 f.mode("refuse"); f.api.trackPromptUsage("x-trending:123"); await f.api.flushPromptUsage(true); assert.equal(f.calls.at(-1).batchId,first.batchId);
 f.mode("ok"); await f.api.flushPromptUsage(true); assert.equal(f.calls.at(-1).batchId,first.batchId); assert.equal([...f.db.values()][0].pending,undefined); assert.equal([...f.db.values()][0].events["x-trending:123"].copy,1);
});
test("static API capability disables reporting without fabricating a receipt", async () => {
 const f=usageFixture();f.disabled();f.api.trackPromptUsage("x-trending:123");await f.api.flushPromptUsage(true);
 assert.equal(f.api.getPromptUsageStatus(),"unavailable");assert.equal(f.calls.length,0);assert.equal([...f.db.values()][0].events["x-trending:123"].copy,1);
});
function serverFixture() {
 const blobs = new Map(); let fail = false;
 const put = async (key, value) => {if (fail) throw new Error("offline"); if(blobs.has(key)) throw new Error("exists");blobs.set(key,value);};
 const get = async (key) => blobs.has(key) ? {statusCode:200,stream:new Blob([blobs.get(key)]).stream()} : null;
 const source = readFileSync(new URL("../../api/usage.js",import.meta.url),"utf8").replace('import { put, get } from "@vercel/blob";', '').replace('export default async function handler','async function handler');
 const handler = new Function("put","get","process", `${source};return handler;`)(put,get,{env:{BLOB_READ_WRITE_TOKEN:"test"}});
 const request = async (body, method="POST") => {let status;let result; const response={setHeader(){},status(v){status=v;return this;},json(v){result=v;return this;},end(){return this;}};await handler({method,headers:{origin:"https://dianran.example",host:"dianran.example"},body},response);return {status,result};};
 return {request,blobs,fail:()=>{fail=true;}};
}
test("server acknowledges only persisted identity and deduplicates retries or rejects conflicts", async () => {
 const f=serverFixture(), batch={batchId:webcrypto.randomUUID(),day:"2026-10-08",events:{"x-trending:123":{copy:1,use:0}}};
 assert.equal((await f.request(batch)).status,200);assert.equal((await f.request(batch)).result.batchId,batch.batchId);assert.equal(f.blobs.size,1);
 assert.equal((await f.request({...batch,events:{"x-trending:123":{copy:2,use:0}}})).status,409);
 assert.equal((await f.request({...batch,day:"2026-10-09"})).status,409);
 f.fail();assert.equal((await f.request({...batch,batchId:webcrypto.randomUUID()})).status,502);
});
test("aggregation after raw deletion failure cannot count a persisted identity twice", async () => {
 const source=readFileSync(new URL("../../brand/pipeline/usage-read.mjs",import.meta.url),"utf8");
 const start=source.indexOf("    agg.acceptedBatches ||= {}");const end=source.indexOf("    const cutoff",start);
 const aggregate=new (Object.getPrototypeOf(async function(){}).constructor)("agg","blobs","readJsonBlob","token","log", `${source.slice(start,end)};return {events,processed};`);
 const batch={batchId:webcrypto.randomUUID(),day:"2026-10-08",events:{"x-trending:123":{copy:2,use:1}}};const agg={days:{},totals:{}};
 const blobs=[{pathname:"usage/one",url:"url:one"}];
 assert.equal((await aggregate(agg,blobs,async()=>batch,"",()=>{})).events,3);
 assert.equal((await aggregate(agg,blobs,async()=>batch,"",()=>{})).events,0);
 assert.equal(agg.totals["x-trending:123"].copy,2);
});
