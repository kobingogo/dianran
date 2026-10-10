import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),ts=require('typescript');
function fixture(){
 const files=new Map(), reads=[];
 const source=ts.transpileModule(readFileSync(new URL('../src/lib/canvas/agent-media-validation.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const get=async key=>{reads.push(key);return files.get(key)||null};
 const mocks={'@/services/image-storage':{getImageBlob:get,resolveImageUrl:async key=>`blob:${key}`},'@/services/file-storage':{getMediaBlob:get,resolveMediaUrl:async key=>`blob:${key}`}};
 const module={exports:{}};new Function('require','module','exports',source)(id=>{assert.ok(id in mocks);return mocks[id]},module,module.exports);
 return {files,reads,validate:module.exports.validateAgentMediaWrites};
}
const snapshot=nodes=>({projectId:'project',revision:'r1',title:'project',nodes,connections:[],selectedNodeIds:[],viewport:{x:0,y:0,k:1}});
const node=(id,type,metadata={})=>({id,type,title:id,position:{x:0,y:0},width:100,height:100,metadata});

test('generic images reject temporary or remote addresses without a persisted original',async()=>{
 for(const content of ['blob:unowned','data:image/png;base64,impossible','https://remote.example/image']){
  const f=fixture();await assert.rejects(f.validate(snapshot([]),snapshot([node('new','image',{content})]),[{type:'add_node',nodeType:'image'}]),/尚未保存原文件/);
 }
});

test('forged storage identities and mismatched media addresses cannot be reported saved',async()=>{
 const f=fixture();
 await assert.rejects(f.validate(snapshot([]),snapshot([node('new','image',{storageKey:'image:missing',content:'blob:image:missing'})]),[{type:'add_node',id:'new'}]),/原文件缺失/);
 f.files.set('image:saved',new Blob(['saved-image'],{type:'image/png'}));
 await assert.rejects(f.validate(snapshot([]),snapshot([node('new','image',{storageKey:'image:saved',content:'https://unrelated.example/image'})]),[{type:'add_node',id:'new'}]),/不属于指定原文件/);
});

test('uploaded attachments and copied persisted original images remain accepted',async()=>{
 const f=fixture();f.files.set('image:saved',new Blob(['saved-image'],{type:'image/png'}));
 const result=snapshot([node('attachment','image',{storageKey:'image:saved',content:'blob:image:saved'})]);
 await f.validate(snapshot([]),result,[{type:'add_node',id:'attachment'}]);
 assert.deepEqual(f.reads,['image:saved']);
});

test('existing missing references do not block unrelated title or position edits, changed references are checked',async()=>{
 const f=fixture(), original=node('existing','image',{content:'https://legacy.example/image'});
 const before=snapshot([original]), after=snapshot([{...original,title:'新标题'}]);
 await f.validate(before,after,[{type:'update_node',id:'existing',patch:{title:'新标题'}}]);assert.equal(f.reads.length,0);
 await assert.rejects(f.validate(before,snapshot([{...original,metadata:{content:'blob:new'}}]),[{type:'update_node',id:'existing',metadata:{content:'blob:new'}}]),/尚未保存原文件/);
});

test('all batch slots need recoverable originals and text content is not treated as media',async()=>{
 const f=fixture();f.files.set('image:saved',new Blob(['saved'],{type:'image/png'}));
 const before=snapshot([]),next=snapshot([node('batch','image',{images:[{id:'a',storageKey:'image:saved',content:'blob:image:saved'},{id:'b',storageKey:'image:missing',content:'blob:image:missing'}]})]);
 const original=JSON.stringify(next);
 await assert.rejects(f.validate(before,next,[{type:'add_node',id:'batch'}]),/原文件缺失/);assert.equal(JSON.stringify(next),original);
 await f.validate(before,snapshot([node('text','text',{content:'blob:literal-text'})]),[{type:'add_node',id:'text'}]);
});

test('video and audio accept empty placeholders or correct real media originals',async()=>{
 const f=fixture();
 await f.validate(snapshot([]),snapshot([node('placeholder','video')]),[{type:'add_node',id:'placeholder'}]);
 for(const type of ['video','audio']){
  f.files.set(`${type}:saved`,new Blob(['saved'],{type:`${type}/mp4`}));
  await f.validate(snapshot([]),snapshot([node(type,type,{storageKey:`${type}:saved`,content:`blob:${type}:saved`})]),[{type:'add_node',id:type}]);
 }
 f.files.set('file:wrong',new Blob(['saved'],{type:'audio/mp4'}));
 await assert.rejects(f.validate(snapshot([]),snapshot([node('video','video',{storageKey:'file:wrong',content:'blob:file:wrong'})]),[{type:'add_node',id:'video'}]),/类型.*不一致/);
});
