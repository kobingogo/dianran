import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const file = new URL("../src/lib/prepare-storage.ts", import.meta.url);
const source = await readFile(file, "utf8");
function load(localforage) {
    const module = { exports: {} };
    const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText;
    new Function("require", "module", "exports", code)(name => name === "localforage" ? localforage : name === "./atomic-storage" ? { CONFLICT_STORE: "write_conflicts" } : { STORAGE_NS: "fixture" }, module, module.exports);
    return module.exports;
}

test("storage readiness finishes each schema change before starting the next and rejects failures", async () => {
    const calls = []; let active = 0;
    const { prepareStorage } = load({ INDEXEDDB: "indexeddb", createInstance: ({ storeName }) => ({ ready: async () => {
        assert.equal(active++, 0);
        calls.push(storeName);
        await new Promise(resolve => setImmediate(resolve));
        active--;
        if (storeName === "creation_tasks") throw new Error("storage unavailable");
    } }) });
    await assert.rejects(prepareStorage(), /storage unavailable/);
    assert.deepEqual(calls, ["app_state", "creation_tasks"]);
});

test("prepared stores accept concurrent real localforage writes without upgrades and preserve prior data", async () => {
    const child = `
const assert=require('node:assert/strict'),fs=require('node:fs'),{createRequire}=require('node:module');
const req=createRequire(process.argv[1]+'/package.json');
const fake=req('fake-indexeddb');global.indexedDB=fake.indexedDB;global.IDBKeyRange=fake.IDBKeyRange;global.window=global;
const localforage=req('localforage'),ts=req('typescript'),name='prepared-'+crypto.randomUUID();
const moduleValue={exports:{}};
const code=ts.transpileModule(fs.readFileSync(process.argv[2],'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,esModuleInterop:true}}).outputText;
new Function('require','module','exports',code)(id=>id==='localforage'?localforage:id==='./atomic-storage'?{CONFLICT_STORE:'write_conflicts'}:{STORAGE_NS:name},moduleValue,moduleValue.exports);
(async()=>{
 const original=localforage.createInstance({name,storeName:'app_state',driver:localforage.INDEXEDDB});
 try{
  await original.setItem('existing-project',{id:'original',title:'保留作品'});
  await moduleValue.exports.prepareStorage();
  const before=(await indexedDB.databases()).find(db=>db.name===name).version;
  await Promise.all(moduleValue.exports.storageStores.map(async storeName=>{
   const store=localforage.createInstance({name,storeName,driver:localforage.INDEXEDDB});
   await store.setItem('fixture',storeName);assert.equal(await store.getItem('fixture'),storeName);
  }));
  assert.equal((await indexedDB.databases()).find(db=>db.name===name).version,before);
  assert.deepEqual(await original.getItem('existing-project'),{id:'original',title:'保留作品'});
  console.log('concurrent writes completed without schema upgrades; original project retained');
 }finally{await localforage.dropInstance({name});}
})().catch(error=>{console.error(error);process.exitCode=1;});`;
    const result = await promisify(execFile)(process.execPath, ["-e", child, new URL("../", import.meta.url).pathname, file.pathname]);
    assert.match(result.stdout, /original project retained/);
});
