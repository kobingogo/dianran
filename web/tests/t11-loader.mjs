import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {webcrypto} from 'node:crypto';
const require=createRequire(import.meta.url),ts=require('typescript'),fflate=require('fflate');
const sourceRoot=fileURLToPath(new URL('../src/',import.meta.url));
export function fixture(){
 const disk=new Map(),images=new Map(),media=new Map(),downloads=[],cache=new Map();let writer=true;
 if(!globalThis.crypto)globalThis.crypto=webcrypto;
 const tiny=new Map();Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:key=>tiny.get(key)||null,setItem:(key,value)=>tiny.set(key,value),removeItem:key=>tiny.delete(key)}});
 const owned=fn=>async(...args)=>{if(!writer)throw Error('readonly');return fn(...args)};
 const storage={getItem:async key=>disk.get(key)||null,setItem:async(key,value)=>{if(!writer)throw Error('readonly');disk.set(key,structuredClone(value));return value}};
 const mocks={
  '@/i18n':{t:(key,opts)=>opts?.defaultValue||key},
  '@/services/api/proxy-transport':{authorizedProxyPairing:()=>null},
  '@/lib/write-ownership':{businessOperation:owned,assertBusinessWriter:()=>{if(!writer)throw Error('readonly')}},
  '@/lib/localforage-storage':{canvasIndexedStorage:storage},
  '@/services/image-storage':{ensureImagePreview:async()=>{},resolveImageUrl:async key=>images.has(key)?`blob:${key}`:'',getImageBlob:async key=>images.get(key)||null,setImageBlob:async(key,blob)=>{images.set(key,blob);return `blob:${key}`},deleteStoredImages:async keys=>keys.forEach(key=>images.delete(key)),imageToDataUrl:async()=> 'data:image/png;base64,a',uploadImage:async()=>{throw Error('unexpected image download')}},
  '@/services/file-storage':{resolveMediaUrl:async key=>media.has(key)?`blob:${key}`:'',getMediaBlob:async key=>media.get(key)||null,setMediaBlob:async(key,blob)=>{media.set(key,blob);return `blob:${key}`},deleteStoredMedia:async keys=>keys.forEach(key=>media.delete(key))},
  '@/lib/zip':{createZip:async files=>{const entries={};for(const f of files)entries[f.name]=new Uint8Array(await new Blob([f.data]).arrayBuffer());return new Blob([fflate.zipSync(entries,{level:0})])},readZip:async blob=>new Map(Object.entries(fflate.unzipSync(new Uint8Array(await blob.arrayBuffer()))).map(([key,bytes])=>[key,new Blob([bytes])]))},
  'file-saver':{saveAs:(blob,name)=>downloads.push({blob,name})},
 };
 function load(file){
  if(file.startsWith('@/'))file=path.join(sourceRoot,file.slice(2));
  if(!path.extname(file))file+=existsSync(file+'.ts')?'.ts':'.tsx';
  if(cache.has(file))return cache.get(file).exports;
  const module={exports:{}};cache.set(file,module);
  const code=ts.transpileModule(readFileSync(file,'utf8').replaceAll('import.meta.env','({})'),{fileName:file,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true,jsx:ts.JsxEmit.ReactJSX}}).outputText;
  new Function('require','module','exports',code)(id=>{
   if(id in mocks)return mocks[id];
   if(id.startsWith('@/'))return load(id);
   if(id.startsWith('.'))return load(path.resolve(path.dirname(file),id));
   return require(id);
  },module,module.exports);
  return module.exports;
 }
 return {load,disk,images,media,downloads,storage,mocks,setWriter:value=>writer=value,fflate};
}
