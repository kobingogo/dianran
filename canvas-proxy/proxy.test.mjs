import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer, request } from "node:http";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, stat, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { createProxyServer } from "./index.js";
import { PROXY_TOKEN_HEADER, isAuthorizedProxyTarget, normalizeProxyBase } from "./policy.js";
const origin = "http://localhost:3001", token = "isolated-test-pairing-token";
const listen = async (server) => { server.listen(0, "127.0.0.1"); await once(server, "listening"); return `http://127.0.0.1:${server.address().port}`; };
const close = async (server) => { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); };
async function fixture() {
    const received = [], logs = [];
    const upstream = createServer(async (req, res) => {
        const chunks=[]; for await (const chunk of req) chunks.push(chunk);
        received.push({url:req.url,method:req.method,headers:req.headers,body:Buffer.concat(chunks).toString()});
        if(req.url.includes("redirect")) { res.writeHead(307,{location:`${base}/outside/secret`}); res.end(); return; }
        if(req.url.includes("stream")) { res.writeHead(200,{"content-type":"text/event-stream"}); res.write("data: first\n\n"); await new Promise(resolve=>setImmediate(resolve)); res.end("data: last\n\n"); return; }
        if(req.url.includes("provider-error")) { res.writeHead(429,{"content-type":"application/json","retry-after":"1"}); res.end('{"error":"provider failure"}'); return; }
        res.writeHead(200,{"content-type":"application/json","set-cookie":"upstream=secret","access-control-allow-origin":"*"});res.end(JSON.stringify(received.at(-1)));
    });
    const base = await listen(upstream);
    const proxy = createProxyServer({origins:[origin],targets:[`${base}/v1`],token,logger:(line)=>logs.push(line)});
    const url=await listen(proxy);
    const call=(path,init={})=>fetch(`${url}/${base}${path}`,{...init,headers:{origin,[PROXY_TOKEN_HEADER]:token,...init.headers}});
    return {upstream,proxy,base,url,call,received,logs,close:async()=>{await close(proxy);await close(upstream);}};
}

test("origin, token and target are checked before any upstream contact; allowed local model preserves auth/body", async () => {
    const f=await fixture();
    try {
        for(const [path,headers,status] of [["/v1/models",{origin:"https://evil.example"},403],["/v1/models",{origin:"null"},403],["/v1/models",{origin:""},403],["/v1/models",{[PROXY_TOKEN_HEADER]:""},401],["/v1/models",{[PROXY_TOKEN_HEADER]:"wrong"},401],["/outside",{},403],["/v10/models",{},403],["/v1/%2F../secret",{},403]]) assert.equal((await f.call(path,{headers})).status,status);
        assert.equal(f.received.length,0);
        const response=await f.call("/v1/chat/completions?key=never-log-this",{method:"POST",headers:{authorization:"Bearer provider-key",cookie:"browser-secret=1","content-type":"application/json"},body:'{"model":"local-test","stream":true}'});
        assert.equal(response.status,200);
        const data=await response.json();
        assert.equal(data.headers.authorization,"Bearer provider-key");assert.equal(data.headers[PROXY_TOKEN_HEADER],undefined);assert.equal(data.headers.origin,undefined);assert.equal(data.headers.cookie,undefined);
        assert.equal(data.body,'{"model":"local-test","stream":true}');
        assert.equal(response.headers.get("access-control-allow-origin"),origin);assert.equal(response.headers.get("set-cookie"),null);
        assert.ok(f.logs.every(line=>!line.includes(token)&&!line.includes("never-log-this")&&!line.includes("provider-key")));
    } finally {await f.close();}
});

test("preflight neither grants a new origin nor authenticates a subsequent request; identity requires pairing",async()=>{
    const f=await fixture();try{
        const headers={"access-control-request-method":"POST","access-control-request-headers":`${PROXY_TOKEN_HEADER},content-type`};
        const good=await f.call("/v1/models",{method:"OPTIONS",headers});assert.equal(good.status,204);assert.equal(good.headers.get("access-control-allow-methods"),"POST");
        assert.equal((await f.call("/v1/models",{method:"OPTIONS",headers:{...headers,origin:"https://evil.example"}})).status,403);
        assert.equal((await f.call("/v1/models",{method:"OPTIONS",headers:{...headers,"access-control-request-method":"TRACE"}})).status,405);
        assert.equal((await f.call("/v1/models",{headers:{[PROXY_TOKEN_HEADER]:""}})).status,401);
        assert.equal(f.received.length,0);
        assert.equal((await fetch(f.url,{headers:{origin}})).status,401);
        const identity=await(await fetch(f.url,{headers:{origin,[PROXY_TOKEN_HEADER]:token}})).json();assert.equal(identity.protocol,2);assert.deepEqual(identity.targets,[`${f.base}/v1`]);assert.ok(!JSON.stringify(identity).includes(token));
    }finally{await f.close();}
});

