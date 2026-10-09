import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { promisify } from "node:util";
import type { Express, Request, Response, RequestHandler } from "express";
import { z } from "zod";
import { CONFIG_DIR, ensureSiteWorkspace, type CanvasAgentConfig } from "../config.js";
import type { CanvasSession } from "../canvas/session.js";
import { listCodexModels, runCodexTurn, startCodexThread } from "../agent/codex.js";
import { createCodexMediaRuntime } from "../agent/media-runtime.js";
import { MEDIA_PROTOCOL_VERSION } from "../agent/media-types.js";
import type { AgentEmit } from "../agent/types.js";

const requestSchema = z.object({ requestId:z.string().min(1),projectId:z.string().min(1),revision:z.string().min(1),agentId:z.literal("codex"),capability:z.enum(["text-to-image","image-edit","text-to-video","image-to-video"]),prompt:z.string().trim().min(1),codexModel:z.string().min(1).optional(),references:z.array(z.object({id:z.string().min(1),name:z.string().min(1),dataUrl:z.string().regex(/^data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=]+$/)})).optional(),parameters:z.record(z.unknown()).optional(),allowUnverified:z.boolean().optional() });
type Context = { config: CanvasAgentConfig; session: CanvasSession; emit: AgentEmit; codexMutation: (handler:(req:Request,res:Response)=>Promise<unknown>)=>RequestHandler; models?: ()=>Promise<unknown>; recordsDirectory?: string; runtime?: ReturnType<typeof createCodexMediaRuntime> };
/** Uses pinned CLI login status only; emits no credentials, account names or raw CLI output. */
export async function readCodexMediaEvidence() {
    try { const require=createRequire(import.meta.url);const bin=path.join(path.dirname(require.resolve("@openai/codex/package.json")),"bin","codex.js");await promisify(execFile)(process.execPath,[bin,"login","status"]);return {authenticated:true,imageTool:"unverified" as const,reason:"Codex 已登录，锁定协议支持图片产物事件；当前账户生图工具仍需明确任务验证"}; }
    catch { return {authenticated:false,imageTool:"unavailable" as const,reason:"Codex 登录状态未能确认；请先在本机登录，再读取能力"}; }
}
export function installMediaRoutes(app: Express, context: Context) {
    const {session,emit}=context;const clients=new Map<string,string>();
    const runtime=context.runtime || createCodexMediaRuntime({productionDirectory:path.join(ensureSiteWorkspace(context.config).workspacePath,"media-output"),recordsDirectory:context.recordsDirectory || path.join(CONFIG_DIR,"media-tasks"),evidence:readCodexMediaEvidence,emit,startThread:async(emit,cwd)=>await startCodexThread(emit,cwd,"request"),runTurn:async(prompt,emit,attachments,options)=>{
        session.setCodexState({busy:true,threadId:options.threadId,turnId:""});
        return runCodexTurn(prompt,emit,attachments,{...options,onTurn(turnId){options.onTurn(turnId);session.setCodexState({busy:true,threadId:options.threadId,turnId});}});
    },onStart(task){const clientId=clients.get(task.request.requestId);if(clientId)session.bindClient(clientId);session.setCodexState({busy:true,threadId:"",turnId:""});},onFinish(task){const clientId=clients.get(task.request.requestId);if(clientId)session.releaseClient(clientId);clients.delete(task.request.requestId);session.setCodexState({busy:false});}});
    let recovered: Promise<void> | undefined;
    const ready=()=>recovered ||= runtime.recover();
    const route=(handler:(req:Request,res:Response)=>Promise<unknown>):RequestHandler=>(req,res,next)=>{void handler(req,res).catch(next);};
    app.get("/agent/media/capabilities",route(async(_req,res)=>{await ready();res.json({ok:true,protocolVersion:MEDIA_PROTOCOL_VERSION,data:[await runtime.adapter.capabilities()]});}));
    app.post("/agent/media/tasks",context.codexMutation(async(req,res)=>{
        await ready();const request=requestSchema.parse(req.body);const clientId=String(req.body?.clientId||"");const state=session.canvasStateForClient(clientId);
        if(!session.hasClient(clientId)||!state||state.projectId!==request.projectId||state.revision!==request.revision)return res.status(409).json({ok:false,error:"目标项目或修订已变化，请重新读取并审阅任务"});
        const catalog=await (context.models ? context.models() : listCodexModels(emit));
        const models=catalog && typeof catalog==="object" && Array.isArray((catalog as {data?:unknown}).data) ? (catalog as {data:Array<{model?:string}>}).data : [];
        if(!request.codexModel || !models.some((model)=>model.model===request.codexModel))return res.status(409).json({ok:false,error:"请选择当前 Codex 账户返回的可用模型；不会自动切换模型或使用 API"});
        clients.set(request.requestId,clientId);
        try {res.status(202).json({ok:true,data:await runtime.adapter.submit(request)});}catch(error){clients.delete(request.requestId);throw error;}
    }));
    app.post("/agent/media/register-external",route(async(req,res)=>{
        await ready();const clientId=String(req.body?.clientId||"");const toolRequestId=String(req.body?.toolRequestId||"");const input=req.body?.input;
        let grant;try{grant=session.assertExecutingRequest(clientId,toolRequestId,"media_register_artifact",input);}catch{return res.status(409).json({ok:false,error:"文件授权尚未批准、已失效或输入变化，请重新审阅"});}
        if(!path.isAbsolute(input.productionDirectory)||!path.isAbsolute(input.filePath))throw new Error("授权目录与原文件必须为绝对路径");
        const task=await runtime.registry.create({requestId:input.requestId,projectId:grant.target.projectId,revision:grant.target.revision,agentId:"codex",capability:"text-to-image",prompt:"外部 Codex 原生图片产物（用户授权导入）"},input.productionDirectory);
        try {await runtime.registry.bind(task.id,{threadId:input.threadId,turnId:input.turnId});await runtime.registry.registerArtifact(task.id,{threadId:input.threadId,turnId:input.turnId,itemId:input.itemId,path:input.filePath,kind:"image"});const data=await runtime.registry.get(task.id,grant.target.projectId);res.json({ok:true,data});}
        catch(error){if(!task.artifacts.length)await runtime.registry.mark(task.id,"unknown","外部原产物登记失败，请保留原任务，不要重新生成");throw error;}
    }));
    app.get("/agent/media/tasks",route(async(req,res)=>{await ready();res.json({ok:true,data:await runtime.registry.list(String(req.query.projectId||""))});}));
    app.get("/agent/media/tasks/:taskId",route(async(req,res)=>{await ready();res.json({ok:true,data:await runtime.registry.get(String(req.params.taskId),String(req.query.projectId||""))});}));
    app.get("/agent/media/tasks/:taskId/artifacts/:artifactId",route(async(req,res)=>{await ready();const result=await runtime.registry.readArtifact(String(req.params.taskId),String(req.params.artifactId),String(req.query.projectId||""));res.setHeader("Cache-Control","no-store");res.type(result.artifact.contentType).send(result.data);}));
    return runtime;
}
