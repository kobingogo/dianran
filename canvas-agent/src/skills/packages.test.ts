import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { SkillStore } from "./store.js";
import { SkillPackages, resourcePath } from "./packages.js";

async function fixture(t: any) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "dianran-skill-package-"));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    const store = new SkillStore(root);
    let commit = "a".repeat(40), truncated = false;
    let files: Record<string, { data: Buffer; mode: string }> = {
        "skills/poster/SKILL.md": { data: Buffer.from("---\nname: poster\ndescription: Create a poster\n---\nUse references/brand.md and assets/logo.png.\n"), mode: "100644" },
        "skills/poster/references/brand.md": { data: Buffer.from("warm white"), mode: "100644" },
        "skills/poster/assets/logo.png": { data: Buffer.from([0, 255, 12, 13]), mode: "100644" },
        "skills/poster/scripts/render.sh": { data: Buffer.from("echo DO_NOT_EXECUTE"), mode: "100755" },
        "LICENSE": { data: Buffer.from("license text"), mode: "100644" },
    };
    const blobHash = (data: Buffer) => crypto.createHash("sha1").update(`blob ${data.length}\0`).update(data).digest("hex");
    const request: typeof fetch = async (url, options) => {
        assert.equal(options?.redirect, "error");
        const endpoint = String(url).split("/repos/author/repository/")[1];
        if (!endpoint) return Response.json({ default_branch: "main" });
        if (endpoint.startsWith("commits/")) return Response.json({ sha: commit, commit: { tree: { sha: "c".repeat(40) } } });
        if (endpoint.startsWith("git/trees/")) return Response.json({ truncated, tree: Object.entries(files).map(([file, item]) => ({ path: file, mode: item.mode, type: "blob", sha: blobHash(item.data) })) });
        const file = Object.values(files).find(item => blobHash(item.data) === endpoint.replace("git/blobs/", ""));
        return file ? Response.json({ encoding: "base64", content: file.data.toString("base64") }) : new Response("", { status: 404 });
    };
    const packages = new SkillPackages(root, operation => store.packageMutation(operation), request, (name, directory) => store.validatePackage(name, directory));
    const review = async () => (await packages.review({ url: "https://github.com/author/repository/tree/main/skills/poster" })).review!;
    return { root, store, packages, review, setFile: (name: string, text: string, mode = "100644") => { files[name] = { data: Buffer.from(text), mode }; commit = "b".repeat(40); }, truncate: () => { truncated = true; } };
}

test("GitHub review installs complete binary, scripts, references and repository license snapshot without execution", async t => {
    const f = await fixture(t), review = await f.review();
    assert.equal(review.files.length, 5);
    await assert.rejects(fs.access(path.join(f.root, ".agents/skills/poster")));
    assert.equal(review.origin.commit, "a".repeat(40));
    await f.packages.install(review.id, review.digest);
    const detail = await f.store.get("poster");
    assert.equal(detail.resources?.origin?.commit, review.origin.commit);
    assert.deepEqual(await fs.readFile(path.join(f.root, ".agents/skills/poster/assets/logo.png")), Buffer.from([0, 255, 12, 13]));
    assert.equal(await fs.readFile(path.join(f.root, ".agents/skills/poster/repository-LICENSE"), "utf8"), "license text");
    assert.ok((await fs.stat(path.join(f.root, ".agents/skills/poster/scripts/render.sh"))).mode & 0o111);
    await assert.rejects(f.packages.install(review.id, review.digest), /失效/);
});

test("updates freeze reviewed remote files and retain a verifiable complete rollback version", async t => {
    const f = await fixture(t), first = await f.review();
    await f.packages.install(first.id, first.digest);
    const previous = await f.store.get("poster");
    f.setFile("skills/poster/references/brand.md", "blue");
    const second = await f.review();
    assert.deepEqual(second.changes, [{ path: "references/brand.md", kind: "修改" }]);
    f.setFile("skills/poster/references/brand.md", "later remote change");
    await f.packages.install(second.id, second.digest);
    const updated = await f.store.get("poster");
    assert.equal(updated.resources?.files.find(file => file.path === "references/brand.md")?.text, "blue");
    assert.ok((await f.packages.versions("poster")).some(version => version.revision === previous.revision));
    await f.packages.rollback("poster", previous.revision, updated.revision);
    assert.equal((await f.store.get("poster")).revision, previous.revision);
});

test("local resource edits invalidate installation, deletion and rollback revisions", async t => {
    const f = await fixture(t), first = await f.review();
    await f.packages.install(first.id, first.digest);
    const current = await f.store.get("poster"), update = await f.review();
    await fs.writeFile(path.join(f.root, ".agents/skills/poster/references/brand.md"), "external edit");
    await assert.rejects(f.packages.install(update.id, update.digest), /改变/);
    await assert.rejects(f.store.delete("poster", current.revision), /修改/);
    await assert.rejects(f.store.resource("poster", { path: "references/brand.md", text: "overwrite", expectedRevision: current.revision }), /修改/);
});

