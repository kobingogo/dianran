import assert from "node:assert/strict";
import { test } from "node:test";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import os from "node:os";
import { resolve } from "node:path";

test("merge accepts new and changed prompts without content quarantine", () => {
    const root = mkdtempSync(resolve(os.tmpdir(), "dianran-review-"));
    const json = (file, value) => { mkdirSync(resolve(root, file, ".."), { recursive: true }); writeFileSync(resolve(root, file), JSON.stringify(value)); };
    const read = file => JSON.parse(readFileSync(resolve(root, file), "utf8"));
    try {
        execFileSync("git", ["init", "-q"], { cwd: root });
        const sources = JSON.parse(readFileSync(new URL("./config/github-sources.json", import.meta.url))).sources;
        const ids = ["x-trending", "civitai-trending", ...sources.map(row => row.id)];
        for (const id of ids) json(`prompt-sources/${id}.json`, []);
        json("prompt-sources/manifest.json", { sources: ids.map(id => ({ id })), generatedAt: "fixture" });
        const lib = sources[0].id;
        const current = { id: "existing", prompt: "A city scene in cinematic lighting", title: "城市", coverUrl: "/prompt-sources/covers/fixture.webp" };
        json(`prompt-sources/${lib}.json`, [current]);
        json(`candidates/github/${lib}.json`, { fetchedAt: new Date().toISOString(), items: [
            { ...current, prompt: "nsfw portrait" },
            { id: "blocked", prompt: "nsfw photo", coverUrl: "/prompt-sources/covers/fixture.webp", sourceUrl: "https://example.com/blocked" },
            { id: "qualified", title: "海报", prompt: "A cinematic city poster with beautiful lighting", coverUrl: current.coverUrl },
        ] });
        const run = () => execFileSync(process.execPath, [resolve("brand/pipeline/merge.mjs"), "--additive-only"], { env: { ...process.env, DIANRAN_PROMPT_PIPELINE_ROOT: root }, stdio: "pipe" });
        run();
        const rows = read(`prompt-sources/${lib}.json`);
        assert.equal(rows.find(row => row.id === "existing").prompt, "nsfw portrait");
        assert.ok(rows.some(row => row.id === "qualified"));
        assert.ok(rows.some(row => row.id === "blocked"));
        assert.equal(read("candidates/merge-report.json").coverStats.failed, 0);
        assert.ok(!existsSync(resolve(root, "data/review-queue.json")));
        assert.ok(!existsSync(resolve(root, "reports/review-queue.md")));
    } finally { rmSync(root, { recursive: true, force: true }); }
});
