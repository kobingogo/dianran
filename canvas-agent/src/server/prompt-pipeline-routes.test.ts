import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import express from "express";
import { installPromptPipelineRoutes } from "./prompt-pipeline-routes.js";

test("publication identity is idempotent, held runs are not success, and dirty checkouts stay untouched", async () => {
    const fixture = mkdtempSync(path.join(os.tmpdir(), "dianran-prompt-bridge-"));
    const root = path.join(fixture, "checkout");
    const jobs = path.join(fixture, "jobs");
    mkdirSync(path.join(root, "brand/pipeline"), { recursive: true });
    const previousRoot = process.env.DIANRAN_PROMPT_PIPELINE_ROOT;
    process.env.DIANRAN_PROMPT_PIPELINE_ROOT = root;
    // A fixture writes a receipt only; it never invokes real collection or deployment.
    const script = path.join(root, "brand/pipeline/run-twicedaily.sh");
    const writeRunner = (status: string) => {
        writeFileSync(script, `#!/bin/bash\nset -e\necho run >> "$PWD/runs"\nprintf '%s' '{"status":"${status}","snapshot":"fixture","added":2,"sources":"fixture"}' > "$DIANRAN_PIPELINE_RESULT_FILE"\n`);
        execFileSync("git", ["add", "."], { cwd: root });
        execFileSync("git", ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-qm", status], { cwd: root });
    };
    execFileSync("git", ["init", "-q"], { cwd: root });
    writeFileSync(path.join(root, ".gitignore"), "runs\n");
    writeRunner("published");
    const app = express();
    app.use(express.json());
    installPromptPipelineRoutes(app, jobs);
    const server = app.listen(0, "127.0.0.1");
    await new Promise<void>(resolve => server.once("listening", resolve));
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const url = `http://127.0.0.1:${address.port}/agent/prompt-pipeline/jobs`;
    const start = (id: string) => fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ requestId: id }) });
    const finish = async (id: string) => {
        for (let check = 0; check < 100; check++) {
            const { data } = await (await fetch(`${url}/${id}`)).json();
            if (data.status !== "running") return data;
            await new Promise(resolve => setTimeout(resolve, 10));
        }
        assert.fail("fixture job did not finish");
    };
    try {
        const id = randomUUID();
        assert.equal((await start(id)).status, 202);
        assert.equal((await finish(id)).status, "published");
        assert.equal((await (await start(id)).json()).data.status, "published");
        assert.equal(readFileSync(path.join(root, "runs"), "utf8"), "run\n");
        writeRunner("held");
        const held = randomUUID();
        assert.equal((await start(held)).status, 202);
        assert.equal((await finish(held)).status, "held");
        writeRunner("failed");
        const failed = randomUUID();
        assert.equal((await start(failed)).status, 202);
        assert.equal((await finish(failed)).status, "failed");
        writeFileSync(path.join(root, "user-work.txt"), "do not overwrite");
        assert.equal((await start(randomUUID())).status, 409);
        assert.equal(readFileSync(path.join(root, "user-work.txt"), "utf8"), "do not overwrite");
        assert.equal((await fetch(`${url}/invalid`)).status, 400);
        const recovered = randomUUID();
        writeFileSync(path.join(jobs, `${recovered}.json`), JSON.stringify({ id: recovered, status: "running", phase: "publishing" }));
        installPromptPipelineRoutes(express(), jobs);
        assert.equal(JSON.parse(readFileSync(path.join(jobs, `${recovered}.json`), "utf8")).status, "unknown");
    } finally {
        await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
        if (previousRoot === undefined) delete process.env.DIANRAN_PROMPT_PIPELINE_ROOT;
        else process.env.DIANRAN_PROMPT_PIPELINE_ROOT = previousRoot;
        rmSync(fixture, { recursive: true, force: true });
    }
});
