import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, chmodSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import express from "express";
import { installPromptPipelineRoutes } from "./prompt-pipeline-routes.js";

test("cloud dispatch is durable across restart and uncertain submissions; completion uses the saved run receipt", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "dianran-cloud-pipeline-"));
    const jobs = path.join(root, "jobs");
    const cli = path.join(root, "gh");
    const stateFile = path.join(root, "state.json");
    const previous = { PATH: process.env.PATH, repo: process.env.DIANRAN_PROMPT_PIPELINE_GITHUB_REPO };
    writeFileSync(stateFile, JSON.stringify({ dispatches: 0, dispatched: false, completed: false }));
    writeFileSync(cli, `#!/usr/bin/env node
const fs=require('node:fs');const path=require('node:path');const file=${JSON.stringify(stateFile)};const args=process.argv.slice(2);const state=JSON.parse(fs.readFileSync(file));
if(args.includes('POST')){state.dispatches++;state.dispatched=true;fs.writeFileSync(file,JSON.stringify(state));process.exit(1);}
else if(args.includes('--paginate')){if(state.dispatched)console.log('123');}
else if(args[0]==='api')console.log(JSON.stringify({status:state.completed?'completed':'in_progress',conclusion:'success',html_url:'https://github.com/fixture/code/actions/runs/123'}));
else if(args[0]==='run'){const dir=args[args.indexOf('--dir')+1];fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,'result.json'),JSON.stringify({status:'published',snapshot:'verified',added:2,sources:'X 成功',prUrl:'https://github.com/fixture/resources/pull/1'}));}
`);
    chmodSync(cli, 0o755);
    process.env.PATH = `${root}:${process.env.PATH}`;
    process.env.DIANRAN_PROMPT_PIPELINE_GITHUB_REPO = "fixture/code";
    const serve = async () => {
        const app = express(); app.use(express.json()); installPromptPipelineRoutes(app, jobs);
        const server = app.listen(0, "127.0.0.1");
        await new Promise<void>(resolve => server.once("listening", resolve));
        const address = server.address(); assert.ok(address && typeof address !== "string");
        return { server, url: `http://127.0.0.1:${address.port}/agent/prompt-pipeline/jobs` };
    };
    let instance = await serve();
    try {
        const id = randomUUID();
        const post = async () => (await (await fetch(instance.url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ requestId: id }) })).json()).data;
        assert.equal((await post()).status, "unknown");
        await new Promise<void>(resolve => instance.server.close(() => resolve()));
        instance = await serve();
        assert.equal((await post()).status, "running");
        const state = JSON.parse(readFileSync(stateFile, "utf8"));
        assert.equal(state.dispatches, 1);
        state.completed = true; writeFileSync(stateFile, JSON.stringify(state));
        const result = (await (await fetch(`${instance.url}/${id}`)).json()).data;
        assert.equal(result.status, "published"); assert.equal(result.snapshot, "verified");
        assert.match(result.prUrl, /pull\/1$/);
        assert.equal((await post()).status, "published");
        assert.equal(JSON.parse(readFileSync(stateFile, "utf8")).dispatches, 1);
    } finally {
        await new Promise<void>(resolve => instance.server.close(() => resolve()));
        process.env.PATH = previous.PATH;
        if (previous.repo === undefined) delete process.env.DIANRAN_PROMPT_PIPELINE_GITHUB_REPO; else process.env.DIANRAN_PROMPT_PIPELINE_GITHUB_REPO = previous.repo;
        rmSync(root, { recursive: true, force: true });
    }
});
