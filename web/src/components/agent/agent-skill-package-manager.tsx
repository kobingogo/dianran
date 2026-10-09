import { useEffect, useRef, useState } from "react";
import { App, Button, Input, Modal, Select } from "antd";
import { useAgentStore } from "@/stores/use-agent-store";
import { useAgentSkillStore } from "@/stores/use-agent-skill-store";
import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";
import { showErrorToast } from "@/features/errors/error-toast";
import { cancelSkillPackage, fetchCodexSkill, fetchSkillVersions, installSkillPackage, reviewSkillPackage, rollbackSkillPackage, updateSkillResource, type AgentSkillSummary, type AgentSkillDetail, type SkillPackageReview, type SkillVersion } from "@/services/api/canvas-agent";

export function AgentSkillPackageManager({ skill, onClose }: { skill: AgentSkillSummary | null; onClose: () => void }) {
    const { message, modal } = App.useApp();
    const theme = canvasThemes[useThemeStore(state => state.theme)];
    const endpoint = useAgentStore(state => state.url).trim().replace(/\/$/, "");
    const token = useAgentStore(state => state.token);
    const connected = useAgentStore(state => state.connected);
    const codexBusy = useAgentStore(state => state.sending || state.waiting);
    const connectionRevision = useAgentSkillStore(state => state.connectionRevision);
    const [url, setUrl] = useState("");
    const [ref, setRef] = useState("");
    const [candidates, setCandidates] = useState<string[]>([]);
    const [review, setReview] = useState<SkillPackageReview>();
    const [detail, setDetail] = useState<AgentSkillDetail>();
    const [versions, setVersions] = useState<SkillVersion[]>([]);
    const [filePath, setFilePath] = useState("SKILL.md");
    const [text, setText] = useState("");
    const [busy, setBusy] = useState(false);
    const [newPath, setNewPath] = useState("");
    const [error, setError] = useState("");
    const alive = useRef(true), reviewId = useRef("");
    const valid = () => {
        const agent = useAgentStore.getState();
        return alive.current && agent.connected && agent.url.trim().replace(/\/$/, "") === endpoint && agent.token === token && useAgentSkillStore.getState().connectionRevision === connectionRevision;
    };
    const loadDetail = async () => {
        if (!skill) return;
        const response = await fetchCodexSkill(endpoint, token, skill.name);
        if (!valid() || !response.data) return;
        setDetail(response.data);
        setUrl(response.data.resources?.origin?.url || "");
        setRef(response.data.resources?.origin?.ref || "");
        const history = await fetchSkillVersions(endpoint, token, skill.name);
        if (valid()) setVersions(history.data);
    };
    useEffect(() => {
        alive.current = true;
        if (skill) void loadDetail().catch(cause => { if (valid()) setError(cause instanceof Error ? cause.message : String(cause)); });
        return () => { alive.current = false; if (reviewId.current) void cancelSkillPackage(endpoint, token, reviewId.current).catch(() => {}); };
    }, [endpoint, token, connectionRevision, skill?.path]);
    useEffect(() => { if (!connected) onClose(); }, [connected, onClose]);
    const selected = (review?.files || detail?.resources?.files || []).find(file => file.path === filePath);
    useEffect(() => { setText(selected?.text || ""); }, [selected]);
    const run = async (action: () => Promise<void>) => {
        if (!valid() || busy) return;
        setBusy(true); setError("");
        try { await action(); } catch (cause) { if (valid()) { setError(cause instanceof Error ? cause.message : String(cause)); showErrorToast(message, cause); } }
        finally { if (valid()) setBusy(false); }
    };
    const preview = (skillPath?: string) => run(async () => {
        if (reviewId.current) { await cancelSkillPackage(endpoint, token, reviewId.current); reviewId.current = ""; }
        setReview(undefined); setCandidates([]);
        const response = await reviewSkillPackage(endpoint, token, { url, ref: ref || undefined, skillPath: skillPath ?? detail?.resources?.origin?.directory, expectedRevision: detail?.revision });
        if (!valid()) { if (response.review) await cancelSkillPackage(endpoint, token, response.review.id); return; }
        if (detail && response.review && response.review.name !== detail.name) { await cancelSkillPackage(endpoint, token, response.review.id); throw new Error("远端技能名称已变化，请作为新技能安装"); }
        setCandidates(response.candidates || []);
        setReview(response.review); reviewId.current = response.review?.id || "";
        setFilePath("SKILL.md");
        if (!response.review && !response.candidates?.length) throw new Error("没有发现 SKILL.md，请检查仓库或目录链接");
    });
    const install = () => run(async () => {
        if (!review) return;
        await installSkillPackage(endpoint, token, review);
        if (!valid()) return;
        reviewId.current = "";
        await useAgentSkillStore.getState().loadSkills(endpoint, token, true);
        if (!valid()) return;
        message.success(review.expectedRevision ? "技能完整目录已更新，旧版本已保留" : "技能完整目录已安装，请在技能列表选择使用");
        onClose();
    });
    const saveResource = (remove = false) => run(async () => {
        if (!detail || review) return;
        const response = await updateSkillResource(endpoint, token, detail.name, { path: filePath, text, remove, expectedRevision: detail.revision });
        if (!valid()) return;
        setDetail(response.data);
        await useAgentSkillStore.getState().loadSkills(endpoint, token, true);
        if (valid()) message.success(remove ? "资源已删除" : "资源已保存");
    });
    const addResource = (file?: File) => run(async () => {
        if (!detail || review || !newPath.trim()) return;
        const content = file ? await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(",")[1]); reader.onerror = () => reject(new Error("读取资源失败")); reader.readAsDataURL(file); }) : undefined;
        if (!valid()) return;
        const response = await updateSkillResource(endpoint, token, detail.name, { path: newPath.trim(), create: true, ...(file ? { content } : { text: "" }), expectedRevision: detail.revision });
        if (valid()) { setDetail(response.data); setFilePath(newPath.trim()); setNewPath(""); await useAgentSkillStore.getState().loadSkills(endpoint, token, true); }
    });
    const protectedFile = ["SKILL.md", "agents/openai.yaml", ".dianran-origin.json"].includes(filePath);
    const close = () => { if (busy) return; if (!review && selected?.text !== undefined && text !== selected.text) modal.confirm({ title: "放弃当前资源的未保存修改？", onOk: onClose }); else onClose(); };
    return <Modal title={skill ? `技能资源与版本 · ${skill.name}` : "从 GitHub 安装 Skill"} open onCancel={close} footer={null} width={850} styles={{ body: { maxHeight: "70vh", overflowY: "auto" } }}>
        <div className="flex flex-col gap-3" style={{ color: theme.node.text }}>
            <p className="text-xs" style={{ color: theme.node.muted }}>安装到当前本机 Agent 的点染工作空间。保留脚本、参考资料、素材和许可证；审阅不会运行脚本或安装依赖。</p>
            <Input aria-label="GitHub 技能链接" placeholder="https://github.com/作者/仓库/tree/分支/技能目录" value={url} disabled={busy} onChange={event => { setUrl(event.target.value); setReview(undefined); }} />
            <div className="flex gap-2"><Input aria-label="分支或提交" placeholder="分支或提交（可选；含 / 的分支请在此填写）" value={ref} disabled={busy} onChange={event => { setRef(event.target.value); setReview(undefined); }} /><Button loading={busy} disabled={!url.trim()} onClick={() => void preview()}>{detail ? "审阅远端更新" : "读取并审阅"}</Button></div>
            {candidates.length > 0 && <Select aria-label="选择仓库内技能" placeholder="选择仓库中的技能目录" options={candidates.map(value => ({ value, label: value || "仓库根目录" }))} onChange={value => void preview(value)} disabled={busy} />}
            {error && <p role="alert" className="text-sm" style={{ color: theme.node.text }}>{error}</p>}
            {skill && <Button type="text" disabled={busy} onClick={() => void run(async () => { if (reviewId.current) await cancelSkillPackage(endpoint, token, reviewId.current); reviewId.current = ""; setReview(undefined); await loadDetail(); })}>重新加载本地资源与版本</Button>}
            {(review || detail?.resources) && <>
                <p className="break-all text-xs">{review ? `${review.name} · ${review.description}` : detail?.description}</p>
                {(review?.origin || detail?.resources?.origin) && <p className="break-all text-xs" style={{ color: theme.node.muted }}>来源：{(review?.origin || detail?.resources?.origin)?.url} · 提交：{(review?.origin || detail?.resources?.origin)?.commit}</p>}
                {review && <><p className="break-all text-xs">完整目录摘要：{review.digest}</p><p className="text-xs">{review.expectedRevision ? "将替换同名技能完整目录并保留旧版本；请检查本地修改。" : "确认后安装此文件快照。"} 不会自动执行或增加文件访问权限。</p><div className="max-h-28 overflow-auto text-xs">{review.changes.map(change => <p key={change.path}>{change.kind} · {change.path}</p>)}</div></>}
                <p className="text-xs" style={{ color: theme.node.muted }}>声明的依赖（未自动安装）：</p><pre className="max-h-32 overflow-auto whitespace-pre-wrap break-all text-xs">{JSON.stringify(review?.requirements || detail?.resources?.requirements || {}, null, 2)}</pre>
                {detail?.resources?.readiness && <p className="text-xs">{detail.resources.readiness.missing.length ? `缺少：${detail.resources.readiness.missing.join("、")}` : detail.resources.readiness.note}</p>}
                <div className="grid gap-3 sm:grid-cols-[220px_1fr]">
                    <div className="max-h-72 overflow-auto">{(review?.files || detail?.resources?.files || []).map(file => <button className="block w-full truncate rounded px-2 py-1 text-left text-xs hover:bg-black/5 dark:hover:bg-white/10" style={{ color: file.path === filePath ? theme.node.text : theme.node.muted, background: file.path === filePath ? theme.toolbar.activeBg : undefined }} key={file.path} onClick={() => { if (!review && selected?.text !== undefined && text !== selected.text) modal.confirm({ title: "放弃当前资源的未保存修改？", onOk: () => setFilePath(file.path) }); else setFilePath(file.path); }}>{file.path} · {file.bytes} B</button>)}</div>
                    <div><p className="mb-2 break-all text-xs">{filePath}</p>{selected?.text !== undefined ? <Input.TextArea aria-label="技能资源正文" value={text} readOnly={Boolean(review) || protectedFile || busy} onChange={event => setText(event.target.value)} autoSize={{ minRows: 8, maxRows: 14 }} /> : <p className="text-xs">二进制资源按原文件保留。{selected?.sha256}</p>}
                        {!review && detail && !protectedFile && selected && <div className="mt-2 flex gap-2">{selected.text !== undefined && <Button type="text" disabled={busy} onClick={() => void saveResource()}>保存资源</Button>}<Button type="text" danger disabled={busy} onClick={() => modal.confirm({ title: `删除资源 ${filePath}？`, content: "可能影响技能执行；技能正文和其他资源保留。", onOk: () => saveResource(true) })}>删除资源</Button></div>}
                    </div>
                </div>
                {review && <Button type="primary" loading={busy} disabled={codexBusy} onClick={() => void install()}>{review.expectedRevision ? "确认更新此完整目录" : "确认安装此完整目录"}</Button>}
            </>}
            {!review && detail && <div className="flex flex-wrap items-center gap-2"><Input aria-label="新增资源路径" placeholder="references/brand.md 或 assets/logo.png" value={newPath} disabled={busy} onChange={event => setNewPath(event.target.value)} /><Button type="text" disabled={busy || !newPath.trim()} onClick={() => void addResource()}>新增空白文本</Button><label className="cursor-pointer text-xs">上传资源<input aria-label="上传技能资源" type="file" disabled={busy || !newPath.trim()} className="ml-2 max-w-48" onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void addResource(file); }} /></label></div>}
            {!review && versions.length > 0 && <><p className="text-sm">可回退版本</p>{versions.map(version => <div key={version.revision} className="flex items-center justify-between gap-2 text-xs"><span className="truncate">{version.origin?.commit || version.revision} · {version.files.length} 个文件</span><Button type="text" disabled={busy} onClick={() => modal.confirm({ title: "回退技能完整目录？", content: "当前版本会先保留。回退包含脚本、参考资料和素材，不运行文件。", onOk: () => run(async () => { if (!detail || !valid()) return; await rollbackSkillPackage(endpoint, token, detail.name, version.revision, detail.revision); if (valid()) { await loadDetail(); await useAgentSkillStore.getState().loadSkills(endpoint, token, true); } }) })}>回退</Button></div>)}</>}
        </div>
    </Modal>;
}
