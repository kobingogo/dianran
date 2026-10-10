import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import matter from "gray-matter";
import { parse as parseYaml } from "yaml";
import { constants } from "node:fs";

export class SkillPackageError extends Error {
    constructor(message: string, readonly statusCode: 400 | 404 | 409 = 400) { super(message); }
}
export type SkillFile = { path: string; content: string; mode: string; sha256: string; bytes: number; text?: string };
export type SkillOrigin = { url: string; commit: string; directory: string; ref: string };
export type SkillPackageReview = { id: string; name: string; description: string; origin: SkillOrigin; digest: string; files: SkillFile[]; changes: { path: string; kind: "新增" | "修改" | "删除" }[]; requirements: unknown; expectedRevision?: string };
const originFile = ".dianran-origin.json";
const sha = (data: crypto.BinaryLike) => crypto.createHash("sha256").update(data).digest("hex");
export function resourcePath(value: string) {
    if (typeof value !== "string" || !value || value.includes("\\") || value.includes("\0") || value.includes(":" ) || value.startsWith("/") || value.split("/").some(part => !part || part === "." || part === ".." || part === ".git")) throw new SkillPackageError("资源路径不安全");
    return value;
}
export async function readSkillFiles(directory: string, prefix = ""): Promise<SkillFile[]> {
    const root = await fs.lstat(directory);
    if (!root.isDirectory() || root.isSymbolicLink()) throw new SkillPackageError("Skill 目录不安全");
    const files: SkillFile[] = [];
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
        const name = resourcePath(prefix + entry.name), file = path.join(directory, entry.name), stat = await fs.lstat(file);
        if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile())) throw new SkillPackageError("Skill 中存在链接或特殊文件，停止操作");
        if (stat.isDirectory()) files.push(...await readSkillFiles(file, name + "/"));
        else {
            const data = await fs.readFile(file);
            let text: string | undefined;
            try { text = new TextDecoder("utf-8", { fatal: true }).decode(data); if (text.includes("\0")) text = undefined; } catch { /* Binary resource is retained byte-for-byte. */ }
            files.push({ path: name, content: data.toString("base64"), mode: stat.mode & 0o111 ? "100755" : "100644", sha256: sha(data), bytes: data.length, text });
        }
    }
    return files.sort((a, b) => a.path.localeCompare(b.path));
}
export function filesDigest(files: SkillFile[]) { return sha(JSON.stringify(files.map(file => [file.path, file.sha256, file.mode]).sort())); }
export async function skillTreeRevision(directory: string) { return filesDigest(await readSkillFiles(directory)); }
export async function skillResources(directory: string) { return skillResourcesFromFiles(await readSkillFiles(directory)); }
export async function skillResourcesFromFiles(files: SkillFile[]) {
    const raw = files.find(file => file.path === originFile)?.text;
    const origin = raw ? JSON.parse(raw) as SkillOrigin : undefined;
    const doc = matter(files.find(file => file.path === "SKILL.md")?.text || "");
    return { files: files.filter(file => file.path !== originFile), origin, requirements: declaredRequirements(doc.data, files), readiness: await dependencyReadiness(doc.data, files) };
}
export class SkillPackages {
    private reviews = new Map<string, SkillPackageReview>();
    constructor(private root: string, private mutate: <T>(fn: (skillsPath: string) => Promise<T>) => Promise<T>, private request: typeof fetch = fetch, private validate?: (name: string, directory: string) => Promise<void>) {}
    private async github(repository: string, endpoint: string): Promise<any> {
        const response = await this.request(`https://api.github.com/repos/${repository}/${endpoint}`, { redirect: "error", headers: { Accept: "application/vnd.github+json" } });
        if (!response.ok) throw new SkillPackageError(response.status === 403 || response.status === 429 ? "GitHub 请求额度受限，请稍后重试" : `读取公开 GitHub 仓库失败（${response.status}）`, 409);
        return response.json();
    }
    async review(input: { url: string; skillPath?: string; ref?: string; expectedRevision?: string }) {
        let url: URL;
        try { url = new URL(input.url); } catch { throw new SkillPackageError("请填写 GitHub 仓库或目录链接"); }
        if (url.protocol !== "https:" || url.hostname !== "github.com" || url.port || url.username || url.password || url.search || url.hash) throw new SkillPackageError("当前只支持公开 github.com HTTPS 链接");
        const parts = url.pathname.replace(/\/$/, "").split("/").slice(1).map(decodeURIComponent);
        const [owner, repoValue, kind, refValue, ...rest] = parts, repo = repoValue?.replace(/\.git$/, "");
        if (!owner || !repo || [".", ".."].includes(repo) || !/^[A-Za-z0-9][A-Za-z0-9-]*$/.test(owner) || !/^[\w.-]+$/.test(repo) || (kind && kind !== "tree" && kind !== "blob")) throw new SkillPackageError("GitHub 链接格式无效");
        const repository = `${owner}/${repo}`;
        const ref = input.ref || refValue || (await this.github(repository, "")).default_branch;
        const commit = await this.github(repository, `commits/${encodeURIComponent(ref)}`);
        if (!/^[a-f0-9]{40}$/.test(commit.sha) || !/^[a-f0-9]{40}$/.test(commit.commit?.tree?.sha)) throw new SkillPackageError("GitHub 提交身份无效");
        const tree = await this.github(repository, `git/trees/${commit.commit.tree.sha}?recursive=1`);
        if (tree.truncated || !Array.isArray(tree.tree)) throw new SkillPackageError("仓库文件清单不完整，未安装；请使用较小的专用仓库", 409);
        const entries = tree.tree as { path: string; mode: string; type: string; sha: string }[];
        const refParts = input.ref && input.ref.split("/")[0] === refValue ? input.ref.split("/").length - 1 : 0;
        const linkedPath = rest.slice(refParts).join("/").replace(/\/?SKILL\.md$/, "");
        const candidates = entries.filter(entry => entry.type === "blob" && (entry.path === "SKILL.md" || entry.path.endsWith("/SKILL.md")) && (!linkedPath || entry.path === `${linkedPath}/SKILL.md` || entry.path.startsWith(linkedPath + "/"))).map(entry => entry.path.replace(/\/?SKILL\.md$/, ""));
        const directory = input.skillPath ?? (candidates.length === 1 ? candidates[0] : undefined);
        if (directory === undefined) return { candidates, commit: commit.sha };
        if (directory) resourcePath(directory);
        if (!candidates.includes(directory)) throw new SkillPackageError("所选目录缺少 SKILL.md");
        const selected = entries.filter(entry => directory ? entry.path.startsWith(directory + "/") : true);
        const licenses = entries.filter(entry => entry.type === "blob" && /^(LICENSE|LICENCE|COPYING|NOTICE)(\.[^/]*)?$/i.test(entry.path));
        const files: SkillFile[] = [];
        for (const entry of [...selected, ...licenses.filter(entry => !selected.includes(entry))]) {
            if (entry.type === "tree") continue;
            if (entry.type !== "blob" || !["100644", "100755"].includes(entry.mode)) throw new SkillPackageError("Skill 包含符号链接或子模块，未安装");
            if (!/^[a-f0-9]{40}$/.test(entry.sha)) throw new SkillPackageError("资源身份无效");
            const name = selected.includes(entry) && directory ? entry.path.slice(directory.length + 1) : selected.includes(entry) ? entry.path : `repository-${entry.path}`;
            resourcePath(name);
            if (name === originFile || files.some(file => file.path === name)) throw new SkillPackageError("Skill 文件名与来源记录或许可证冲突");
            const blob = await this.github(repository, `git/blobs/${entry.sha}`);
            if (blob.encoding !== "base64" || typeof blob.content !== "string") throw new SkillPackageError("GitHub 资源编码不支持");
            const data = Buffer.from(blob.content, "base64");
            const gitHash = crypto.createHash("sha1").update(`blob ${data.length}\0`).update(data).digest("hex");
            if (gitHash !== entry.sha) throw new SkillPackageError("下载文件校验失败，未安装");
            let text: string | undefined;
            try { text = new TextDecoder("utf-8", { fatal: true }).decode(data); if (text.includes("\0")) text = undefined; } catch { /* Keep binary files. */ }
            files.push({ path: name, content: data.toString("base64"), mode: entry.mode, sha256: sha(data), bytes: data.length, text });
        }
        files.sort((a, b) => a.path.localeCompare(b.path));
        const document = matter(files.find(file => file.path === "SKILL.md")?.text || ""), name = document.data.name;
        if (typeof name !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name) || name.length > 64 || typeof document.data.description !== "string" || !document.data.description.trim() || !document.content.trim()) throw new SkillPackageError("SKILL.md 缺少有效名称、描述或正文");
        const previous = await this.mutate(async skills => {
            try { return await readSkillFiles(path.join(skills, name)); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; return []; }
        });
        const expectedRevision = previous.length ? filesDigest(previous) : undefined;
        if (input.expectedRevision && input.expectedRevision !== expectedRevision) throw new SkillPackageError("本地 Skill 已改变，请重新加载后审阅更新", 409);
        const all = new Set([...previous.map(file => file.path), ...files.map(file => file.path)]);
        all.delete(originFile);
        const changes = [...all].flatMap(filePath => { const before = previous.find(file => file.path === filePath), after = files.find(file => file.path === filePath); return before?.sha256 === after?.sha256 && before?.mode === after?.mode ? [] : [{ path: filePath, kind: !before ? "新增" as const : !after ? "删除" as const : "修改" as const }]; });
        const review: SkillPackageReview = { id: crypto.randomUUID(), name, description: document.data.description, origin: { url: `https://github.com/${repository}`, commit: commit.sha, directory, ref }, digest: filesDigest(files), files, changes, requirements: declaredRequirements(document.data, files), expectedRevision };
        this.reviews.set(review.id, review);
        return { review: structuredClone(review) };
    }
    cancel(id: string) { this.reviews.delete(id); }
    install(id: string, digest: string) {
        return this.mutate(async skills => {
            const review = this.reviews.get(id);
            if (!review || review.digest !== digest || filesDigest(review.files) !== digest) throw new SkillPackageError("安装审阅已失效，请重新读取", 409);
            const directory = path.join(skills, review.name);
            let old: SkillFile[] | undefined;
            try { old = await readSkillFiles(directory); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
            if ((old ? filesDigest(old) : undefined) !== review.expectedRevision) throw new SkillPackageError("本地 Skill 在审阅后已改变，未覆盖", 409);
            const files = [...review.files, fileFromText(originFile, JSON.stringify(review.origin))];
            await this.replace(skills, review.name, files, old);
            this.reviews.delete(id);
            return { name: review.name };
        });
    }
    async versions(name: string) {
        this.name(name);
        const directory = await this.historyRoot(name);
        const names = await fs.readdir(directory);
        const versions = [];
        for (const revision of names.filter(value => /^[a-f0-9]{64}$/.test(value))) {
            const files = await readSkillFiles(path.join(directory, revision));
            if (filesDigest(files) !== revision) throw new SkillPackageError("历史版本完整性校验失败", 409);
            versions.push({ revision, files: files.map(file => ({ path: file.path, bytes: file.bytes })), origin: JSON.parse(files.find(file => file.path === originFile)?.text || "null") as SkillOrigin | null });
        }
        return versions;
    }
    rollback(name: string, revision: string, expectedRevision: string) {
        this.name(name);
        if (!/^[a-f0-9]{64}$/.test(revision)) throw new SkillPackageError("历史版本身份无效");
        return this.mutate(async skills => {
            const old = await readSkillFiles(path.join(skills, name));
            if (filesDigest(old) !== expectedRevision) throw new SkillPackageError("本地 Skill 已改变，未回退", 409);
            const files = await readSkillFiles(path.join(await this.historyRoot(name), revision));
            if (filesDigest(files) !== revision) throw new SkillPackageError("历史文件已改变，未回退", 409);
            await this.replace(skills, name, files, old);
        });
    }
    private name(name: string) { if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) throw new SkillPackageError("Skill 名称无效"); }
    private async historyRoot(name: string) {
        const parts = [".dianran-skill-history", name];
        let directory = this.root;
        for (const part of parts) { directory = path.join(directory, part); try { await fs.mkdir(directory); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; } const entry = await fs.lstat(directory); if (!entry.isDirectory() || entry.isSymbolicLink()) throw new SkillPackageError("历史目录不安全"); }
        return directory;
    }
    private async writeFiles(directory: string, files: SkillFile[]) {
        for (const file of files) { resourcePath(file.path); const data = Buffer.from(file.content, "base64"); if (sha(data) !== file.sha256) throw new SkillPackageError("文件摘要校验失败"); const target = path.join(directory, file.path); await fs.mkdir(path.dirname(target), { recursive: true }); await fs.writeFile(target, data, { flag: "wx", mode: file.mode === "100755" ? 0o755 : 0o644 }); }
    }
    private async replace(skills: string, name: string, files: SkillFile[], old?: SkillFile[]) {
        const staging = await fs.mkdtemp(path.join(skills, ".install-")), target = path.join(skills, name);
        let backup: string | undefined;
        try {
            await this.writeFiles(staging, files);
            await this.validate?.(name, staging);
            if (old) {
                const history = await this.historyRoot(name), digest = filesDigest(old), archived = path.join(history, digest);
                try { const saved = await readSkillFiles(archived); if (filesDigest(saved) !== digest) throw new SkillPackageError("已有历史版本冲突，未覆盖", 409); }
                catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; const temp = await fs.mkdtemp(path.join(history, ".backup-")); try { await this.writeFiles(temp, old); await fs.rename(temp, archived); } finally { await fs.rm(temp, { recursive: true, force: true }); } }
                if (await skillTreeRevision(target) !== digest) throw new SkillPackageError("保存备份期间 Skill 已改变，未覆盖", 409);
                backup = path.join(skills, `.replace-${crypto.randomUUID()}`);
                await fs.rename(target, backup);
            }
            try { await fs.rename(staging, target); } catch (error) { if (backup) await fs.rename(backup, target); throw error; }
            if (backup) await fs.rm(backup, { recursive: true });
        } finally { await fs.rm(staging, { recursive: true, force: true }); }
    }
}
export function fileFromText(filePath: string, text: string): SkillFile { const data = Buffer.from(text); return { path: filePath, content: data.toString("base64"), bytes: data.length, sha256: sha(data), mode: "100644", text }; }

