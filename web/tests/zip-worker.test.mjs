import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url),ts=require('typescript'),fflate=require('fflate');
function load(path,mocks,globals={}) {
 const code=ts.transpileModule(readFileSync(new URL(path,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,module={exports:{}};
 new Function('require','module','exports',...Object.keys(globals),code)(id=>{assert.ok(id in mocks);return mocks[id]},module,module.exports,...Object.values(globals));return module.exports;
}
test('worker packs standard archive with original bytes, transfers and terminates',async()=>{
 let terminated=false,transferred=false;
 const scope={postMessage(data,transfer){assert.equal(transfer[0],data.buffer);worker.onmessage({data})}};
 load('../src/lib/zip-worker.ts',{fflate},{globalThis:scope});
 const worker={terminate(){terminated=true},postMessage(entries,transfer){transferred=transfer.every((buffer,index)=>buffer===entries[index][1].buffer);scope.onmessage({data:entries})}};
 const api=load('../src/lib/zip.ts',{fflate,'./zip-worker-client':{createZipWorker:()=>worker}});
 const zip=await api.createZip([{name:'original.txt',data:'作品正文'},{name:'media.bin',data:new Uint8Array([1,2,255])}]);
 const restored=await api.readZip(zip);assert.equal(await restored.get('original.txt').text(),'作品正文');assert.deepEqual(new Uint8Array(await restored.get('media.bin').arrayBuffer()),new Uint8Array([1,2,255]));
 assert.equal(terminated,true);assert.equal(transferred,true);
});
test('worker failures report export failure and terminate instead of producing a partial archive',async()=>{
 let terminated=false;
 const api=load('../src/lib/zip.ts',{fflate,'./zip-worker-client':{createZipWorker:()=>({terminate(){terminated=true},postMessage(){queueMicrotask(()=>this.onerror())}})}});
 await assert.rejects(api.createZip([{name:'original',data:'untouched'}]),/作品仍在本机/);assert.equal(terminated,true);
});
