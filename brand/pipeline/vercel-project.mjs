// Project-scoped tokens cannot read /v2/user. Resolve only the prompt project.
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

try {
    const token = process.env.VERCEL_TOKEN;
    if (!token) throw new Error("缺少 VERCEL_TOKEN");
    const url = new URL("https://api.vercel.com/v9/projects/dianran-prompts");
    url.searchParams.set("slug", process.env.VERCEL_SCOPE || "kobingogos-projects");
    const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!response.ok) throw new Error(`项目访问失败（HTTP ${response.status}），请核对 PROMPT_VERCEL_TOKEN 的项目授权`);
    const project = await response.json();
    if (project.name !== "dianran-prompts" || typeof project.id !== "string" || !project.id || typeof project.accountId !== "string" || !project.accountId) {
        throw new Error("返回的项目身份不完整或不是 dianran-prompts，拒绝部署");
    }
    const file = process.argv[2];
    if (file) {
        await mkdir(dirname(file), { recursive: true });
        await writeFile(file, JSON.stringify({ projectId: project.id, orgId: project.accountId, projectName: project.name }));
    }
    console.log("Vercel 项目访问已确认：dianran-prompts");
} catch (error) {
    // Do not log response bodies, credentials or request headers.
    console.error(error instanceof TypeError || error instanceof SyntaxError ? "Vercel 项目请求失败，请检查网络和响应格式" : error.message);
    process.exitCode = 1;
}
