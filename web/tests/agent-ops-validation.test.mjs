import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { webcrypto } from 'node:crypto';
const require=createRequire(import.meta.url),ts=require('typescript');
function load(path,mocks={}) {
 const code=ts.transpileModule(readFileSync(new URL(path,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
 const module={exports:{}};new Function('require','module','exports',code)(id=>{assert.ok(id in mocks,`unexpected dependency ${id}`);return mocks[id]},module,module.exports);return module.exports;
}
let generated=0;
const api=load('../src/lib/canvas/canvas-agent-ops.ts',{
 nanoid:{nanoid:()=>`generated-${++generated}`},'@/i18n':{t:label=>label},
 '@/lib/canvas/node-registry':{isRegisteredNodeType:type=>['text','config','image','video','audio','group'].includes(type),getNodeSpec:type=>({title:type,width:340,height:240,metadata:{}})},
 '@/types/canvas':{CanvasNodeType:{Text:'text',Image:'image',Config:'config'}},
});
const revisions=load('../src/lib/canvas/agent-revision.ts');
if(!globalThis.crypto)globalThis.crypto=webcrypto;
const fixture=()=>({projectId:'A',revision:'r1',title:'A',nodes:[{id:'text',type:'text',title:'文本',position:{x:0,y:0},width:340,height:240,metadata:{content:'原始'}},{id:'image',type:'image',title:'图片',position:{x:400,y:0},width:200,height:300,metadata:{naturalWidth:800,naturalHeight:1200}}],connections:[{id:'edge',fromNodeId:'text',toNodeId:'image',kind:'input'}],selectedNodeIds:['text'],viewport:{x:0,y:0,k:1}});
const deepFreeze=value=>{if(value&&typeof value==='object'){Object.freeze(value);Object.values(value).forEach(deepFreeze)}return value};

test('entire batch validated before caller receives any mutation, including later invalid actions',()=>{
 const before=deepFreeze(fixture()), original=JSON.stringify(before);
 for(const bad of [{type:'connect_nodes',fromNodeId:'text',toNodeId:'missing'},{type:'update_node',id:'text',patch:{id:'replacement'}},{type:'update_node',id:'text',patch:{type:'image'}},{type:'update_node',id:'text',metadata:{count:Infinity}},{type:'unknown'}]) {
   assert.throws(()=>api.applyCanvasAgentOps(before,[{type:'update_node',id:'text',metadata:{content:'待修改'}},bad]));
   assert.equal(JSON.stringify(before),original);
 }
 const after=api.applyCanvasAgentOps(before,[{type:'update_node',id:'text',metadata:{content:'合法修改'}}]);
 assert.equal(after.nodes[0].metadata.content,'合法修改');assert.equal(before.nodes[0].metadata.content,'原始');
});

test('duplicate and malformed identities rejected without silently deduplicating delete/select lists',()=>{
 const before=fixture();
 for(const op of [{type:'delete_node',ids:['text','text']},{type:'delete_connections',ids:['edge','edge']},{type:'select_nodes',ids:['text','text']},{type:'add_node',id:'text'},{type:'add_node',id:'edge'},{type:'add_node',id:''},{type:'connect_nodes',id:'text',fromNodeId:'image',toNodeId:'text'},{type:'delete_connections',all:true,ids:['edge']},{type:'delete_node',id:'text',ids:['image']}])assert.throws(()=>api.applyCanvasAgentOps(before,[op]));
 assert.throws(()=>api.applyCanvasAgentOps(before,[{type:'add_node',id:'new'},{type:'add_node',id:'new'}]));
 assert.throws(()=>api.applyCanvasAgentOps(before,[{type:'connect_nodes',id:'e2',fromNodeId:'image',toNodeId:'text'},{type:'connect_nodes',id:'e2',fromNodeId:'text',toNodeId:'image'}]));
});

test('metadata schema refuses unknown objects, invalid field types and forged provenance',()=>{
 for(const metadata of [{count:'2'},{count:1.5},{status:'done'},{generationMode:'arbitrary'},{freeResize:'true'},{prompt:{}},{agentSource:{threadId:'fake',turnId:'fake',itemId:'fake'}},{creation:{}},{references:['image','image']},{images:[{id:'a',content:'image',status:'success',naturalWidth:'100',naturalHeight:100,bytes:1,mimeType:'image/png'}]},JSON.parse('{"__proto__":{}}')])assert.throws(()=>api.applyCanvasAgentOps(fixture(),[{type:'update_node',id:'text',metadata}]));
 const next=api.applyCanvasAgentOps(fixture(),[{type:'add_node',id:'cfg',nodeType:'config',metadata:{generationMode:'image',count:2,size:'1024x1024',quality:'high',prompt:'画海报'}},{type:'connect_nodes',fromNodeId:'text',toNodeId:'cfg'},{type:'run_generation',nodeId:'cfg',mode:'image',prompt:'画海报'}]);
 assert.equal(next.nodes.at(-1).metadata.count,2);assert.equal(next.connections.at(-1).kind,'input');
});

test('image resize keeps original aspect unless explicit freeResize, including one-sided updates',()=>{
 let result=api.applyCanvasAgentOps(fixture(),[{type:'update_node',id:'image',patch:{width:500}}]);
 assert.equal(result.nodes[1].width,500);assert.equal(result.nodes[1].height,750);
 result=api.applyCanvasAgentOps(fixture(),[{type:'update_node',id:'image',patch:{width:400,height:400}}]);
 assert.ok(Math.abs(result.nodes[1].width/result.nodes[1].height-800/1200)<Number.EPSILON);
 result=api.applyCanvasAgentOps(fixture(),[{type:'update_node',id:'image',patch:{height:600}}]);
 assert.equal(result.nodes[1].width,400);assert.equal(result.nodes[1].height,600);
 result=api.applyCanvasAgentOps(fixture(),[{type:'update_node',id:'image',patch:{width:400,height:400},metadata:{freeResize:true}}]);
 assert.equal(result.nodes[1].width,400);assert.equal(result.nodes[1].height,400);
});

test('late operations after A to B to A and remount cannot reuse old revision',()=>{
 const revision=revisions.createAgentRevision(), {revision:ignored,...A}=fixture();
 const first=revision(A), unchanged=revision(A);
 assert.equal(first.revision,unchanged.revision);
 revision({...A,projectId:'B',title:'B'});
 const returned=revision(A);
 assert.notEqual(first.revision,returned.revision);
 assert.throws(()=>api.assertCanvasAgentTarget(returned,{clientId:'client',projectId:'A',revision:first.revision}),/修订/);
 assert.notEqual(revisions.createAgentRevision()(A).revision,first.revision);
 assert.doesNotThrow(()=>api.assertCanvasAgentTarget(returned,{clientId:'client',projectId:'A',revision:returned.revision}));
});

 test('generation references must survive final graph and cannot submit same node twice',()=>{
 const before=fixture();
 assert.throws(()=>api.applyCanvasAgentOps(before,[{type:'run_generation',nodeId:'image'},{type:'delete_node',id:'image'}]));
 assert.throws(()=>api.applyCanvasAgentOps(before,[{type:'run_generation',nodeId:'image'},{type:'run_generation',nodeId:'image'}]));
 assert.equal(before.nodes.length,2);
 });


test('system prompt stays a plain business string without permitting forged workflow snapshots',()=>{
 const next=api.applyCanvasAgentOps(fixture(),[{type:'add_node',id:'text-config',nodeType:'config',metadata:{generationMode:'text',systemPrompt:'只输出正文'}}]);
 assert.equal(next.nodes.at(-1).metadata.systemPrompt,'只输出正文');
 for(const systemPrompt of [{length:1},['正文'],123,null])assert.throws(()=>api.applyCanvasAgentOps(fixture(),[{type:'update_node',id:'text',metadata:{systemPrompt}}]));
 assert.throws(()=>api.applyCanvasAgentOps(fixture(),[{type:'update_node',id:'text',metadata:{workflowStep:{mode:'text',parameters:{apiKey:'secret'}}}}]));
});
