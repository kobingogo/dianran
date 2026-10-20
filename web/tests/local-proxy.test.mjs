import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import * as policy from "../../canvas-proxy/policy.js";
const require=createRequire(import.meta.url),ts=require("typescript");
function load(path,mocks,globals={}) {
    const code=ts.transpileModule(readFileSync(new URL(path,import.meta.url),"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
    const module={exports:{}};
    new Function("require","module","exports",...Object.keys(globals),code)((id)=>{assert.ok(id in mocks,`unexpected import ${id}`);return mocks[id];},module,module.exports,...Object.values(globals));return module.exports;
}
function fixture() {
    const database=new Map(),calls=[],interceptors={};let response={proxy:"@kobinflow/canvas-proxy",protocol:2,version:"0.2.0",targets:["https://api.example/v1"]};let failNetwork=false,writer=true,status=200;
    const window={location:{origin:"http://localhost:3001"},localStorage:{getItem:(key)=>database.get(key)||null,setItem:(key,value)=>database.set(key,value),removeItem:(key)=>database.delete(key)}};
    const pairing={protocol:2,proxyUrl:"http://127.0.0.1:23210",token:"test-pairing-secret",origins:[window.location.origin],targets:["https://api.example/v1"]};
    const storage=load("../src/stores/use-local-proxy-store.ts",{zustand:require("zustand"),"@/constant/brand":{storageKey:(key)=>key},"@/lib/write-ownership":{assertBusinessWriter:()=>{if(!writer)throw new Error("readonly");}},"../../../canvas-proxy/policy.js":policy},{window});
    const fetch=async(input,init)=>{calls.push({input:String(input),init});if(failNetwork)throw new TypeError("Failed to fetch");return Response.json(response,{status});};
    const axios={interceptors:{request:{use:(fn)=>{interceptors.request=fn;}},response:{use:(success,failure)=>{interceptors.failure=failure;}}}};
    const transport=load("../src/services/api/proxy-transport.ts",{axios,"@/stores/use-local-proxy-store":storage,"../../../../canvas-proxy/policy.js":policy},{window,fetch});
    const service=load("../src/services/api/local-proxy.ts",{"@/stores/use-config-store":{normalizeLocalProxyUrl:(url)=>url,LOCAL_PROXY_PACKAGE:"@kobinflow/canvas-proxy"},"@/stores/use-local-proxy-store":storage,"./proxy-transport":transport,"../../../../canvas-proxy/policy.js":policy},{window,fetch});
    return {storage,transport,service,window,database,calls,pairing,interceptors,respond:(value,code=200)=>{response=value;status=code;},failNetwork:()=>{failNetwork=true;},readonly:()=>{writer=false;}};
}

test("pairing verifies proxy protocol/source before saving, remains outside shared config, and never enters URLs",async()=>{
    const f=fixture();await f.service.pairLocalProxy(JSON.stringify(f.pairing));
    assert.equal(f.storage.readProxyPairing().token,f.pairing.token);assert.deepEqual([...f.database.keys()],["local_proxy_pairing"]);
    assert.ok(!f.calls[0].input.includes(f.pairing.token));assert.equal(f.calls[0].init.headers[policy.PROXY_TOKEN_HEADER],f.pairing.token);
    assert.equal(await f.service.testLocalProxy(f.pairing.proxyUrl),"@kobinflow/canvas-proxy v0.2.0");
    assert.throws(()=>f.transport.authorizedProxyPairing("http://localhost:23210","https://api.example/v1/models"),/尚未/);
    assert.throws(()=>f.transport.authorizedProxyPairing(f.pairing.proxyUrl,"https://api.other/v1/models"),/未授权/);
    f.storage.forgetProxyPairing();assert.equal(f.storage.readProxyPairing(),null);
});

test("old protocol, remote credential destinations and wrong origins cannot pair or persist",async()=>{
    for(const invalid of [{...fixture().pairing,proxyUrl:"https://evil.example"},{...fixture().pairing,origins:["https://evil.example"]},{...fixture().pairing,protocol:1}]){
        const f=fixture();await assert.rejects(f.service.pairLocalProxy(JSON.stringify(invalid)));assert.equal(f.calls.length,0);assert.equal(f.database.size,0);
    }
    const f=fixture();f.respond({proxy:"@kobinflow/canvas-proxy",version:"0.1.0"});await assert.rejects(f.service.pairLocalProxy(JSON.stringify(f.pairing)),/协议/);assert.equal(f.database.size,0);
});

test("local policy refusal is not submitted, but upstream forwarding failure and redirects stay unknown", async () => {
    const f = fixture();
    assert.throws(() => f.transport.authorizedProxyPairing(f.pairing.proxyUrl), (error) => error.outcome === "not-submitted");
    await f.service.pairLocalProxy(JSON.stringify(f.pairing));
    for (const [code, outcome] of [["PROXY_TARGET_DENIED", "not-submitted"], ["PROXY_FORWARD_FAILED", "unknown"], ["PROXY_REDIRECT_DENIED", "unknown"]]) {
        f.respond({ code, error: "test refusal" }, 403);
        await assert.rejects(f.transport.proxyFetch(`${f.pairing.proxyUrl}/https://api.example/v1/images`), (error) => error.outcome === outcome);
    }
});

test("fetch injects pairing only into the bound proxy hop, preserves API headers, and explains permission failures",async()=>{
    const f=fixture();await f.service.pairLocalProxy(JSON.stringify(f.pairing));f.calls.length=0;
    await f.transport.proxyFetch(`${f.pairing.proxyUrl}/https://api.example/v1/responses`,{method:"POST",headers:{authorization:"Bearer provider-key"},body:"{}"});
    assert.equal(f.calls[0].init.headers.get(policy.PROXY_TOKEN_HEADER),f.pairing.token);assert.equal(f.calls[0].init.headers.get("authorization"),"Bearer provider-key");assert.equal(f.calls[0].init.redirect,"error");
    await f.transport.proxyFetch("https://api.example/v1/models",{headers:{[policy.PROXY_TOKEN_HEADER]:f.pairing.token}});assert.equal(f.calls[1].init.headers.get(policy.PROXY_TOKEN_HEADER),null);
    f.respond({code:400,error:"provider error"},400);
    assert.equal((await f.transport.proxyFetch(`${f.pairing.proxyUrl}/https://api.example/v1/models`)).status,400);
    f.failNetwork();await assert.rejects(f.transport.proxyFetch(`${f.pairing.proxyUrl}/https://api.example/v1/models`),/本地网络访问/);
});

test("Axios attaches the same protected credential and surfaces proxy JSON/blob errors without masking provider blobs",async()=>{
    const f=fixture();await f.service.pairLocalProxy(JSON.stringify(f.pairing));f.transport.installProxyTransport();
    const values=new Map([["authorization","Bearer provider-key"]]);const config={url:`${f.pairing.proxyUrl}/https://api.example/v1/models`,headers:{toJSON:()=>Object.fromEntries(values),delete:(key)=>values.delete(key),set:(key,value)=>values.set(key,value)}};
    f.interceptors.request(config);assert.equal(values.get(policy.PROXY_TOKEN_HEADER),f.pairing.token);assert.equal(config.withCredentials,false);
    await assert.rejects(f.interceptors.failure({config,response:{data:new Blob([JSON.stringify({code:"PROXY_PAIRING_REQUIRED",error:"请重新配对"})])}}),/重新配对/);
    for(const data of [new Blob(["provider plain-text failure"]),{code:400,error:"provider numeric code"}]) { const provider={config,response:{data}};await assert.rejects(f.interceptors.failure(provider),(error)=>error===provider); }
});

test("damaged pairing does not block app startup; requests fail closed and read-only cannot replace credentials",()=>{
    const f=fixture();f.database.set("local_proxy_pairing","broken secret payload");f.storage.reloadProxyPairing();assert.equal(f.storage.useLocalProxyStore.getState().pairing,null);assert.match(f.storage.useLocalProxyStore.getState().error,/无法读取/);
    assert.throws(()=>f.transport.authorizedProxyPairing(f.pairing.proxyUrl),/不是有效/);
    f.readonly();assert.throws(()=>f.storage.saveProxyPairing(f.pairing),/readonly/);assert.throws(f.storage.forgetProxyPairing,/readonly/);
    assert.equal(f.database.get("local_proxy_pairing"),"broken secret payload");
});
