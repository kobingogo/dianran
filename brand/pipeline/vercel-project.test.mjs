import assert from "node:assert/strict";
import { test } from "node:test";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, cpSync, chmodSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";

const pipeline = resolve(import.meta.dirname);
const fixture = () => {
    const root = mkdtempSync(join(tmpdir(), "dianran-vercel-"));
    const preload = join(root, "fetch.mjs");
    writeFileSync(preload, `
import assert from 'node:assert/strict';
globalThis.fetch = async (url, options) => {
    assert.equal(String(url), 'https://api.vercel.com/v9/projects/dianran-prompts?slug=kobingogos-projects');
    assert.equal(options.headers.Authorization, 'Bearer fixture-private-token');
    if (process.env.FIXTURE_RESPONSE === 'network') throw new TypeError('network');
    return new Response(process.env.FIXTURE_RESPONSE || JSON.stringify({name:'dianran-prompts',id:'prj_fixture',accountId:'team_fixture'}), {status:Number(process.env.FIXTURE_HTTP || 200)});
};
`);
    const env = { ...process.env, VERCEL_TOKEN: "fixture-private-token", VERCEL_SCOPE: "kobingogos-projects", NODE_OPTIONS: `--import=${preload}` };
    return { root, env };
};

test("project token resolves only its project; access failures never create a binding or expose credentials", () => {
    const { root, env } = fixture();
    try {
        const binding = join(root, ".vercel/project.json");
        const run = overrides => spawnSync(process.execPath, [join(pipeline, "vercel-project.mjs"), binding], { env: { ...env, ...overrides }, encoding: "utf8" });
        const ok = run({});
        assert.equal(ok.status, 0, ok.stderr);
        assert.deepEqual(JSON.parse(readFileSync(binding)), {projectId:"prj_fixture",orgId:"team_fixture",projectName:"dianran-prompts"});
        rmSync(join(root, ".vercel"), {recursive:true});
        for (const overrides of [
            {FIXTURE_HTTP:"403"},
            {FIXTURE_RESPONSE:JSON.stringify({name:"other-project",id:"prj_other",accountId:"team_fixture"})},
            {FIXTURE_RESPONSE:JSON.stringify({name:"dianran-prompts",id:"prj_fixture"})},
            {FIXTURE_RESPONSE:"network"},
            {VERCEL_TOKEN:""},
        ]) {
            const result = run(overrides);
            assert.equal(result.status, 1);
            assert.doesNotMatch(result.stdout + result.stderr, /fixture-private-token/);
            assert.throws(() => readFileSync(binding), {code:"ENOENT"});
        }
    } finally { rmSync(root, {recursive:true,force:true}); }
});

test("snapshot deployment binds the project token without link/scope and verifies the live snapshot and cover", () => {
    const { root, env } = fixture();
    const resources = join(root, "resources");
    const code = join(root, "code");
    const bins = join(root, "bin");
    const git = (...args) => execFileSync("git", args, {cwd:resources,stdio:"pipe"});
    try {
        mkdirSync(join(resources, "prompt-sources/covers"), {recursive:true});
        writeFileSync(join(resources, "prompt-sources/manifest.json"), '{"generatedAt":"fixture-version"}');
        writeFileSync(join(resources, "prompt-sources/library.json"), '[{"coverUrl":"/prompt-sources/covers/a.webp"}]');
        writeFileSync(join(resources, "prompt-sources/covers/a.webp"), "fixture-image");
        git("init", "-qb", "main"); git("config", "user.name", "Fixture"); git("config", "user.email", "fixture@example.invalid");
        git("add", "."); git("commit", "-qm", "fixture");
        execFileSync("git", ["init", "--bare", "-q", join(root, "remote.git")]);
        git("remote", "add", "origin", join(root, "remote.git")); git("push", "-qu", "origin", "main");
        mkdirSync(join(code, "brand/pipeline/prompt-host"), {recursive:true});
        for (const file of ["deploy.sh", "environment.sh", "vercel-project.mjs", "prompt-host/vercel.json"]) cpSync(join(pipeline, file), join(code, "brand/pipeline", file));
        mkdirSync(bins);
        const cli = (name, text) => { const file=join(bins,name); writeFileSync(file,text); chmodSync(file,0o755); };
        cli("vercel", `#!${process.execPath}
const assert=require('node:assert/strict'),fs=require('node:fs');
assert.deepEqual(process.argv.slice(2),['--token','fixture-private-token','deploy','--prod','--yes']);
assert.deepEqual(JSON.parse(fs.readFileSync('.vercel/project.json')),{projectId:'prj_fixture',orgId:'team_fixture',projectName:'dianran-prompts'});
assert.equal(process.env.VERCEL_ORG_ID,'team_fixture');assert.equal(process.env.VERCEL_PROJECT_ID,'prj_fixture');
console.log('https://fixture.vercel.app');
`);
        cli("curl", '#!/bin/bash\ncase "$*" in *covers*) echo "200 image/webp";; *) echo \'{"generatedAt":"fixture-version"}\';; esac\n');
        const result=spawnSync("bash",[join(code,"brand/pipeline/deploy.sh"),"prompts","HEAD"],{env:{...env,PATH:`${bins}:${process.env.PATH}`,PIPELINE_ENV:join(root,"absent.env"),DIANRAN_PROMPT_PIPELINE_ROOT:resources,VERCEL_ORG_ID:"team_wrong",VERCEL_PROJECT_ID:"prj_wrong"},encoding:"utf8"});
        assert.equal(result.status,0,result.stdout+result.stderr);
        assert.match(result.stdout,/live manifest fixture-version and cover .* ok/);
        assert.doesNotMatch(result.stdout+result.stderr,/fixture-private-token/);
    } finally { rmSync(root,{recursive:true,force:true}); }
});
