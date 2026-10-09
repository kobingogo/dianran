import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {webcrypto} from 'node:crypto';
const require=createRequire(import.meta.url),ts=require('typescript');
if(!globalThis.crypto)globalThis.crypto=webcrypto;
function load(mocks){const code=ts.transpileModule(readFileSync(new URL('../src/lib/agent/import-agent-media.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;const module={exports:{}};new Function('require','module','exports',code)(id=>{assert.ok(id in mocks,`dependency ${id}`);return mocks[id]},module,module.exports);return module.exports;}
async function fixture(){
 const bytes=new Uint8Array([137,80,78,71,13,10,26,10,1,2,3]);const sha=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(v=>v.toString(16).padStart(2,'0')).join('');
 const task={version:1,id:'task',request:{projectId:'A',prompt:'海报'},status:'completed',native:{threadId:'thread',turnId:'turn'},artifacts:[{id:'artifact',itemId:'item',kind:'image',contentType:'image/png',bytes:bytes.length,sha256:sha}]};
 const intents={};
 const projects={A:{nodes:[{id:'original',position:{x:0,y:0},width:200}]},B:{nodes:[]}},agent={canvasContext:null};let imports=0,uploads=0,fail=false,writer=true,reads=0;
 const mocks={
 '@/services/api/local-agent-media':{fetchAgentMediaArtifact:async()=>{reads++;return new Blob([bytes],{type:'image/png'})}},
 '@/services/image-storage':{uploadImage:async()=>{uploads++;return {storageKey:'stored-image',url:'blob:original',width:200,height:300,bytes:bytes.length,mimeType:'image/png'}}},
 '@/lib/canvas/canvas-node-factory':{imageMetadata:image=>({content:image.url,storageKey:image.storageKey,naturalWidth:image.width,naturalHeight:image.height})},
 '@/lib/canvas/canvas-node-size':{fitNodeSize:(width,height)=>({width,height})},
 '@/lib/write-ownership':{assertBusinessWriter:()=>{if(!writer)throw Error('readonly')},businessOperation:fn=>async(...args)=>{if(!writer)throw Error('readonly');return fn(...args)}},
 '@/stores/canvas/use-canvas-store':{useCanvasStore:{getState:()=>({openProject:id=>projects[id],updateProject:(id,patch)=>Object.assign(projects[id],patch)})},flushCanvasSave:async()=>{if(fail)throw Error('save failed')}},
 '@/stores/use-agent-store':{useAgentStore:{getState:()=>agent}},
 '@/stores/use-agent-media-store':{useAgentMediaStore:{getState:()=>({intents})},recordAgentMediaSaveError:async()=>{},recordAgentMediaTask:async()=>{},recordAgentMediaImport:async()=>{imports++}},
 '@/types/canvas':{CanvasNodeType:{Image:'image'}},
 };return {task,projects,agent,intents,mocks,api:load(mocks),stats:()=>({imports,uploads,reads}),setFail:value=>{fail=value},setWriter:value=>{writer=value}};
}
test('imports to original project after switch and preserves later user edits',async()=>{
 const f=await fixture();f.agent.canvasContext={getSnapshot:()=>({projectId:'B',nodes:f.projects.B.nodes}),importMediaNodes:()=>{throw Error('wrong project')}};
 f.mocks['@/services/api/local-agent-media'].fetchAgentMediaArtifact=async()=>{f.projects.A.nodes.push({id:'later-edit',position:{x:500,y:0},width:100});return new Blob([new Uint8Array([137,80,78,71,13,10,26,10,1,2,3])]);};
 await f.api.importAgentMedia(f.task,'local','token');assert.equal(f.projects.B.nodes.length,0);assert.equal(f.projects.A.nodes.length,3);assert.equal(f.projects.A.nodes.at(-1).position.x,640);assert.deepEqual(f.projects.A.nodes.at(-1).metadata.agentSource,{threadId:'thread',turnId:'turn',itemId:'item'});
});
test('save failure keeps original file and retry finishes receipt without duplicate upload or node',async()=>{
 const f=await fixture();f.setFail(true);await assert.rejects(()=>f.api.importAgentMedia(f.task,'local','token'),/save failed/);assert.equal(f.projects.A.nodes.length,2);assert.equal(f.stats().imports,0);assert.equal(f.stats().uploads,1);
 f.setFail(false);await f.api.importAgentMedia(f.task,'local','token');assert.equal(f.projects.A.nodes.length,2);assert.equal(f.stats().uploads,1);assert.equal(f.stats().imports,1);
});
test('active project uses live hook to preserve editing and prevent stale store replacement',async()=>{
 const f=await fixture();const live=[{id:'live',position:{x:10,y:0},width:100}];f.agent.canvasContext={getSnapshot:()=>({projectId:'A',nodes:live}),importMediaNodes:async nodes=>{live.push(...nodes)}};
 await f.api.importAgentMedia(f.task,'local','token');assert.equal(live.length,2);assert.equal(live[1].position.x,150);assert.equal(f.projects.A.nodes.length,1);
});
test('hash mismatch, project removal and readonly prevent receipt or wrong project writes',async()=>{
 const f=await fixture();f.task.artifacts[0].sha256='bad';await assert.rejects(()=>f.api.importAgentMedia(f.task,'local','token'),/完整性/);assert.equal(f.stats().uploads,0);assert.equal(f.stats().imports,0);
 delete f.projects.A;await assert.rejects(()=>f.api.importAgentMedia(f.task,'local','token'),/已删除/);f.setWriter(false);await assert.rejects(()=>f.api.importAgentMedia(f.task,'local','token'),/readonly/);
});
test('concurrent imports share original artifact operation and reject conflicting node provenance',async()=>{
 const f=await fixture();await Promise.all([f.api.importAgentMedia(f.task,'local','token'),f.api.importAgentMedia(f.task,'local','token')]);assert.equal(f.projects.A.nodes.length,2);assert.equal(f.stats().uploads,1);
 f.projects.A.nodes.at(-1).metadata.agentSource.itemId='other';await assert.rejects(()=>f.api.importAgentMedia(f.task,'local','token'),/身份冲突/);assert.equal(f.projects.A.nodes.length,2);
});

test('canvas task fills its original placeholder in place and retry preserves the saved node',async()=>{
 const f=await fixture();f.task.request.requestId='request';f.intents.request={canvasTarget:{projectId:'A',nodeId:'placeholder'}};
 f.projects.A.nodes.push({id:'placeholder',type:'image',position:{x:320,y:180},width:200,height:200,metadata:{agentMediaRequestId:'request',generationTaskId:'agent:request',status:'loading'}});
 await f.api.importAgentMedia(f.task,'local','token');assert.equal(f.projects.A.nodes.length,2);
 const node=f.projects.A.nodes.find(node=>node.id==='placeholder');assert.deepEqual(node.position,{x:320,y:180});assert.equal(node.metadata.storageKey,'stored-image');assert.equal(node.metadata.generationTaskId,'agent:request');
 await f.api.importAgentMedia(f.task,'local','token');assert.equal(f.stats().uploads,1);assert.equal(f.projects.A.nodes.length,2);
});
