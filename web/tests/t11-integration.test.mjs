import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fixture} from './t11-loader.mjs';
function setup(){
 const f=fixture(),configAPI=f.load('@/stores/use-config-store'), workflow=f.load('@/lib/canvas/workflow');
 const config={...configAPI.defaultConfig,apiKey:'secret',systemPrompt:'只输出正文',reasoningEffort:'high',audioVoice:'nova',audioSpeed:'1.25',imageModel:'mock::gpt-image-1',videoModel:'mock::video',textModel:'mock::text',audioModel:'mock::audio',channels:[{id:'mock',name:'mock',baseUrl:'https://mock.invalid/v1',apiKey:'secret',apiFormat:'openai',models:[{name:'gpt-image-1',capability:'image'},...['video','text','audio'].map(capability=>({name:capability,capability}))]}]};
 const node=(id,type,metadata)=>({id,type,title:id,metadata,position:{x:0,y:0},width:200,height:200});
 const step=(id,mode,prompt=id)=>node(id,'config',{generationMode:mode,count:1,prompt,composerContent:prompt});
 const link=(fromNodeId,toNodeId)=>({id:`${fromNodeId}:${toNodeId}`,fromNodeId,toNodeId,kind:'input'});
 return {...f,workflow,config,node,step,link};
}

test('four-mode plan preserves text and speech parameters, orders dependencies, and excludes credentials',()=>{
 const f=setup(),nodes=[f.step('story','text'),f.step('image','image'),f.step('speech','audio'),f.step('video','video')];nodes[0].metadata.textCount=3;
 const plan=f.workflow.planWorkflow(nodes,[f.link('story','image'),f.link('story','speech'),f.link('image','video'),f.link('speech','video')],nodes.map(n=>n.id),f.config);
 assert.deepEqual(plan.steps.map(s=>[s.mode,s.calls]),[['text',3],['image',1],['audio',1],['video',1]]);
 assert.deepEqual(plan.steps[0].parameters,{textModel:f.config.textModel,count:'3',systemPrompt:'只输出正文',reasoningEffort:'high'});
 assert.deepEqual(plan.steps[2].actual,{voice:'nova',response_format:'mp3',speed:1.25});
 assert.equal(JSON.stringify(plan).includes('secret'),false);
});

test('mode-specific preflight rejects unsupported media, wrong model, and unsupported audio adapter',()=>{
 const f=setup(),media=[f.node('sound','audio',{content:'https://mock.invalid/audio'}),f.node('image','image',{content:'data:image/png;base64,a'})];
 for(const [mode,id] of [['image','sound'],['text','sound'],['audio','image']])assert.throws(()=>f.workflow.planWorkflow([...media,f.step('run',mode)],[f.link(id,'run')],['run'],f.config),/不支持此输入类型/);
 assert.throws(()=>f.workflow.planWorkflow([f.step('run','audio')],[],['run'],{...f.config,channels:[{...f.config.channels[0],apiFormat:'gemini'}]}),/Gemini/);
 const wrong=f.step('wrong','text');wrong.metadata.model=f.config.imageModel;
 assert.throws(()=>f.workflow.planWorkflow([wrong],[],['wrong'],f.config),/所选模型/);
});

test('all five homepage templates create independent editable graphs and preflight actual inputs without requests',()=>{
 const f=setup(),templates=f.load('@/lib/canvas/canvas-templates');
 const names=JSON.parse(readFileSync(new URL('../public/templates/index.json',import.meta.url),'utf8')).templates;
 assert.equal(names.length,5);
 for(const name of names){
  const source=JSON.parse(readFileSync(new URL(`../public/templates/${name}.json`,import.meta.url),'utf8')),original=JSON.stringify(source);
  const text=source.nodes.find(n=>n.type==='text');text.content='填写的新文案';
  const reference=name==='product-set'?{storageKey:'image:original',url:'blob:original',width:800,height:1200,bytes:10,mimeType:'image/png'}:undefined;
  const a=templates.buildTemplateProject(source,{width:1200,height:900},source.title,reference),b=templates.buildTemplateProject(source,{width:1200,height:900},source.title,reference);
  assert.ok(a.nodes.every(n=>!b.nodes.some(other=>other.id===n.id)));assert.ok(a.connections.every(e=>e.kind==='input'));
  const plan=f.workflow.planWorkflow(a.nodes,a.connections,a.nodes.filter(n=>n.type==='config').map(n=>n.id),f.config);
  assert.ok(plan.steps.length>0);assert.ok(plan.steps.every(s=>s.mode==='image'));assert.ok(plan.resources.some(n=>n.metadata.content==='填写的新文案'));
  assert.notEqual(JSON.stringify(source),original);assert.equal(source.nodes.find(n=>n.key===text.key).content,'填写的新文案');
 }
});