test("redirects cannot escape authorization or forward credentials; errors and SSE remain readable",async()=>{
    const f=await fixture();try{
        const redirected=await f.call("/v1/redirect",{headers:{authorization:"Bearer provider-key"}});assert.equal(redirected.status,409);assert.equal((await redirected.json()).code,"PROXY_REDIRECT_DENIED");assert.deepEqual(f.received.map(x=>x.url),["/v1/redirect"]);
        const upstreamError=await f.call("/v1/provider-error");assert.equal(upstreamError.status,429);assert.equal(upstreamError.headers.get("retry-after"),"1");
        const stream=await f.call("/v1/stream");assert.match(stream.headers.get("content-type"),/event-stream/);assert.equal(await stream.text(),"data: first\n\ndata: last\n\n");
    }finally{await f.close();}
});

test("path grants use URL boundaries, reject credential/encoding tricks and keep explicit localhost models",()=>{
    assert.ok(isAuthorizedProxyTarget("http://localhost:11434/v1/models",["http://localhost:11434/v1"]));
    for(const url of ["http://localhost:11434/v10/models","http://localhost:11435/v1/models","http://localhost.evil:11434/v1/models","http://localhost:11434/v1/../secret","http://user:pass@localhost:11434/v1/models","http://localhost:11434/v1/%252e%252e/secret","http://localhost:11434/v1/%5c../secret"])assert.equal(isAuthorizedProxyTarget(url,["http://localhost:11434/v1"]),false,url);
    assert.throws(()=>normalizeProxyBase("http://evil.example:23210"));assert.throws(()=>normalizeProxyBase("http://0.0.0.0:23210"));
    assert.throws(()=>createProxyServer(),/明确授权/);
});

test("DNS-rebinding Host and recursive proxy target are rejected before forwarding",async()=>{
    const f=await fixture();try{
        const status=await new Promise((resolve,reject)=>{const req=request(`${f.url}/${f.base}/v1/models`,{headers:{host:"evil.example",origin,[PROXY_TOKEN_HEADER]:token}},res=>{res.resume();resolve(res.statusCode);});req.on("error",reject);req.end();});assert.equal(status,403);assert.equal(f.received.length,0);
        const reservation=createServer();const reserved=await listen(reservation);const port=reservation.address().port;await close(reservation);
        const self=createProxyServer({origins:[origin],targets:[reserved],token,logger:()=>{}});self.listen(port,"127.0.0.1");await once(self,"listening");const url=reserved;
        try{assert.equal((await fetch(`${url}/${url}/v1/models`,{headers:{origin,[PROXY_TOKEN_HEADER]:token}})).status,403);}finally{await close(self);}
    }finally{await f.close();}
});

test("CLI produces a private pairing file without logging credentials and revokes it on shutdown",async()=>{
    const directory=await mkdtemp(join(tmpdir(),"dianran-proxy-test-")),file=join(directory,"pairing.json");
    const child=spawn(process.execPath,[new URL("./index.js",import.meta.url).pathname,"--port","0","--origin",origin,"--target","http://127.0.0.1:11434/v1","--pairing-file",file],{stdio:["ignore","pipe","pipe"]});
    let output="";child.stdout.on("data",chunk=>{output+=chunk;});child.stderr.on("data",chunk=>{output+=chunk;});
    try{
        await new Promise((resolve,reject)=>{child.stdout.on("data",()=>{if(output.includes("导入配对文件"))resolve();});child.on("exit",()=>reject(new Error("CLI exited before pairing")));});
        const pairing=JSON.parse(await readFile(file,"utf8"));assert.equal(pairing.protocol,2);assert.equal((await stat(file)).mode&0o777,0o600);assert.ok(pairing.token);assert.ok(!output.includes(pairing.token));
        assert.notEqual(new URL(pairing.proxyUrl).port,"0");
        assert.equal((await fetch(pairing.proxyUrl,{headers:{origin,[PROXY_TOKEN_HEADER]:pairing.token}})).status,200);
        child.kill("SIGTERM");await once(child,"exit");await assert.rejects(readFile(file),{code:"ENOENT"});
    }finally{if(child.exitCode===null)child.kill("SIGKILL");await rm(directory,{recursive:true,force:true});}
});
