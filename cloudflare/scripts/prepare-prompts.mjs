import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

/** Offline only: immutable Git content, no network, credentials or publishing side effects. */
export async function preparePromptSnapshot({ repository, ref = "HEAD", output }) {
    const git = (args) => new Promise((resolve,reject) => {
        const child=spawn("git",["-C",repository,...args],{stdio:["ignore","pipe","pipe"]});const chunks=[];const errors=[];
        child.stdout.on("data",(data)=>chunks.push(data));child.stderr.on("data",(data)=>errors.push(data));child.on("error",reject);child.on("close",(code)=>code===0?resolve(Buffer.concat(chunks)):reject(new Error(`Git read failed: ${Buffer.concat(errors).toString()}`)));
    });
    const commit = (await git(["rev-parse", "--verify", `${ref}^{commit}`])).toString().trim();
    if (!/^[a-f0-9]{40}$/.test(commit)) throw new Error("Unsupported Git commit identity");
    const prefix = "web/public/prompt-sources/";
    const paths = (await git(["ls-tree", "-r", "--format=%(objectmode) %(path)", "-z", commit, "--", prefix])).toString().split("\0").filter(Boolean);
    const resources = [];
    for (const entry of paths) {
        const mode = entry.slice(0, entry.indexOf(" ")); const filename = entry.slice(entry.indexOf(" ") + 1); const resource = filename.slice(prefix.length);
        if (mode !== "100644" && mode !== "100755") throw new Error(`Refusing non-regular public resource: ${filename}`);
        if (!/^(?:[A-Za-z0-9_-]+\.(?:json|md)|covers\/[A-Za-z0-9_-]+\.webp)$/.test(resource)) throw new Error(`Resource outside approved prompt scope: ${filename}`);
        const data = await git(["show", `${commit}:${filename}`]);
        resources.push({ path: resource, bytes: data.length, sha256: crypto.createHash("sha256").update(data).digest("hex"), data });
    }
    const catalog = resources.find((item) => item.path === "manifest.json"); if (!catalog) throw new Error("Prompt manifest missing from selected commit");
    const manifest = JSON.parse(catalog.data.toString());
    for (const source of manifest.sources || []) if (!resources.some((item) => item.path === source.path)) throw new Error(`Source missing: ${source.path}`);
    for (const item of resources.filter((item) => item.path.endsWith(".json") && item.path !== "manifest.json")) {
        const rows = JSON.parse(item.data.toString());
        if (!Array.isArray(rows)) throw new Error(`Prompt source is not an array: ${item.path}`);
        for (const row of rows) if (typeof row.coverUrl === "string" && row.coverUrl.startsWith("/prompt-sources/") && !resources.some((file) => file.path === row.coverUrl.slice("/prompt-sources/".length))) throw new Error(`Cover missing: ${row.coverUrl}`);
    }
    const report = { version: 1, commit, prefix: `snapshots/${commit}/`, generatedAt: manifest.generatedAt, files: resources.map(({ data: _, ...item }) => item) };
    if (output) {
        // Fail if the destination exists; never replace a previous prepared snapshot.
        await fs.mkdir(output);
        const snapshot = path.join(output, "snapshots", commit); await fs.mkdir(snapshot, { recursive: true });
        for (const item of resources) { const target = path.join(snapshot, item.path); await fs.mkdir(path.dirname(target), { recursive: true }); await fs.writeFile(target, item.data, { flag: "wx" }); }
        await fs.writeFile(path.join(output, "release-manifest.json"), JSON.stringify(report, null, 2), { flag: "wx" });
    }
    return report;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const args = process.argv.slice(2); const options = { repository: path.resolve(fileURLToPath(new URL("../..", import.meta.url))) };
    for (let index = 0; index < args.length; index++) { const flag = args[index]; if (flag === "--ref") options.ref = args[++index]; else if (flag === "--write-dir") options.output = path.resolve(args[++index]); else if (flag !== "--dry-run") throw new Error(`Unknown argument: ${flag}`); }
    if(args.includes("--dry-run") && options.output)throw new Error("--dry-run cannot be combined with --write-dir");
    console.log(JSON.stringify(await preparePromptSnapshot(options), null, 2));
}
