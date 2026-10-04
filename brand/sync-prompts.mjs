#!/usr/bin/env node
// [dianran] Snapshot redistributable prompt sources into web/public/prompt-sources so the app
// serves them from its own domain (no runtime requests to raw.githubusercontent.com).
// Usage: node brand/sync-prompts.mjs   (run occasionally, commit the result)
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const outDir = resolve(root, "web/public/prompt-sources");
const REGISTRY = "https://raw.githubusercontent.com/yukkcat/image-prompts/main/dist/sources";

// Only sources whose license allows redistribution. davidwu-gpt-image2-prompts has no license file -> not bundled.
export const SOURCES = [
    { id: "youmind-gpt-image-2", name: "YouMind GPT Image 2", repo: "YouMind-OpenLab/awesome-gpt-image-2", license: "CC BY 4.0" },
    { id: "youmind-nano-banana-pro", name: "YouMind Nano Banana Pro", repo: "YouMind-OpenLab/awesome-nano-banana-pro-prompts", license: "CC BY 4.0" },
    { id: "awesome-gpt4o-image-prompts", name: "Awesome GPT-4o", repo: "ImgEdify/Awesome-GPT4o-Image-Prompts", license: "MIT" },
    { id: "banana-prompt-quicker", name: "Banana Prompt Quicker", repo: "glidea/banana-prompt-quicker", license: "MIT" },
    { id: "freestylefly-gpt-image-2", name: "Freestylefly GPT Image 2", repo: "freestylefly/awesome-gpt-image-2", license: "MIT" },
    { id: "awesome-gpt-image", name: "Awesome GPT Image", repo: "ZeroLu/awesome-gpt-image", license: "MIT" },
];

mkdirSync(outDir, { recursive: true });
const manifest = { generatedAt: new Date().toISOString(), registry: "https://github.com/yukkcat/image-prompts (MIT)", sources: [] };
for (const source of SOURCES) {
    const response = await fetch(`${REGISTRY}/${source.id}.json`);
    if (!response.ok) throw new Error(`${source.id}: HTTP ${response.status}`);
    const items = await response.json();
    if (!Array.isArray(items) || !items.length) throw new Error(`${source.id}: empty`);
    writeFileSync(resolve(outDir, `${source.id}.json`), JSON.stringify(items));
    manifest.sources.push({ ...source, count: items.length, path: `${source.id}.json` });
    console.log(`${source.id}: ${items.length}`);
}
writeFileSync(resolve(outDir, "manifest.json"), JSON.stringify(manifest, null, 2));

const lines = [
    "# Bundled prompt sources / 内置提示词来源",
    "",
    "These files are unmodified snapshots of the normalized JSON published by",
    "[yukkcat/image-prompts](https://github.com/yukkcat/image-prompts) (MIT), served from this site so the app",
    "works without reaching GitHub. Prompt text belongs to the original authors under the licenses below.",
    "Cover images are not bundled; they are loaded from the original hosts only when you browse the prompt library.",
    "",
    "| Source | Upstream | License |",
    "| --- | --- | --- |",
    "| 点染精选 (dianran-picks) | this project | MIT |",
    ...SOURCES.map((s) => `| ${s.name} | https://github.com/${s.repo} | ${s.license} |`),
    "",
    "CC BY 4.0 material: © YouMind OpenLab, https://creativecommons.org/licenses/by/4.0/ — records were normalized",
    "(field mapping only) by yukkcat/image-prompts. No endorsement by the licensors is implied.",
    "",
];
writeFileSync(resolve(outDir, "LICENSES.md"), lines.join("\n"));
console.log("done ->", outDir);
