import { execFile } from "node:child_process";
import { mkdirSync, existsSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import type { Express } from "express";
import { z } from "zod";

const execute = promisify(execFile);
const idSchema = z.string().uuid();
const resultSchema = z.object({ status: z.enum(["published", "unchanged", "held", "failed"]), snapshot: z.string(), added: z.number(), sources: z.string(), prUrl: z.string().optional(), runUrl: z.string().optional() });
type CloudJob = { id: string; mode: "github"; repo: string; createdAt: string; status: "running" | "unknown" | z.infer<typeof resultSchema>["status"]; phase: string; runId?: number; runUrl?: string } & Partial<Omit<z.infer<typeof resultSchema>, "status">>;

/** A saved request is dispatched once. Restart and uncertain submissions only look it up. */
export function installGithubPromptPipelineRoutes(app: Express, directory: string, repo: string) {
    if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error("DIANRAN_PROMPT_PIPELINE_GITHUB_REPO 格式应为 owner/repo");
    const fileOf = (id: string) => path.join(directory, `${id}.json`);
    const save = (job: CloudJob) => { const file = fileOf(job.id); writeFileSync(`${file}.tmp`, JSON.stringify(job)); renameSync(`${file}.tmp`, file); };
    const read = (id: string): CloudJob | null => existsSync(fileOf(id)) ? JSON.parse(readFileSync(fileOf(id), "utf8")) : null;
    const gh = async (...args: string[]) => (await execute("gh", args)).stdout;
    const refresh = async (job: CloudJob) => {
        if (job.mode !== "github" || !["running", "unknown"].includes(job.status)) return job;
        if (!job.runId) {
            const output = await gh("api", "--paginate", "--method", "GET", `repos/${job.repo}/actions/workflows/prompt-pipeline.yml/runs`, "-f", "event=workflow_dispatch", "-f", `created=>=${job.createdAt}`, "--jq", `.workflow_runs[] | select(.display_title == "prompt-pipeline ${job.id}") | .id`);
            const runs = output.trim() ? output.trim().split("\n").map(Number) : [];
            if (runs.length > 1) { job.status = "unknown"; job.phase = "同一身份关联多个云端运行，请核对 GitHub Actions"; save(job); return job; }
            if (!runs.length) return job;
            job.runId = runs[0];
        }
        const run = JSON.parse(await gh("api", `repos/${job.repo}/actions/runs/${job.runId}`));
        job.runUrl = run.html_url;
        if (run.status !== "completed") { job.status = "running"; job.phase = run.status === "in_progress" ? "云端正在采集、校验与发布" : "云端任务正在排队"; }
        else {
            const output = path.join(directory, `${job.id}.cloud-result`);
            mkdirSync(output, { recursive: true });
            try {
                if (!existsSync(path.join(output, "result.json"))) await gh("run", "download", String(job.runId), "--repo", job.repo, "--name", "prompt-pipeline-result", "--dir", output);
                Object.assign(job, resultSchema.parse(JSON.parse(readFileSync(path.join(output, "result.json"), "utf8"))));
                if (run.conclusion !== "success") job.status = "failed";
                job.phase = job.status === "failed" ? "云端任务失败，请查看运行记录" : "云端采集已结束";
            } catch {
                job.status = run.conclusion === "success" ? "unknown" : "failed";
                job.phase = "未取得完整云端回执，请查看运行记录；不会重新提交";
            }
        }
        save(job);
        return job;
    };
    app.get("/agent/prompt-pipeline/jobs/:id", async (req, res, next) => {
        try {
            const parsed = idSchema.safeParse(req.params.id);
            if (!parsed.success) return void res.status(400).json({ error: "任务身份无效" });
            const job = read(parsed.data);
            if (!job) return void res.status(404).json({ error: "未找到采集任务" });
            res.json({ ok: true, data: await refresh(job) });
        } catch (error) { next(error); }
    });
    app.post("/agent/prompt-pipeline/jobs", async (req, res, next) => {
        try {
            const id = idSchema.parse(req.body?.requestId);
            const previous = read(id);
            if (previous) return void res.json({ ok: true, data: await refresh(previous) });
            const job: CloudJob = { id, mode: "github", repo, createdAt: new Date(Math.floor(Date.now() / 1000) * 1000).toISOString(), status: "running", phase: "正在提交云端采集任务" };
            save(job);
            try {
                await gh("api", "--method", "POST", `repos/${repo}/actions/workflows/prompt-pipeline.yml/dispatches`, "-f", "ref=main", "-f", `inputs[request_id]=${id}`);
                job.phase = "已提交 GitHub Actions，正在确认运行记录";
            } catch {
                job.status = "unknown";
                job.phase = "云端提交未确认，请核对 GitHub Actions 和 gh 权限；不会重复提交";
            }
            save(job);
            res.status(202).json({ ok: true, data: job });
        } catch (error) { next(error); }
    });
}
