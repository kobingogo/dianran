import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import vm from 'node:vm';

const exec = promisify(execFile);
const script = new URL('./fetch-x.mjs', import.meta.url);
const source = await readFile(script, 'utf8');
const command = vm.runInNewContext(`${source.slice(source.indexOf('function twscrape('), source.indexOf('\nconst MARK'))}; twscrape`, {
    spawn, BIN: process.execPath, replayOnly: false, provider: 'twscrape', setTimeout, clearTimeout,
});

test('X process receipts distinguish signals and deadlines while retaining complete JSONL rows', async () => {
    const killed = await command(['-e', 'console.log(JSON.stringify({id_str:"retained"}));process.kill(process.pid,"SIGTERM")']);
    assert.equal(killed.failed, true);
    assert.equal(killed.status, 'signal SIGTERM');
    assert.equal(killed.rows[0].id_str, 'retained');
    const deadline = await command(['-e', 'process.on("SIGTERM",()=>process.exit(0));console.log(JSON.stringify({id_str:"partial"}));setInterval(()=>{},100)'], 1000);
    assert.equal(deadline.failed, true, 'graceful exit after the deadline is still interrupted');
    assert.match(deadline.status, /^timeout 1000ms/);
    assert.equal(deadline.rows[0].id_str, 'partial');
});

test('X verification retains partial output but reports a nonzero child exit as a failed query', async t => {
    const directory = await mkdtemp(path.join(tmpdir(), 'dianran-x-receipt-'));
    t.after(() => rm(directory, { recursive: true, force: true }));
    await exec('git', ['init', '-q', directory]);
    const binary = path.join(directory, 'partial-x');
    await writeFile(binary, '#!/bin/sh\nprintf \'%s\\n\' \'{"id_str":"fixture-partial"}\'\nexit 7\n', { mode: 0o700 });
    let status;
    try { await exec(process.execPath, [script.pathname, '--verify-search'], { env: { ...process.env, DIANRAN_PROMPT_PIPELINE_ROOT: directory, TWSCRAPE_BIN: binary, X_PROVIDER: 'twscrape' } }); }
    catch (error) { status = error.code; }
    const result = JSON.parse(await readFile(path.join(directory, 'candidates/twscrape-search-verification.json'), 'utf8'));
    assert.equal(status, 1);
    assert.equal(result.stats.raw, 1);
    assert.equal(result.rows[0].id_str, 'fixture-partial');
    assert.match(result.stats.errors[0], /exit 7/);
});

test('normal X collection keeps usable candidates and marks partial query failures for publication', async t => {
    const directory = await mkdtemp(path.join(tmpdir(), 'dianran-x-partial-'));
    t.after(() => rm(directory, { recursive: true, force: true }));
    await exec('git', ['init', '-q', directory]);
    const binary = path.join(directory, 'partial-x');
    const tweet = { id_str: 'fixture-partial', rawContent: 'GPT Image Prompt: A cinematic studio portrait with warm rim lighting, clean white background and detailed natural skin texture.', date: '2026-10-15T00:00:00Z', likeCount: 200, bookmarkedCount: 0, retweetCount: 0, user: { username: 'fixture', id_str: 'fixture-user' }, media: { photos: [{ url: 'https://fixture.invalid/cover.png' }] } };
    await writeFile(binary, `#!/bin/sh\nprintf '%s\\n' '${JSON.stringify(tweet)}'\nexit 7\n`, { mode: 0o700 });
    await exec(process.execPath, [script.pathname], { env: { ...process.env, DIANRAN_PROMPT_PIPELINE_ROOT: directory, TWSCRAPE_BIN: binary, X_PROVIDER: 'twscrape' } });
    const result = JSON.parse(await readFile(path.join(directory, 'candidates/x.json'), 'utf8'));
    assert.ok(result.stats.errors.length > 0);
    assert.equal(result.stats.errors.length, Object.keys(result.stats.queries).length);
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0].id, 'x-trending:fixture-partial');
    assert.match(result.items[0].prompt, /cinematic studio portrait/);
});

test('X library status sink emits fixed labels and never account or response details', async () => {
    const python = `import ast, contextlib, io, sys, types
from pathlib import Path
tree=ast.parse(Path(sys.argv[1]).read_text())
function=next(node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name=='report_status')
scope={'sys':sys,'reported_statuses':set()}
exec(compile(ast.Module(body=[function],type_ignores=[]),sys.argv[1],'exec'),scope)
output=io.StringIO()
with contextlib.redirect_stderr(output):
 for text in ['Rate limited: PRIVATE_ACCOUNT COOKIE_VALUE','Rate limited: repeated PRIVATE_ACCOUNT','No account available for queue "SearchTimeline" SECRET','Session expired or banned: SECRET_TOKEN','network COOKIE_VALUE; cooling account for 60s','unrecognized PRIVATE_ACCOUNT COOKIE_VALUE']:
  scope['report_status'](types.SimpleNamespace(record={'message':text}))
assert output.getvalue()=='twscrape-x status: rate-limited\\ntwscrape-x status: waiting-account\\ntwscrape-x status: authentication-rejected\\ntwscrape-x status: transport-failure\\n', output.getvalue()
print('fixed labels, duplicates suppressed, private details omitted')
`;
    const result = await exec('python3', ['-c', python, new URL('./twscrape-x.py', import.meta.url).pathname]);
    assert.match(result.stdout, /private details omitted/);
});
