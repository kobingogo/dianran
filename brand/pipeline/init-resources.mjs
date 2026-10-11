#!/usr/bin/env node
// One-time preparation only: copy the existing snapshot to a new directory. Never delete, commit or publish.
import { cpSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const codeRoot = fileURLToPath(new URL("../../", import.meta.url));
if (!process.argv[2]) throw new Error("用法：node brand/pipeline/init-resources.mjs /绝对路径/dianran-prompts");
const target = resolve(process.argv[2]);
mkdirSync(target); // Existing destinations are refused, including empty directories.
for (const [source, destination] of [["web/public/prompt-sources", "prompt-sources"], ["brand/pipeline/data", "data"], ["brand/pipeline/reports", "reports"]]) {
    cpSync(resolve(codeRoot, source), resolve(target, destination), { recursive: true, errorOnExist: true, force: false });
}
writeFileSync(resolve(target, ".gitignore"), "candidates/\n.vercel/\n.env*\n.DS_Store\n");
writeFileSync(resolve(target, "README.md"), `# 点染提示词资源\n\n点染公开提示词快照。JSON、清单及 WebP 封面位于 prompt-sources/；维护状态位于 data/，报告位于 reports/。\n\n采集与发布脚本保留在 [点染主仓库](https://github.com/kobingogo/dianran/tree/main/brand/pipeline)。维护者设置 DIANRAN_PROMPT_PIPELINE_ROOT 指向本仓库，在主仓库运行脚本。临时采集文件与日志位于忽略的 candidates/。\n\nVercel 仅发布 prompt-sources/，主站通过 /prompt-sources/* 访问。条目和封面权利归原作者，来源与授权见 [LICENSES.md](prompt-sources/LICENSES.md)。\n`);
console.log(`已复制到 ${target}；原文件保留，请核对后初始化 Git 并推送。`);
