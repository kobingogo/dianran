import test from "node:test";
import { EventEmitter } from "node:events";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { startHttpServer } from "./http.js";

test("隔离完整 HTTP 不保存用户配置，要求令牌并返回交互列表与废弃任意路径读取",async(t)=>{
    const directory=await fs.mkdtemp(path.join(os.tmpdir(),"dianran-http-ag-"));t.after(()=>fs.rm(directory,{recursive:true,force:true}));
    const service=startHttpServer({config:{url:"http://127.0.0.1:17371",token:"isolated-test-token",workspace:{workspacePath:directory}},persist:false,port:0,quiet:true});
    await new Promise<void>(resolve=>service.server.once("listening",resolve));t.after(()=>new Promise<void>(resolve=>service.server.close(()=>resolve())));const endpoint=service.config.url;const authenticated=(route:string)=>`${endpoint}${route}${route.includes("?")?"&":"?"}token=isolated-test-token`;
    assert.equal((await fetch(`${endpoint}/agent/codex/interactions`)).status,401);
    assert.deepEqual(await(await fetch(authenticated("/agent/codex/interactions"))).json(),{ok:true,data:[]});
    assert.equal((await fetch(authenticated("/agent/local-image"),{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({path:"/tmp/arbitrary.png"})})).status,410);
    assert.equal((await fetch(authenticated("/agent/codex/interaction"),{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({requestId:"missing",threadId:"thread",turnId:"turn",response:{action:"cancel"}})})).status,409);
    assert.equal((await fetch(authenticated("/agent/codex/approval"),{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({requestId:"missing",threadId:"thread",turnId:"turn",decision:"accept"})})).status,409);
    assert.equal((await fetch(authenticated("/agent/media/tasks?projectId=isolated"))).status,200);
    const browser=new EventEmitter() as any;const output:string[]=[];browser.writeHead=()=>{};browser.write=(value:string)=>{output.push(value);};service.session.openEvents(new URL("http://127.0.0.1/events?clientId=client"),browser,"");t.after(()=>browser.emit("close"));
    const target={clientId:"client",projectId:"project",revision:"revision"};service.session.updateState({projectId:"project",revision:"revision",nodes:[],connections:[]},"client");
    const operation=(service.session as any).requestCanvasTool("canvas_apply_ops",{ops:[]},"client",target);
    const chunk=output.find(value=>value.startsWith("event: tool_call"))!;const requestId=JSON.parse(chunk.split("data: ")[1]).requestId;
    const post=(route:string,body:unknown)=>fetch(authenticated(route+"?clientId=client"),{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)});
    assert.equal((await post("/canvas/result",{requestId,result:{ok:true}})).status,409);
    assert.equal((await (await post("/canvas/request/claim",{requestId})).json()).status,"claimed");
    assert.equal((await (await post("/canvas/request/validate",{requestId})).json()).status,"executing");
    assert.equal((await post("/canvas/result",{requestId,result:{ok:true}})).status,200);assert.deepEqual(await operation,{ok:true});
    const receipt=await(await fetch(authenticated(`/canvas/request/status?clientId=client&requestId=${requestId}`))).json();assert.equal(receipt.status,"succeeded");
    const production=path.join(directory,"production");await fs.mkdir(production);const filePath=path.join(production,"external.png");const png=Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=","base64");await fs.writeFile(filePath,png);
    const external={target,requestId:"external-intent",threadId:"external-thread",turnId:"external-turn",itemId:"external-item",productionDirectory:production,filePath};
    const externalCall=service.session.callTool("media_register_artifact",external);await Promise.resolve();
    const toolChunk=output.filter(value=>value.startsWith("event: tool_call")).at(-1)!;const toolRequestId=JSON.parse(toolChunk.split("data: ")[1]).requestId;
    const register=()=>post("/agent/media/register-external",{clientId:"client",toolRequestId,input:external});
    assert.equal((await register()).status,409);await post("/canvas/request/claim",{requestId:toolRequestId});await post("/canvas/request/validate",{requestId:toolRequestId});
    const first=await(await register()).json();assert.equal(first.data.artifacts.length,1);const repeated=await(await register()).json();assert.equal(repeated.data.id,first.data.id);assert.equal(repeated.data.status,"completed");assert.equal(repeated.data.artifacts.length,1);
    assert.equal((await post("/agent/media/register-external",{clientId:"client",toolRequestId,input:{...external,filePath:path.join(directory,"private.png")}})).status,409);
    await post("/canvas/result",{requestId:toolRequestId,result:{taskId:first.data.id}});await externalCall;
    const outside=path.join(directory,"private.png");await fs.writeFile(outside,png);const escaped={...external,requestId:"escape-intent",filePath:outside};const escapedCall=service.session.callTool("media_register_artifact",escaped).catch(()=>{});await Promise.resolve();const escapeChunk=output.filter(value=>value.startsWith("event: tool_call")).at(-1)!;const escapeRequestId=JSON.parse(escapeChunk.split("data: ")[1]).requestId;await post("/canvas/request/claim",{requestId:escapeRequestId});await post("/canvas/request/validate",{requestId:escapeRequestId});assert.equal((await post("/agent/media/register-external",{clientId:"client",toolRequestId:escapeRequestId,input:escaped})).status,500);await post("/canvas/result",{requestId:escapeRequestId,error:"目录越界"});await escapedCall;

});

