import { readFile, access, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = fileURLToPath(new URL('../../web/public/', import.meta.url));
const manifest = JSON.parse(await readFile(path.join(root, 'prompt-sources/manifest.json'), 'utf8'));
let count = 0;
const sources = new Map(manifest.sources.map((source) => [source.path, source]));
const files = (await readdir(path.join(root, "prompt-sources"))).filter((file) => file.endsWith(".json") && file !== "manifest.json");
for (const file of files) {
    const source = sources.get(file) || { id: file, path: file };
    const rows = JSON.parse(await readFile(path.join(root, 'prompt-sources', source.path), 'utf8'));
    if (!Array.isArray(rows) || (source.count !== undefined && rows.length !== source.count)) throw new Error(`${source.id}: manifest count mismatch`);
    const ids = new Set();
    for (const row of rows) {
        if (!row.id || ids.has(row.id)) throw new Error(`${source.id}: duplicate/missing id ${row.id}`);
        ids.add(row.id);
        for (const url of [row.coverUrl, ...(row.referenceImageUrls || [])].filter(Boolean)) {
            if (!url.startsWith('/') && !url.startsWith('//') && !url.split('/').includes('..')) throw new Error(`${row.id}: non-local image ${url}`);
            await access(path.join(root, url));
        }
    }
    count += rows.length;
}
console.log(`Validated ${files.length} libraries, ${count} unique entries and local image references.`);