test("resources support binary upload, preserve script permissions and reject protected paths and accidental replacement", async t => {
    const f = await fixture(t), first = await f.review(); await f.packages.install(first.id, first.digest);
    let detail = await f.store.get("poster");
    detail = await f.store.resource("poster", { path: "scripts/render.sh", text: "echo NEW", expectedRevision: detail.revision });
    assert.ok((await fs.stat(path.join(f.root, ".agents/skills/poster/scripts/render.sh"))).mode & 0o111);
    await assert.rejects(f.store.resource("poster", { path: "sKiLL.md", text: "changed", expectedRevision: detail.revision }), /正文编辑器/);
    await assert.rejects(f.store.resource("poster", { path: "assets/logo.png", content: "AA==", create: true, expectedRevision: detail.revision }), /已存在/);
    detail = await f.store.resource("poster", { path: "assets/new.png", content: "AP8=", create: true, expectedRevision: detail.revision });
    assert.deepEqual(await fs.readFile(path.join(f.root, ".agents/skills/poster/assets/new.png")), Buffer.from([0, 255]));
    detail = await f.store.resource("poster", { path: "assets/new.png", remove: true, expectedRevision: detail.revision });
    assert.equal(detail.resources?.files.some(file => file.path === "assets/new.png"), false);
});

test("review cancellation, truncated trees and link files never install partial skills", async t => {
    const f = await fixture(t), review = await f.review();
    f.packages.cancel(review.id);
    await assert.rejects(f.packages.install(review.id, review.digest), /失效/);
    f.setFile("skills/poster/link", "../../private", "120000");
    await assert.rejects(f.review(), /符号链接/);
    f.truncate();
    await assert.rejects(f.review(), /不完整/);
    for (const input of ["../x", "/x", "a/../x", "a\\b", "a/.git/config", "c:/x"]) assert.throws(() => resourcePath(input), /不安全/);
    await assert.rejects(f.packages.review({ url: "https://evil.example/repo" }), /github.com/);
});

test("missing declared executables and environment variables are identified without running scripts", async t => {
    const f = await fixture(t);
    f.setFile("skills/poster/SKILL.md", "---\nname: poster\ndescription: Create a poster\nmetadata:\n  requires:\n    bins: [dianran-nonexistent-test-tool]\n    env: [DIANRAN_MISSING_SKILL_TEST_KEY]\n---\nUse the declared tool.\n");
    const review = await f.review(); await f.packages.install(review.id, review.digest);
    const readiness = (await f.store.get("poster")).resources?.readiness;
    assert.equal(readiness?.status, "missing"); assert.equal(readiness?.missing.length, 2);
    assert.deepEqual((await f.store.health("poster")).readiness, readiness);
});

test("invalid package interface stops before replacing an existing valid skill", async t => {
    const f = await fixture(t), first = await f.review(); await f.packages.install(first.id, first.digest);
    const before = await f.store.get("poster");
    f.setFile("skills/poster/agents/openai.yaml", "interface: [invalid]\n");
    const update = await f.review();
    await assert.rejects(f.packages.install(update.id, update.digest), /interface 格式无效/);
    assert.equal((await f.store.get("poster")).revision, before.revision);
});


test("multi-skill repositories expose directory selection and install only the chosen skill", async t => {
    const f = await fixture(t);
    f.setFile("skills/other/SKILL.md", "---\nname: other\ndescription: Other skill\n---\nOther instructions.\n");
    const selection = await f.packages.review({ url: "https://github.com/author/repository" });
    assert.deepEqual(selection.candidates, ["skills/poster", "skills/other"]);
    const selected = await f.packages.review({ url: "https://github.com/author/repository", skillPath: "skills/poster" });
    assert.equal(selected.review?.files.some(file => file.path.includes("skills/other")), false);
    await f.packages.install(selected.review!.id, selected.review!.digest);
    await assert.rejects(fs.access(path.join(f.root, ".agents/skills/other")));
});

test("symlinked skill roots and modified historical snapshots cannot be overwritten", async t => {
    const f = await fixture(t), first = await f.review(); await f.packages.install(first.id, first.digest);
    const original = await f.store.get("poster");
    f.setFile("skills/poster/references/brand.md", "updated");
    const update = await f.review(); await f.packages.install(update.id, update.digest);
    const current = await f.store.get("poster");
    await fs.writeFile(path.join(f.root, ".dianran-skill-history/poster", original.revision, "references/brand.md"), "corrupted backup");
    await assert.rejects(f.packages.rollback("poster", original.revision, current.revision), /历史文件已改变/);
    assert.equal((await f.store.get("poster")).revision, current.revision);
    await fs.rename(path.join(f.root, ".agents"), path.join(f.root, "original-agents"));
    await fs.symlink(path.join(f.root, "original-agents"), path.join(f.root, ".agents"));
    await assert.rejects(f.review(), /符号链接/);
});

test("concurrent resource changes with the same revision allow only the first write", async t => {
    const f = await fixture(t), review = await f.review(); await f.packages.install(review.id, review.digest);
    const detail = await f.store.get("poster");
    const writes = await Promise.allSettled(["first", "second"].map(text => f.store.resource("poster", { path: "references/brand.md", text, expectedRevision: detail.revision })));
    assert.equal(writes[0].status, "fulfilled"); assert.equal(writes[1].status, "rejected");
    assert.equal(await fs.readFile(path.join(f.root, ".agents/skills/poster/references/brand.md"), "utf8"), "first");
});
