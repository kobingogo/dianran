import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url), ts = require("typescript");
const code = ts.transpileModule(readFileSync(new URL("../src/lib/friendly-error.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
const module = { exports: {} };
new Function("require", "module", "exports", code)(id => { assert.equal(id, "@/i18n"); return { t: key => key }; }, module, module.exports);
const { classifyError, toFriendlyError } = module.exports;

test("unknown generation outcomes remain uncertain even when the reason mentions cancellation, auth or network", () => {
    for (const error of ["结果未知：Failed to fetch", "本地等待中断，结果未知；请求可能已被接受", "查询中断，远端状态未知", "查询中断，远端任务状态未知；可取任务状态继续查询", Object.assign(new Error("Aborted"), { outcome: "unknown" }), Object.assign(new Error("401"), { outcome: "unknown" })]) {
        const result = toFriendlyError(error);
        assert.equal(result.kind, "uncertain");
        assert.equal(result.title, "friendlyError.uncertain.title");
        assert.equal(result.hint, "friendlyError.uncertain.hint");
        assert.deepEqual(result.actions, []);
    }
});

test("ordinary connection errors and confirmed refusal retain actionable classifications", () => {
    assert.equal(classifyError("Failed to fetch"), "network");
    assert.equal(toFriendlyError(Object.assign(new Error("invalid API key"), { outcome: "rejected" }), 403).kind, "auth");
    assert.equal(classifyError("Aborted"), "canceled");
    assert.equal(classifyError("unclassified local validation"), "unknown");
});
