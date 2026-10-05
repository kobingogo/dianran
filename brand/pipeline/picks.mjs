#!/usr/bin/env node
// [dianran] Rebuild 「点染精选」 from the top scores across all libraries (popularity + freshness + on-site usage only,
// no model test runs). Cap 30, at most 8 per model, every pick has a cover. Hysteresis: a current pick stays as long
// as it is still within the top 45; new picks are added from the top of the ranking. Pick records are copies of the
// original entry with id "dianran-picks:<original id>" and pickOf = original id (the app hides the duplicate original
// in the combined view). Usage: node brand/pipeline/picks.mjs
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { CANDIDATE_DIR, DATA_DIR, config, libPath, libraries, log, modelLabel, nowIso, readJson, scoreEntry, toIso, writeJson } from "./lib/common.mjs";
import { coverFileOf } from "./lib/covers.mjs";

const cfg = config("pipeline.json");
const P = cfg.picks;
const runAt = nowIso();
const scores = readJson(resolve(DATA_DIR, "scores.json"), { scores: {} }).scores;
const usage = readJson(resolve(DATA_DIR, "usage.json"), { totals: {}, days: {} });
const promptKey = (p) => String(p || "").toLowerCase().replace(/[\W_]+/gu, "").slice(0, 160);
const hasCover = (item) => Boolean(item?.coverUrl) && (!coverFileOf(item.coverUrl) || existsSync(coverFileOf(item.coverUrl)));

// All entries by id.
const entries = new Map();
for (const lib of libraries()) for (const item of readJson(libPath(lib.id), [])) entries.set(item.id, { item, library: lib.id });

// Previous picks; own (non-copied) picks are scored as their own candidates.
const previous = readJson(libPath("dianran-picks"), []);
const prevIds = [];
for (const pick of previous) {
    if (pick.pickOf) { prevIds.push(pick.pickOf); continue; }
    pick.source ||= "dianran";
    pick.postedAt ||= toIso(pick.createdAt);
    pick.fetchedAt ||= runAt;
    pick.engagement ||= { likes: null, bookmarks: null, reposts: null };
    if (pick.authorFollowers === undefined) pick.authorFollowers = null;
    pick.model ||= modelLabel(pick.imageModel, "dianran-picks");
    pick.status = "active";
    pick.sourceId = "dianran-picks";
    const u = usage.totals?.[pick.id] || {};
    scores[pick.id] = { ...scoreEntry(pick, "dianran-picks", { copy: u.copy || 0, use: u.use || 0 }, cfg), library: "dianran-picks", model: pick.model, hasCover: hasCover(pick) };
    entries.set(pick.id, { item: pick, library: "dianran-picks" });
    prevIds.push(pick.id);
}

const ranked = Object.entries(scores)
    .filter(([id, s]) => s.hasCover && entries.has(id) && hasCover(entries.get(id).item))
    .sort((a, b) => b[1].total - a[1].total)
    .map(([id]) => id);
const rank = new Map(ranked.map((id, i) => [id, i + 1]));
const modelOf = (id) => entries.get(id).item.model || "通用";

const selected = [];
const perModel = {};
const keys = new Set();
const why = {};
function trySelect(id, reason) {
    if (selected.includes(id) || selected.length >= P.cap) return false;
    const e = entries.get(id);
    if (!e || !hasCover(e.item)) return false;
    const m = modelOf(id);
    if ((perModel[m] || 0) >= P.perModel) return false;
    const k = promptKey(e.item.prompt);
    if (keys.has(k)) return false;
    keys.add(k);
    perModel[m] = (perModel[m] || 0) + 1;
    selected.push(id);
    why[id] = reason;
    return true;
}

for (const id of P.pinned || []) trySelect(id, "pinned");
const dropped = [];
for (const id of [...prevIds].sort((a, b) => (rank.get(a) || 1e9) - (rank.get(b) || 1e9))) {
    const r = rank.get(id);
    if (!entries.has(id)) { dropped.push({ id, reason: "原条目已下架" }); continue; }
    if (!r || r > P.keepWithinRank) { dropped.push({ id, reason: `排名跌出前 ${P.keepWithinRank}（当前第 ${r || "—"} 名）` }); continue; }
    if (!trySelect(id, "kept")) dropped.push({ id, reason: `同模型（${modelOf(id)}）已满 ${P.perModel} 条或与其他精选重复` });
}
const prevSet = new Set(prevIds);
for (const id of ranked) {
    if (selected.length >= P.cap) break;
    trySelect(id, prevSet.has(id) ? "kept" : "new");
}
// A previous pick that falls outside the top 45 can still be re-selected while filling (e.g. when model caps push the
// fill deeper than rank 45); it then simply stays a pick.
for (let i = dropped.length - 1; i >= 0; i--) if (selected.includes(dropped[i].id)) dropped.splice(i, 1);

// Records: own picks stay as they are; others become copies that point back to the original.
const prevPickedAt = new Map(previous.map((p) => [p.pickOf || p.id, p.pickedAt]));
const out = selected
    .sort((a, b) => scores[b].total - scores[a].total)
    .map((id) => {
        const { item, library } = entries.get(id);
        const pickedAt = prevPickedAt.get(id) || runAt;
        if (library === "dianran-picks") return { ...item, pickedAt, pickScore: scores[id].total };
        return { ...item, id: `dianran-picks:${id}`, sourceId: "dianran-picks", pickOf: id, pickLibrary: library, pickedAt, pickScore: scores[id].total };
    });

// Own picks that dropped out are archived (restorable via config picks.pinned + this archive).
const archive = readJson(resolve(DATA_DIR, "picks-archive.json"), {});
for (const d of dropped) {
    const e = entries.get(d.id);
    if (e?.library === "dianran-picks") archive[d.id] = { ...e.item, archivedAt: runAt, archivedReason: d.reason };
}
writeJson(resolve(DATA_DIR, "picks-archive.json"), archive);
writeJson(libPath("dianran-picks"), out, false);

const titleOf = (id) => entries.get(id)?.item.title || previous.find((p) => (p.pickOf || p.id) === id)?.title || id;
const result = {
    runAt,
    picks: out.map((p) => ({ id: p.pickOf || p.id, title: p.title, model: p.model || "通用", library: p.pickLibrary || "dianran-picks", score: p.pickScore, rank: rank.get(p.pickOf || p.id), status: why[p.pickOf || p.id], author: p.author || "", sourceUrl: p.sourceUrl || "" })),
    added: out.filter((p) => why[p.pickOf || p.id] === "new").map((p) => p.pickOf || p.id),
    dropped: dropped.map((d) => ({ ...d, title: titleOf(d.id) })),
    perModel,
};
writeJson(resolve(CANDIDATE_DIR, "picks-report.json"), result);
log(`picks: ${out.length} (new ${result.added.length}, kept ${out.length - result.added.length}, dropped ${dropped.length})`, JSON.stringify(perModel));
