import assert from "node:assert/strict";
import { test } from "node:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, cpSync, chmodSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

test("daily publication continues the remote baseline, skips unchanged runs and publishes additions without a cumulative cap", () => {
    const temp = mkdtempSync(path.join(os.tmpdir(), "dianran-publication-"));
    const root = path.join(temp, "resources");
    const code = path.join(temp, "code");
    const bins = path.join(temp, "bin");
    const live = path.join(temp, "live.json");
    const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
    const put = (file, text) => { mkdirSync(path.dirname(file), { recursive: true }); writeFileSync(file, text); };
    const cli = (name, text) => { const file = path.join(bins, name); put(file, text); chmodSync(file, 0o755); };
    try {
        mkdirSync(root); mkdirSync(path.join(code, "brand/node_modules/sharp"), { recursive: true });
        cpSync("brand/pipeline/config", path.join(code, "brand/pipeline/config"), { recursive: true });
        for (const file of ["environment.sh", "run-twicedaily.sh", "pending-additions.mjs", "prompt-key.test.mjs", "lib/common.mjs"]) cpSync(`brand/pipeline/${file}`, path.join(code, `brand/pipeline/${file}`), { recursive: true });
        put(path.join(root, ".gitignore"), "candidates/\n");
        const ids = ["x-trending", "civitai-trending", ...JSON.parse(readFileSync("brand/pipeline/config/github-sources.json")).sources.map(row => row.id)];
        for (const id of ids) put(path.join(root, `prompt-sources/${id}.json`), "[]");
        put(path.join(root, "prompt-sources/manifest.json"), '{"generatedAt":"v0"}');
        put(live, '{"generatedAt":"v0"}');
        git("init", "-q", "-b", "main"); git("config", "user.name", "Fixture"); git("config", "user.email", "fixture@example.invalid"); git("add", "."); git("commit", "-qm", "initial");
        execFileSync("git", ["init", "-q", "--bare", path.join(temp, "remote.git")]);
        git("remote", "add", "origin", path.join(temp, "remote.git")); git("push", "-qu", "origin", "main");
        cli("gh", '#!/bin/bash\nif [ "$1 $2" = "repo view" ]; then echo https://github.com/fixture/resources; elif [ "$1 $2" = "pr view" ]; then exit 1; elif [ "$1 $2" = "pr create" ]; then echo https://github.com/fixture/resources/pull/1; fi\n');
        cli("vercel", "#!/bin/bash\nexit 0\n");
        cli("curl", '#!/bin/bash\ncat "$FIXTURE_LIVE"\n');
        cli("date", '#!/bin/bash\nif [ "$1" = "+%F" ]; then echo "$FIXTURE_DAY"; else exec /bin/date "$@"; fi\n');
        cli("node", `#!/usr/bin/env node
const fs=require('node:fs');const path=require('node:path');const cp=require('node:child_process');const args=process.argv.slice(2);const name=path.basename(args[0]||'');const root=process.env.DIANRAN_PROMPT_PIPELINE_ROOT;
const write=(file,x)=>{const f=path.join(root,file);fs.mkdirSync(path.dirname(f),{recursive:true});fs.writeFileSync(f,JSON.stringify(x));};
if(name==='fetch-x.mjs'){write('candidates/x.json',{stats:{errors:[]},items:[]});process.exit(0);}
if(name.startsWith('fetch-')||name==='picks.mjs'||name==='validate.mjs')process.exit(0);
if(name==='usage-read.mjs'){write('data/usage.json',{status:'unavailable'});process.exit(0);}
if(name==='merge.mjs'){
const file=path.join(root,'prompt-sources/x-trending.json');const items=JSON.parse(fs.readFileSync(file));const id=process.env.FIXTURE_DAY;
if(process.env.FIXTURE_MODE==='add'&&!items.some(x=>x.id===id)){for(let i=0;i<Number(process.env.FIXTURE_ADDITIONS||1);i++)items.push({id:i? id+':'+i:id,prompt:id+':'+i});fs.writeFileSync(file,JSON.stringify(items));}
write('candidates/merge-report.json',{added:process.env.FIXTURE_MODE==='add'?[{id}]:[],perLibrary:{}});process.exit(0);}
if(name==='finalize.mjs'){const changed=process.env.FIXTURE_MODE==='add';if(changed)write('prompt-sources/manifest.json',{generatedAt:process.env.FIXTURE_DAY});const version=JSON.parse(fs.readFileSync(path.join(root,'prompt-sources/manifest.json'))).generatedAt;write('candidates/finalize.json',{changed,version});process.exit(0);}
const result=cp.spawnSync(${JSON.stringify(process.execPath)},args,{stdio:'inherit'});process.exit(result.status??1);
`);
        // Use an absolute Node shebang: this stub must not recursively invoke itself.
        const nodeFile = path.join(bins, "node"); put(nodeFile, readFileSync(nodeFile, "utf8").replace("#!/usr/bin/env node", `#!${process.execPath}`)); chmodSync(nodeFile, 0o755);
        const deploy = path.join(code, "brand/pipeline/deploy.sh");
        put(deploy, '#!/bin/bash\ngit -C "$DIANRAN_PROMPT_PIPELINE_ROOT" show "$2:prompt-sources/manifest.json" > "$FIXTURE_LIVE"\necho deploy >> "$FIXTURE_DEPLOYS"\n'); chmodSync(deploy, 0o755);
        const run = (day, mode, additions = 1) => {
            const receipt = path.join(temp, "result.json");
            try { execFileSync("bash", [path.join(code, "brand/pipeline/run-twicedaily.sh")], { env: { ...process.env, PATH: `${bins}:${process.env.PATH}`, PIPELINE_ENV: path.join(temp, "absent.env"), DIANRAN_PROMPT_PIPELINE_ROOT: root, DIANRAN_PIPELINE_RESULT_FILE: receipt, FIXTURE_LIVE: live, FIXTURE_DEPLOYS: path.join(temp, "deploys"), FIXTURE_DAY: day, FIXTURE_MODE: mode, FIXTURE_ADDITIONS: String(additions) }, stdio: "pipe" }); } catch (error) { throw new Error(`${error.message}\n${error.stdout}\n${error.stderr}`); }
            return JSON.parse(readFileSync(receipt));
        };
        assert.equal(run("2026-01-01", "add").status, "published");
        assert.equal(run("2026-01-02", "add").status, "published");
        assert.equal(JSON.parse(git("show", "origin/codex/prompt-published:prompt-sources/x-trending.json")).length, 2);
        assert.equal(run("2026-01-03", "unchanged").status, "unchanged");
        assert.equal(readFileSync(path.join(temp, "deploys"), "utf8"), "deploy\ndeploy\n");
        assert.equal(run("2026-01-04", "add", 61).status, "published");
        assert.equal(run("2026-01-04", "unchanged").status, "published");
        assert.equal(readFileSync(path.join(temp, "deploys"), "utf8"), "deploy\ndeploy\ndeploy\ndeploy\n");
        assert.equal(git("branch", "--show-current"), "main"); assert.equal(git("status", "--porcelain"), "");
    } finally { rmSync(temp, { recursive: true, force: true }); }
});
