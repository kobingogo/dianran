import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url), ts = require('typescript');
function load(path, mocks) {
    const source = readFileSync(new URL(path, import.meta.url), 'utf8');
    const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
    const module = { exports: {} };
    new Function('require', 'module', 'exports', code)(id => { assert.ok(id in mocks, `unexpected dependency: ${id}`); return mocks[id]; }, module, module.exports);
    return module.exports;
}
const sizes = load('../src/lib/media-size.ts', {});
const types = { CanvasNodeType: { Text: 'text', Config: 'config', Image: 'image' } };
const templates = load('../src/lib/canvas/canvas-templates.ts', { '@/constant/canvas': { NODE_SPECS: { text: { width:340,height:240,metadata:{} }, config:{ width:340,height:240,metadata:{} } } }, '@/types/canvas': types, '@/lib/media-size': sizes });
const fixture = name => JSON.parse(readFileSync(new URL(`../public/templates/${name}.json`,import.meta.url),'utf8'));

test('poster instances have independent identities, explicit input edges and concrete sizes', () => {
    const template = fixture('poster'), original = JSON.stringify(template);
    const a = templates.buildTemplateProject(template,{width:1200,height:900}), b = templates.buildTemplateProject(template,{width:1200,height:900});
    assert.equal(JSON.stringify(template),original);
    assert.ok(a.nodes.every(node => !b.nodes.some(other => other.id===node.id)));
    assert.ok(a.connections.every(edge => edge.kind==='input'));
    const brief = a.nodes.find(node => node.type==='text');
    assert.ok(a.nodes.filter(node=>node.type==='config').every(node=>node.metadata.composerContent.includes(`@[node:${brief.id}]`)));
    assert.equal(a.nodes.find(node=>node.title.includes('竖版')).metadata.size,'864x1536');
    assert.equal(a.nodes.filter(node=>node.type==='config').reduce((sum,node)=>sum+node.metadata.count,0),4);
});
test('product requires an original reference and gives each intended step its actual input',()=>{
    const template=fixture('product-set');
    assert.throws(()=>templates.buildTemplateProject(template,{width:1200,height:900}),/参考图/);
    const project=templates.buildTemplateProject(template,{width:1200,height:900},template.title,{storageKey:'image:own',url:'blob:own',width:800,height:1200,bytes:1000,mimeType:'image/png'});
    const image=project.nodes.find(node=>node.type==='image');
    assert.equal(image.height/image.width,1.5);
    assert.equal(project.connections.filter(edge=>edge.fromNodeId===image.id&&edge.kind==='input').length,4);
    assert.equal(image.metadata.storageKey,'image:own');
});
test('malformed graph or unknown prompt reference is blocked before creation',()=>{
    const template=fixture('poster');template.connections.push(['missing','portrait']);
    assert.throws(()=>templates.buildTemplateProject(template,{width:1000,height:800}),/关系无效/);
    template.connections.pop();template.nodes[1].prompt='{{missing}}';
    assert.throws(()=>templates.buildTemplateProject(template,{width:1000,height:800}),/不存在/);
});
test('persistence refusal or unsupported storage remains an explicit usable state',async()=>{
    const api=load('../src/services/storage-persistence.ts',{});
    Object.defineProperty(globalThis,'navigator',{configurable:true,value:{storage:{persisted:async()=>false,persist:async()=>false}}});
    assert.equal(await api.readStoragePersistence(),'temporary');assert.equal(await api.requestStoragePersistence(),'temporary');
    globalThis.navigator.storage={};assert.equal(await api.requestStoragePersistence(),'unsupported');
    globalThis.navigator.storage={persisted:async()=>true,persist:async()=>true};assert.equal(await api.requestStoragePersistence(),'persistent');
});
test('local diagnostics require voluntary session, record no content, stop and clear without upload',async()=>{
    const saved=new Map(),state={};let writer=true;
    const api=load('../src/stores/use-local-diagnostics-store.ts',{
        localforage:{createInstance:()=>({setItem:async(key,value)=>{saved.set(key,value)},iterate:async fn=>{for(const value of saved.values())fn(value)},clear:async()=>saved.clear()})},
        zustand:{create:fn=>{Object.assign(state,fn());return {getState:()=>state,setState:patch=>Object.assign(state,patch)}}},
        '@/constant/brand':{STORAGE_NS:'isolated'},'@/lib/write-ownership':{assertBusinessWriter:()=>{if(!writer)throw Error('readonly')},writeOwnership:{canWrite:()=>writer}},
    });
    await api.recordLocalDiagnostic('generation-success');assert.equal(saved.size,0);
    api.startLocalDiagnostics();await api.recordLocalDiagnostic('generation-success',123);
    const event=[...saved.values()][0];assert.deepEqual(Object.keys(event).sort(),['action','at','durationMs','id','session']);
    api.stopLocalDiagnostics();await api.recordLocalDiagnostic('help-needed');assert.equal(saved.size,1);
    writer=false;assert.throws(()=>api.startLocalDiagnostics(),/readonly/);
    const exported=JSON.parse(await(await api.exportLocalDiagnostics()).text());assert.equal(exported.events.length,1);
    writer=true;await api.clearLocalDiagnostics();assert.equal(saved.size,0);
});