test('presets are mode-scoped, exclude Key, and revalidate against retained model',()=>{
 const f=setup(),prefs=f.load('@/lib/creation-preferences');
 const parameters=prefs.presetParameters({...f.config,count:'3'},'image');assert.equal(JSON.stringify(parameters).includes('secret'),false);assert.equal(parameters.videoSize,undefined);
 const applied=prefs.applyCreationPreset({id:'preset',title:'p',mode:'image',parameters:{...parameters,count:'99'}},f.config,true,10);
 assert.equal(applied.config.imageModel,f.config.imageModel);assert.equal(applied.config.count,'10');assert.equal(applied.config.apiKey,'secret');
});

test('quotes and durations match actual channel, parameters, reference counts and batch size',()=>{
 const f=setup(),estimate=f.load('@/lib/creation-estimates'),condition={mode:'image',model:'gpt-image-1',endpoint:'https://mock.invalid/v1',apiFormat:'openai',actual:{size:'1024x1024'},references:0,videos:0,audios:0,calls:3};
 const quotes=[{id:'q',condition,amount:0.2,currency:'CNY',unit:'output',source:'测试合同',recordedAt:1}],samples=[1000,3000].map((durationMs,index)=>({id:String(index),condition,durationMs,recordedAt:1}));
 const result=estimate.estimateCreation(condition,quotes,samples);assert.ok(Math.abs(result.amount-0.6)<1e-9);assert.equal(result.durationMs,2000);
 assert.equal(estimate.estimateCreation({...condition,calls:1},quotes,samples).durationMs,undefined);
 assert.equal(estimate.estimateCreation({...condition,endpoint:'https://other.invalid'},quotes,samples).amount,undefined);
 assert.equal(estimate.estimateCreation({...condition,references:1},quotes,samples).amount,undefined);
});

test('new presets and estimate mutations retain single writer protection',async()=>{
 const f=setup(),prefs=f.load('@/stores/use-creation-preferences-store').useCreationPreferencesStore,estimate=f.load('@/stores/use-creation-estimates-store').useCreationEstimatesStore;
 f.setWriter(false);await assert.rejects(prefs.getState().save('preset','image',f.config),/readonly/);await assert.rejects(estimate.getState().clearSamples(),/readonly/);assert.equal(f.disk.size,0);
 f.setWriter(true);await prefs.getState().save('preset','image',f.config);assert.equal(prefs.getState().presets.length,1);
});

test('four-mode execution persists each intent before simulated calls and uses frozen upstream results',async()=>{
 const f=setup(),source=[f.step('story','text'),f.step('image','image'),f.step('speech','audio'),f.step('video','video')],links=[f.link('story','image'),f.link('story','speech'),f.link('image','video'),f.link('speech','video')];
 const plan=f.workflow.planWorkflow(source,links,source.map(n=>n.id),f.config),run=f.workflow.createWorkflowRun(plan),events=[];
 let nodes=[],connections=[];
 await f.workflow.executeWorkflow(run,async(step,inputs,state,checkpoint,frozen)=>{
   const graph=f.workflow.prepareWorkflowStep(step,inputs,f.config,nodes,connections,{x:0,y:0},frozen);
   nodes=graph.nodes;connections=graph.connections;state.configId=graph.config.id;
   await checkpoint();events.push(`call:${step.mode}`);
   if(step.mode==='image'||step.mode==='audio')assert.match(graph.input.prompt,/故事正文/);
   if(step.mode==='video'){assert.equal(graph.input.referenceImages.length,1);assert.equal(graph.input.referenceAudios.length,1)}
   const id=`result-${step.id}`,content=step.mode==='text'?'故事正文':`blob:${id}`,metadata={content,status:'success',...(step.mode==='image'?{images:[{id:'image-result',status:'success',content}]}:{}),...(step.mode==='text'?{texts:[{id:'text-result',status:'success',content}]}:{})};
   const result=f.node(id,step.mode,metadata);nodes.push(result);connections.push({id:`generated:${id}`,fromNodeId:state.configId,toNodeId:id,kind:'generation'});
   const identities=f.workflow.workflowResults(step,state,nodes,connections);state.resultNodes=[structuredClone(result)];return identities;
 },async value=>{events.push(`save:${value.steps.find(s=>s.status==='running')?.stepId||'finished'}`)},()=>false);
 assert.deepEqual(run.steps.map(s=>s.status),['succeeded','succeeded','succeeded','succeeded']);
 for(const mode of ['text','image','audio','video'])assert.match(events[events.indexOf(`call:${mode}`)-1],/^save:/);
 const noMoreCalls=events.filter(e=>e.startsWith('call:')).length;
 await f.workflow.executeWorkflow(run,async()=>{throw Error('duplicate call')},async()=>{},()=>false);
 assert.equal(noMoreCalls,4);
});