function declaredRequirements(frontmatter: Record<string, any>, files: SkillFile[]) {
    const yaml = files.find(file => file.path === "agents/openai.yaml")?.text;
    const agent = yaml ? parseYaml(yaml) : null;
    return { declared: frontmatter.metadata?.requires || frontmatter.metadata?.openclaw?.requires || frontmatter.dependencies || null, tools: agent?.dependencies?.tools || [] };
}
export async function dependencyReadiness(frontmatter: Record<string, any>, files: SkillFile[]) {
    const requirements = declaredRequirements(frontmatter, files), declared = requirements.declared;
    const missing: string[] = [];
    const bins = Array.isArray(declared?.bins) ? declared.bins : [];
    const env = Array.isArray(declared?.env) ? declared.env : [];
    for (const bin of bins) {
        if (typeof bin !== "string" || !/^[\w.-]+$/.test(bin)) continue;
        let found = false;
        for (const directory of (process.env.PATH || "").split(path.delimiter).filter(Boolean)) {
            try { await fs.access(path.join(directory, bin), constants.X_OK); if ((await fs.stat(path.join(directory, bin))).isFile()) { found = true; break; } } catch { /* Missing executable; never run it to inspect a Skill. */ }
        }
        if (!found) missing.push(`工具：${bin}`);
    }
    for (const variable of env) if (typeof variable === "string" && /^[A-Za-z_][A-Za-z0-9_]*$/.test(variable) && !process.env[variable]) missing.push(`环境变量：${variable}`);
    return { status: missing.length ? "missing" as const : "unchecked" as const, missing, note: "仅检查已声明的工具和环境变量，不执行脚本；MCP、账户和实际调用仍需验证。" };
}
