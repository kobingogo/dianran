import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url), ts = require('typescript');
function fixture() {
  const updates=[], paths=[], dispatched=[];
  const config={model:'image-model',imageModel:'image-model',videoModel:'video-model',channels:[],quality:'auto',size:'1:1',count:'1'};
  const tasks=[];
  const assets={hydrated:true,assets:[],addAsset:async()=> 'asset-id'};
  const mocks={
    '@/lib/write-ownership':{businessOperation:fn=>fn},
    '@/i18n':{t:key=>key},
    '@/services/api/prompts':{fetchPrompts:async()=>({total:0,categories:[],tags:[],items:[]})},
    '@/services/image-storage':{uploadImage:async()=>({url:'blob:saved',storageKey:'original',width:200,height:300,bytes:10,mimeType:'image/png'})},
    '@/components/image-settings-panel':{imageAspectOptions:[],imageQualityOptions:[],imageScaleOptions:[]},
    '@/components/video-settings-panel':{videoResolutionOptions:[],videoSecondsRange:{min:4,max:30},videoSizeOptions:[]},
    '@/lib/media-size':{clampVideoSeconds:value=>value},
    '@/stores/canvas/use-canvas-store':{useCanvasStore:{getState:()=>({hydrated:true,projects:[]})}},
    '@/stores/use-asset-store':{useAssetStore:{getState:()=>assets}},
    '@/stores/use-config-store':{useConfigStore:{getState:()=>({config,updateConfig:(key,value)=>{updates.push([key,value]);config[key]=value}})},modelOptionLabel:(_,value)=>value,modelOptionName:value=>value,normalizeModelOptionValue:value=>value,resolveVideoSize:()=> '16:9',selectableModelsByCapability:()=>[]},
    '@/stores/use-workbench-agent-store':{useWorkbenchAgentStore:{getState:()=>({tasks,dispatchImage:command=>{dispatched.push(command);return command.run?'image-1':undefined},dispatchVideo:command=>{dispatched.push(command);return command.run?'video-1':undefined}})}},
  };
  const source=ts.transpileModule(readFileSync(new URL('../src/lib/agent/agent-site-tools.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
  const module={exports:{}};
  new Function('require','module','exports',source)(id=>{assert.ok(id in mocks,`unexpected import ${id}`);return mocks[id]},module,module.exports);
  return {api:module.exports,updates,paths,dispatched,tasks,assets,navigate:path=>paths.push(path)};
}

test('workbench dispatch acknowledges queue but never claims saved intent, submission or completion',async()=>{
 for(const kind of ['image','video']) {
   const f=fixture(), result=await f.api.runSiteTool(`workbench_${kind}_generate`,{prompt:'测试',run:true},f.navigate);
   assert.equal(result.taskId,`${kind}-1`);
   assert.deepEqual(result.receipt,{configurationApplied:true,generation:'queued',intentSaved:false,submitted:false,completed:false});
   assert.deepEqual(f.dispatched,[{prompt:'测试',run:true}]);
   assert.deepEqual(f.paths,[`/${kind}`]);
 }
});

test('configuration-only command has no generation task or submitted receipt',async()=>{
 const f=fixture(), result=await f.api.runSiteTool('workbench_image_generate',{prompt:'只填写',run:false,size:'16:9'},f.navigate);
 assert.equal(result.taskId,undefined);assert.equal(result.receipt.generation,'not-requested');assert.equal(result.receipt.submitted,false);
 assert.deepEqual(f.updates,[['size','16:9']]);
});

test('generation query preserves unknown status, missing in-memory record is not proof of non-execution',async()=>{
 const f=fixture();
 f.tasks.push({id:'image-1',kind:'image',status:'unknown',createdAt:'',updatedAt:'',error:'请求响应丢失'});
 const result=await f.api.runSiteTool('generation_get_status',{taskId:'image-1'},f.navigate);
 assert.equal(result.summary.unknown,1);assert.equal(result.summary.failed,0);assert.equal(result.tasks[0].status,'unknown');
 const missing=await f.api.runSiteTool('generation_get_status',{taskId:'not-in-memory'},f.navigate);
 assert.equal(missing.found,false);assert.equal(missing.certainty,'not-observed');assert.match(missing.note,/不能证明.*未执行/);
});

test('asset storage error cannot report saved success, actual persisted receipt only follows await',async()=>{
 const f=fixture();
 f.assets.addAsset=async()=>{throw new Error('本地存储失败')};
 await assert.rejects(f.api.runSiteTool('assets_add',{kind:'text',title:'素材',content:'正文'},f.navigate),/本地存储失败/);
 f.assets.addAsset=async()=> 'confirmed-asset';
 const result=await f.api.runSiteTool('assets_add',{kind:'text',title:'素材',content:'正文'},f.navigate);
 assert.equal(result.id,'confirmed-asset');assert.equal(result.receipt.saved,true);
});
