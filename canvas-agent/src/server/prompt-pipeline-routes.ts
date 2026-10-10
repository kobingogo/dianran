import { spawn, execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Express } from "express";
import { z } from "zod";
import { CONFIG_DIR } from "../config.js";

const requestIdSchema = z.string().uuid();
const resultSchema = z.object({ status: z.enum(["published", "unchanged", "held", "failed"]), snapshot: z.string(), added: z.number(), sources: z.string() });
type Job = { id: string; status: "running" | "unknown" | z.infer<typeof resultSchema>["status"]; phase: string; snapshot?: string; added?: number; sources?: string };

/** Only the locally configured maintainer checkout can run the fixed publication script. */
export function installPromptPipelineRoutes(app: Express, directory = path.join(CONFIG_DIR, "prompt-pipeline-jobs")) {
    mkdirSync(directory, { recursive: true });
    const fileOf = (id: string) => path.join(directory, `${id}.json`);
    const save = (job: Job) => {
        const file = fileOf(job.id);
        writeFileSync(`${file}.tmp`, JSON.stringify(job));
        renameSync(`${file}.tmp`, file);
    };
    const read = (id: string): Job | null => existsSync(fileOf(id)) ? JSON.parse(readFileSync(fileOf(id), "utf8")) : null;
    // Restart cannot establish whether the previous process published. Never repeat it automatically.
    for (const file of readdirSync(directory).filter(file => /^[0-9a-f-]+\.json$/i.test(file))) {
        const job = JSON.parse(readFileSync(path.join(directory, file), "utf8")) as Job;
        requestIdSchema.parse(job.id);
        if (job.status === "running") save({ ...job, status: "unknown", phase: "Agent 已重启，请核对本机流水线日志和线上快照；不会自动重新发布" });
    }
    let active: Job | null = null;
    app.get("/agent/prompt-pipeline/jobs/:id", (req, res) => {
        const parsed = requestIdSchema.safeParse(req.params.id);
        if (!parsed.success) return void res.status(400).json({ error: "任务身份无效" });
        const job = read(parsed.data);
        res.status(job ? 200 : 404).json(job ? { ok: true, data: job } : { error: "未找到采集任务" });
    });
    app.post("/agent/prompt-pipeline/jobs", (req, res, next) => {
        try {
            const id = requestIdSchema.parse(req.body?.requestId);
            const previous = read(id);
            if (previous) return void res.json({ ok: true, data: previous });
            if (active) return void res.status(409).json({ error: "已有采集发布任务运行中，请等待完成" });
            const configuredRoot = process.env.DIANRAN_PROMPT_PIPELINE_ROOT;
            if (!configuredRoot) return void res.status(409).json({ error: "请为维护者 Agent 配置 DIANRAN_PROMPT_PIPELINE_ROOT，指向独立且干净的点染采集仓库" });
            const root = path.resolve(configuredRoot);
            const script = path.join(root, "brand/pipeline/run-twicedaily.sh");
            if (!existsSync(script)) return void res.status(409).json({ error: "配置的采集仓库缺少 run-twicedaily.sh，请先更新仓库" });
            if (!readFileSync(script, "utf8").includes("DIANRAN_PIPELINE_RESULT_FILE")) return void res.status(409).json({ error: "采集仓库脚本尚不支持发布回执，请先更新仓库" });
            if (execFileSync("git", ["status", "--porcelain", "-uall"], { cwd: root, encoding: "utf8" }).trim()) return void res.status(409).json({ error: "采集仓库存在未提交或未跟踪文件，请使用干净的独立仓库；不会覆盖改动" });
            const resultFile = path.join(directory, `${id}.result`);
            const job: Job = { id, status: "running", phase: "正在启动采集与发布" };
            save(job);
            active = job;
            const child = spawn("bash", [script], { cwd: root, env: { ...process.env, DIANRAN_PIPELINE_RESULT_FILE: resultFile }, stdio: ["ignore", "pipe", "ignore"] });
            let pending = "";
            child.stdout.setEncoding("utf8");
            child.stdout.on("data", (chunk: string) => {
                pending += chunk;
                const lines = pending.split("\n");
                pending = lines.pop() || "";
                for (const line of lines) {
                    const stage = line.match(/^\[\d{2}:\d{2}:\d{2}\] == (.+)$/)?.[1];
                    if (stage) {
                        const phases = [["fetch: X", "正在采集 X"], ["fetch: GitHub", "正在采集 GitHub 提示词"], ["fetch: Civitai", "正在采集 Civitai"], ["usage counts", "正在读取站内使用统计"], ["merge", "正在合并与筛选提示词"], ["点染精选", "正在更新点染精选"], ["finalize", "正在整理快照与封面"], ["validate", "正在校验提示词快照"], ["publish", "正在发布并核对线上快照"]];
                        job.phase = phases.find(([prefix]) => stage.startsWith(prefix))?.[1] || "正在处理采集结果";
                        save(job);
                    }
                }
            });
            child.once("error", () => { job.status = "failed"; job.phase = "无法启动采集脚本，请检查本机环境"; save(job); active = null; });
            child.once("close", code => {
                if (job.status !== "running") return;
                try {
                    const result = resultSchema.parse(JSON.parse(readFileSync(resultFile, "utf8")));
                    Object.assign(job, result);
                    if (code !== 0) job.status = "failed";
                    job.phase = job.status === "failed" ? "采集或发布失败，请查看本机流水线日志；未确认发布" : "采集已结束";
                } catch {
                    job.status = code === 0 ? "unknown" : "failed";
                    job.phase = "未收到完整发布回执，请检查脚本版本及本机流水线日志；不会自动重新发布";
                }
                save(job);
                active = null;
            });
            res.status(202).json({ ok: true, data: job });
        } catch (error) { next(error); }
    });
}