test("Skill 安装与资源接口需要令牌，资源变更广播且修订冲突不覆盖", async t => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "dianran-http-skills-"));
    t.after(() => fs.rm(directory, { recursive: true, force: true }));
    const service = startHttpServer({ config: { url: "http://127.0.0.1:17371", token: "test-skill-token", workspace: { workspacePath: directory } }, persist: false, port: 0, quiet: true });
    await new Promise<void>(resolve => service.server.once("listening", resolve));
    t.after(() => new Promise<void>(resolve => service.server.close(() => resolve())));
    const post = (route: string, body: unknown, authenticated = true) => fetch(`${service.config.url}${route}${authenticated ? "?token=test-skill-token" : ""}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    assert.equal((await post("/agent/codex/skills/packages/review", { url: "https://github.com/author/repo" }, false)).status, 401);
    assert.equal((await post("/agent/codex/skills/packages/install", { id: "missing", digest: "invalid" })).status, 409);
    const created = await (await post("/agent/codex/skills", { name: "http-skill", description: "A local test skill", instructions: "Use this skill." })).json();
    assert.equal(created.ok, true);
    const resource = await (await post("/agent/codex/skills/http-skill/resource", { path: "references/guide.md", text: "original", create: true, expectedRevision: created.data.revision })).json();
    assert.equal(resource.data.resources.files.some((file: any) => file.path === "references/guide.md"), true);
    assert.equal((await post("/agent/codex/skills/http-skill/resource", { path: "references/guide.md", text: "stale", expectedRevision: created.data.revision })).status, 409);
    assert.equal(await fs.readFile(path.join(directory, ".agents/skills/http-skill/references/guide.md"), "utf8"), "original");
    const external = await post("/agent/codex/skills/http-skill/resource", { path: "../../outside", text: "bad", expectedRevision: resource.data.revision });
    assert.equal(external.status, 400);
    assert.equal((await post("/agent/codex/skills/packages/cancel", { id: "none" })).status, 200);
});


test("会话结果目标无效或与当前画布冲突时拒绝提交，不启动 Codex", async t => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "dianran-turn-target-"));
    t.after(() => fs.rm(directory, { recursive: true, force: true }));
    const service = startHttpServer({ config: { url: "http://127.0.0.1:17371", token: "target-test-token", workspace: { workspacePath: directory, activeThreadId: "test-thread" } }, persist: false, port: 0, quiet: true });
    await new Promise<void>(resolve => service.server.once("listening", resolve));
    t.after(() => new Promise<void>(resolve => service.server.close(() => resolve())));
    const browser = new EventEmitter() as any;
    browser.writeHead = () => {}; browser.write = () => {};
    service.session.openEvents(new URL("http://127.0.0.1/events?clientId=target-client"), browser, "");
    t.after(() => browser.emit("close"));
    service.session.beginConversation({ threadId: "test-thread", conversationId: "test-thread" });
    service.session.completeConversationMcpInventory([{ name: "dianran", authStatus: "unsupported" }]);
    const conversation = service.session.completeConversationPreparation("test-thread");
    assert.equal(conversation.status, "ready");
    const post = (mediaTarget: unknown) => fetch(`${service.config.url}/agent/codex/turn?token=target-test-token`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ clientId: "target-client", threadId: "test-thread", conversationId: conversation.conversationId, expectedRevision: conversation.revision, prompt: "test-only", mediaTarget }) });
    assert.equal((await post({ projectId: "" })).status, 400);
    service.session.updateState({ projectId: "canvas", revision: "revision", nodes: [], connections: [], selectedNodeIds: [] }, "target-client");
    assert.equal((await post({ projectId: "another-canvas", revision: "revision" })).status, 409);
    assert.equal(service.session.conversationStateSnapshot.status, "ready");
});