test('portable template verifies original bytes, assigns new file identities and rejects corruption before writing',async()=>{
 const f=setup(),archive=f.load('@/lib/canvas/workflow-archive'),store=f.load('@/stores/canvas/use-workflow-store').useWorkflowStore;
 const material=f.node('own','image',{content:'blob:image:original',storageKey:'image:original',mimeType:'image/png',bytes:8,naturalWidth:2,naturalHeight:3}),cfg=f.step('run','image');
 const plan=f.workflow.planWorkflow([material,cfg],[f.link('own','run')],['run'],f.config);f.images.set('image:original',new Blob(['original'],{type:'image/png'}));
 await archive.exportWorkflowTemplate({id:'template',title:'模板',plan});
 const {blob}=f.downloads[0],entries=f.fflate.unzipSync(new Uint8Array(await blob.arrayBuffer())),manifest=JSON.parse(new TextDecoder().decode(entries['template.json']));
 assert.equal(manifest.assets[0].bytes,8);assert.match(manifest.assets[0].sha256,/^[a-f0-9]{64}$/);assert.equal(JSON.stringify(manifest).includes('secret'),false);
 await archive.importWorkflowTemplate(blob);
 const restored=store.getState().templates[0].plan.resources[0];assert.notEqual(restored.metadata.storageKey,'image:original');assert.equal(await f.images.get(restored.metadata.storageKey).text(),'original');
 const damaged={...entries,[manifest.assets[0].path]:new TextEncoder().encode('tampered')},beforeCount=f.images.size;
 await assert.rejects(archive.importWorkflowTemplate(new Blob([f.fflate.zipSync(damaged,{level:0})])),/完整性校验失败/);assert.equal(f.images.size,beforeCount);assert.equal(store.getState().templates.length,1);
 f.setWriter(false);await assert.rejects(archive.importWorkflowTemplate(blob),/readonly/);
});

test('template plan rejects cycles, missing relation, bad count and strips injected credentials/scripts',()=>{
 const f=setup(),archive=f.load('@/lib/canvas/workflow-archive'),plan=f.workflow.planWorkflow([f.step('run','image')],[],['run'],f.config);
 const injected=structuredClone(plan);Object.assign(injected.steps[0].parameters,{apiKey:'secret',callScript:'evil'});const clean=archive.archivePlan(injected);assert.equal(JSON.stringify(clean).includes('evil'),false);assert.equal(JSON.stringify(clean).includes('secret'),false);
 const cyclic=structuredClone(plan);cyclic.steps[0].inputs=[{nodeId:'run',stepId:'run'}];assert.throws(()=>archive.archivePlan(cyclic),/循环/);
 const missing=structuredClone(plan);missing.steps[0].inputs=[{nodeId:'gone'}];assert.throws(()=>archive.archivePlan(missing),/缺失/);
 const invalid=structuredClone(plan);invalid.steps[0].parameters.count='NaN';assert.throws(()=>archive.archivePlan(invalid),/数量无效/);
 const a=f.workflow.instantiateWorkflow(clean),b=f.workflow.instantiateWorkflow(clean);assert.ok(a.nodes.every(node=>!b.nodes.some(other=>other.id===node.id)));
});
