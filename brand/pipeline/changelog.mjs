#!/usr/bin/env node
// [dianran] Build the Chinese changelog / PR body for a pipeline run from the candidate + merge + picks reports.
// Writes brand/pipeline/reports/<date>.md and <date>.json. Usage: node brand/pipeline/changelog.mjs [YYYY-MM-DD] [seconds]
import { resolve } from "node:path";
import { CANDIDATE_DIR, REPORT_DIR, libraries, readJson, today, writeJson } from "./lib/common.mjs";
import { writeFileSync, mkdirSync } from "node:fs";

const date = process.argv[2] || today();
const seconds = Number(process.argv[3] || 0);
const x = readJson(resolve(CANDIDATE_DIR, "x.json"), null);
const gh = readJson(resolve(CANDIDATE_DIR, "github.json"), null);
const civ = readJson(resolve(CANDIDATE_DIR, "civitai.json"), null);
const merge = readJson(resolve(CANDIDATE_DIR, "merge-report.json"), { added: [], retired: [], perLibrary: {} });
const picks = readJson(resolve(CANDIDATE_DIR, "picks-report.json"), { picks: [], added: [], dropped: [] });
const fin = readJson(resolve(CANDIDATE_DIR, "finalize.json"), {});
const usage = readJson(resolve(CANDIDATE_DIR, "../data/usage.json"), { status: "unavailable" });
const libName = Object.fromEntries([...libraries().map((l) => [l.id, l.name]), ["dianran-picks", "点染精选"]]);
const REASON = { "upstream-removed": "上游仓库已移除", "source-deleted": "原帖已删除", "cover-missing": "封面失效", "deprecated-model": "模型已弃用", "content-filter": "内容过滤（真人肖像/NSFW/换脸）", stale: "超过 6 个月且无站内使用", cap: "超出容量上限（按得分淘汰）" };
const md = [];
const esc = (s) => String(s || "").replace(/\|/g, "\\|").replace(/\n/g, " ");
const link = (t, url) => (url ? `[${esc(t)}](${url})` : esc(t));

md.push(`# 提示词库周更 ${date}`, "", "> 自动生成（brand/pipeline/run-weekly.sh）。只基于热度、新鲜度和站内使用数据，未做任何模型试跑。请人工审阅后再合并，流水线不会自动合并。", "");
md.push("## 概览", "");
md.push(`- 新增 **${merge.added.length}** 条，下架 **${merge.retired.length}** 条；点染精选 ${picks.picks.length} 条（新入选 ${picks.added.length}，移出 ${picks.dropped.length}）`);
md.push(`- 提示词快照：\`${fin.previousVersion || "?"}\` → \`${fin.version || "?"}\``);
md.push(`- 站内使用统计：${usage.status === "ok" ? `可读取（自 ${String(usage.since).slice(0, 10)} 起，本次合并 ${usage.lastRun?.events ?? 0} 次事件）` : `不可用（${usage.reason || usage.status}），得分仅用热度 + 新鲜度`}`);
if (merge.wouldRetireStale) md.push(`- 「6 个月无使用」规则：使用统计累计 ${merge.usageTrackingDays} 天，不足 28 天，暂不执行（按规则将下架 ${merge.wouldRetireStale} 条）`);
if (merge.note) md.push(`- 备注：${merge.note}`);
if (seconds) md.push(`- 运行耗时：${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`);
md.push("");
md.push("## 抓取结果", "");
if (x) md.push(`- **X**（twscrape，${x.since} 起）：原始 ${x.stats.raw} 条 / 去重 ${x.stats.unique} 条 → 候选 **${x.stats.candidates}** 条（无图/视频 ${x.stats.noMedia}，无提示词 ${x.stats.noPrompt}，无模型 ${x.stats.noModel}，重复 ${x.stats.duplicate}，过滤 ${Object.entries(x.stats.rejected).map(([k, v]) => `${k} ${v}`).join("、") || 0}）`);
if (gh) md.push(`- **GitHub 上游**：${Object.entries(gh.summary).map(([id, s]) => (s.error ? `${id} 失败（${s.error}）` : `${id} ${s.upstream}`)).join("，")}`);
if (civ) md.push(`- **Civitai**（本周最多反应，仅 SFW）：扫描 ${civ.stats.raw} 张 → 候选 **${civ.stats.candidates}** 条（无提示词 ${civ.stats.noPrompt}，非 SFW ${civ.stats.notSfw}，反应数不足 ${civ.stats.lowReactions}，过滤 ${Object.entries(civ.stats.rejected).map(([k, v]) => `${k} ${v}`).join("、") || 0}）`);
md.push("");
md.push("## 各库数量", "", "| 库 | 之前 | 新增 | 下架 | 之后 |", "| --- | ---: | ---: | ---: | ---: |");
for (const [id, p] of Object.entries(merge.perLibrary)) md.push(`| ${libName[id] || id} | ${p.before} | ${p.added} | ${p.retired} | ${p.after} |`);
md.push("");
md.push(`## 新增（${merge.added.length}）`, "");
for (const lib of Object.keys(merge.perLibrary)) {
    const rows = merge.added.filter((a) => a.library === lib);
    if (!rows.length) continue;
    md.push(`<details><summary>${libName[lib] || lib}：${rows.length} 条</summary>`, "");
    for (const a of rows) md.push(`- ${link(a.title, a.sourceUrl)}（${a.model || "—"}）`);
    md.push("", "</details>", "");
}
md.push(`## 下架（${merge.retired.length}）`, "");
const byReason = {};
for (const r of merge.retired) (byReason[r.reason] ||= []).push(r);
for (const [reason, rows] of Object.entries(byReason)) {
    md.push(`<details><summary>${REASON[reason] || reason}：${rows.length} 条</summary>`, "");
    for (const r of rows) md.push(`- [${libName[r.library] || r.library}] ${link(r.title, r.sourceUrl)}${r.detail ? ` — ${esc(r.detail)}` : ""}`);
    md.push("", "</details>", "");
}
if (!merge.retired.length) md.push("无", "");
md.push(`## 点染精选（${picks.picks.length} 条，每个模型最多 8 条，跌出前 45 名才移出）`, "", "| # | 标题 | 模型 | 来源库 | 得分 | 状态 |", "| ---: | --- | --- | --- | ---: | --- |");
picks.picks.forEach((p, i) => md.push(`| ${i + 1} | ${link(p.title, p.sourceUrl)} | ${p.model} | ${libName[p.library] || p.library} | ${p.score} | ${p.status === "new" ? "🆕 新入选" : p.status === "pinned" ? "📌 置顶" : "保留"} |`));
md.push("");
if (picks.dropped.length) {
    md.push("### 移出精选", "");
    for (const d of picks.dropped) md.push(`- ${esc(d.title)} — ${d.reason}`);
    md.push("");
}
md.push("---", "", "复核清单：自动生成的标题（titleAuto）可能需要润色；X / Civitai 新条目请抽查内容与授权；确认无误后再合并到 main。");
mkdirSync(REPORT_DIR, { recursive: true });
writeFileSync(resolve(REPORT_DIR, `${date}.md`), md.join("\n") + "\n");
writeJson(resolve(REPORT_DIR, `${date}.json`), { date, seconds, fetch: { x: x?.stats, github: gh?.summary, civitai: civ?.stats }, merge: { ...merge, added: merge.added.length, retiredByReason: Object.fromEntries(Object.entries(byReason).map(([k, v]) => [k, v.length])), retired: merge.retired.length }, picks, finalize: fin, usageStatus: usage.status });
console.log(resolve(REPORT_DIR, `${date}.md`));
