import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { installMediaRoutes } from "./media-routes.js";
import { createCodexMediaRuntime } from "../agent/media-runtime.js";

test("媒体 HTTP 能力不虚构视频、提交绑定项目修订、产物只能按登记身份读取",async(t)=>{
    const directory=await fs.mkdtemp(path.join(os.tmpdir(),"dianran-media-http-"));t.after(()=>fs.rm(directory,{recursive:true,force:true}));
    const runtime=createCodexMediaRuntime({productionDirectory:path.join(directory,"outputs"),recordsDirectory:path.join(directory,"records"),evidence:async()=>({authenticated:true,imageTool:"unverified"}),emit:()=>{},startThread:async()=>({id:"thread"}),runTurn:async()=>{}});
    const app=express();app.use(express.json());
    installMediaRoutes(app,{config:{url:"http://127.0.0.1",token:"test"},runtime,models:async()=>({data:[{model:"fixture-model"}]}),emit:()=>{},session:{hasClient:(id:string)=>id==="client",canvasStateForClient:()=>({projectId:"project",revision:"revision"})} as any,codexMutation:(handler)=>(req,res,next)=>{void handler(req,res).catch(next);}});
    app.use((error:Error,_req:any,res:any,_next:any)=>res.status(400).json({ok:false,error:error.message}));
    const server=app.listen(0,"127.0.0.1");await new Promise<void>(resolve=>server.once("listening",resolve));t.after(()=>new Promise<void>(resolve=>server.close(()=>resolve())));const address=server.address() as {port:number};const endpoint=`http://127.0.0.1:${address.port}`;
    const capabilities=await (await fetch(`${endpoint}/agent/media/capabilities`)).json();assert.equal(capabilities.data[0].capabilities["text-to-video"],"unavailable");
    const input={clientId:"client",requestId:"request",projectId:"project",revision:"stale",agentId:"codex",capability:"text-to-image",prompt:"fixture",codexModel:"fixture-model",allowUnverified:true};
    assert.equal((await fetch(`${endpoint}/agent/media/tasks`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(input)})).status,409);
    input.revision="revision";input.codexModel="unsupported";assert.equal((await fetch(`${endpoint}/agent/media/tasks`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(input)})).status,409);input.codexModel="fixture-model";const submitted=await fetch(`${endpoint}/agent/media/tasks`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(input)});assert.equal(submitted.status,202);const task=(await submitted.json()).data;
    const result=await (await fetch(`${endpoint}/agent/media/tasks/${task.id}?projectId=project`)).json();assert.equal(result.data.request.projectId,"project");
    assert.equal((await fetch(`${endpoint}/agent/media/tasks/${task.id}?projectId=other`)).status,400);assert.equal((await fetch(`${endpoint}/agent/media/tasks/${task.id}/artifacts/arbitrary?projectId=project`)).status,400);
});
