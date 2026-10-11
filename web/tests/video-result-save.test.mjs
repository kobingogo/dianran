import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url), ts = require('typescript');
function load(upload) {
    const mocks = { '@/lib/generation-outcome': {}, '@/stores/use-capability-evidence-store': {}, '@/services/api/proxy-transport': {}, '@/lib/write-ownership': { businessOperation: (operation) => operation }, axios: {}, nanoid: {}, '@/i18n': { t: (key) => key }, '@/lib/image-utils': {}, '@/lib/model-capabilities': {}, '@/services/file-storage': { uploadMediaFile: upload }, '@/services/image-storage': {}, '@/stores/use-config-store': {}, './model-plugin': {} };
    const module = { exports: {} }, code = ts.transpileModule(readFileSync(new URL('../src/services/api/video.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
    new Function('require', 'module', 'exports', code)((id) => { assert.ok(id in mocks, `dependency ${id}`); return mocks[id]; }, module, module.exports);
    return module.exports;
}
test('failed URL persistence reports failure, never substitutes a remote link for a saved video', async () => {
    let writes = 0;
    const api = load(async () => { writes++; throw Error('disk full'); });
    const result = { url: 'https://provider.example/result.mp4' };
    await assert.rejects(api.storeGeneratedVideo(result), /disk full/);
    assert.equal(result.url, 'https://provider.example/result.mp4');
    assert.equal(writes, 1);
});
test('save retry reuses original output with no generation request', async () => {
    const inputs = [], result = { blob: new Blob(['video'], { type: 'video/mp4' }) };
    const api = load(async (input) => { inputs.push(input); return { url: 'blob:saved', storageKey: 'video:original', bytes: input.size, mimeType: input.type }; });
    const saved = await api.storeGeneratedVideo(result);
    assert.equal(inputs[0], result.blob);
    assert.equal(saved.storageKey, 'video:original');
    assert.equal(inputs.length, 1);
});
