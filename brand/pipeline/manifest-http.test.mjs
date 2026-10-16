import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { gzipSync, deflateSync, brotliCompressSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);
test('pipeline baseline and deployment checks decode compressed manifest HTTP responses', async (t) => {
    const payload = Buffer.from(JSON.stringify({ generatedAt: 'fixture-snapshot' }));
    let encoding = 'gzip';
    const server = createServer((req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Encoding': encoding });
        res.end(encoding === 'gzip' ? gzipSync(payload) : encoding === 'br' ? brotliCompressSync(payload) : deflateSync(payload));
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const url = `http://127.0.0.1:${server.address().port}/manifest.json`;
    const baseline = readFileSync(new URL('./run-twicedaily.sh', import.meta.url), 'utf8').split('\n').find(line => line.startsWith('LIVE_VERSION='));
    const deploy = readFileSync(new URL('./deploy.sh', import.meta.url), 'utf8').match(/manifest_at\(\) \{[\s\S]*?\n\}/)[0];
    try {
        const { stdout } = await exec('curl', ['--version']);
        const encodings = ['gzip', 'deflate', ...(stdout.includes('brotli') ? ['br'] : [])];
        t.diagnostic(`HTTP response encodings: ${encodings.join(', ')}`);
        for (encoding of encodings) {
            const baselineResult = await exec('bash', ['-c', `${baseline.replace('https://dianran.vercel.app/prompt-sources/manifest.json', url)}\nprintf '%s' "$LIVE_VERSION"`]);
            assert.equal(baselineResult.stdout, 'fixture-snapshot', `baseline ${encoding}`);
            const deploymentResult = await exec('bash', ['-c', `${deploy}\nmanifest_at "$1"`, 'fixture', url]);
            assert.equal(deploymentResult.stdout, 'fixture-snapshot', `deployment ${encoding}`);
        }
    } finally {
        server.closeAllConnections();
        await new Promise(resolve => server.close(resolve));
    }
});
