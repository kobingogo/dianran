import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { createProxyServer } from "./index.js";
const folder=mkdtempSync(join(tmpdir(),"dianran-t05-browser-"));
const upstream=createServer(async(req,res)=>{
    let body="";for await(const chunk of req)body+=chunk;
    if(req.url==="/v1/models"){res.writeHead(200,{"content-type":"application/json"});res.end('{"data":[{"id":"test-local-model"}]}');return;}
    if(req.url.includes("redirect")){res.writeHead(307,{location:"http://127.0.0.1:1/forbidden"});res.end();return;}
    if(req.url.includes("stream")){res.writeHead(200,{"content-type":"text/event-stream"});res.write("data: first\n\n");setImmediate(()=>res.end("data: last\n\n"));return;}
    res.writeHead(req.method==="PROPFIND"?207:200,{"content-type":"application/json"});res.end(JSON.stringify({body,method:req.method,authorization:req.headers.authorization||null,pairingLeaked:Boolean(req.headers["x-dianran-proxy-token"])}));
});
upstream.listen(0,"127.0.0.1");await once(upstream,"listening");
const target=`http://127.0.0.1:${upstream.address().port}/v1`,token=randomBytes(32).toString("base64url");
const proxy=createProxyServer({origins:["http://localhost:3001"],targets:[target],token,logger:()=>{}});
proxy.listen(0,"127.0.0.1");await once(proxy,"listening");
const proxyUrl=`http://127.0.0.1:${proxy.address().port}`,file=join(folder,"pairing.json");
writeFileSync(file,JSON.stringify({protocol:2,proxyUrl,token,origins:["http://localhost:3001"],targets:[target]}),{mode:0o600});
console.log(JSON.stringify({proxyUrl,target,pairingFile:file}));
for(const signal of ["SIGINT","SIGTERM"])process.on(signal,()=>{proxy.closeAllConnections();upstream.closeAllConnections();proxy.close();upstream.close();rmSync(folder,{recursive:true,force:true});});
