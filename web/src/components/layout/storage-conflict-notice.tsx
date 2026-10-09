import { useState, useSyncExternalStore } from "react";
import { saveAs } from "file-saver";
import { getStorageConflicts, subscribeStorageConflicts } from "@/lib/storage-conflicts";
import { preserveConflictCopies } from "@/lib/atomic-storage";
import { useThemeStore } from "@/stores/use-theme-store";
import { canvasThemes } from "@/lib/canvas-theme";

export function StorageConflictNotice() {
    const conflicts = useSyncExternalStore(subscribeStorageConflicts, getStorageConflicts);
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const [error, setError] = useState("");
    const [busy, setBusy] = useState(false);
    if (!conflicts.length) return null;
    const copyable = conflicts.filter((item) => item.key.endsWith(":canvas_store") || item.key.endsWith(":asset_store"));
    const download = () => saveAs(new Blob([JSON.stringify({ format: "dianran-storage-conflicts", conflicts }, null, 2)], { type: "application/json" }), "点染-本页冲突备份.json");
    const recover = async () => {
        if (!window.confirm("将保留本页冲突备份并刷新读取最新数据。活动任务只恢复或查询，不会重新生成。请先完成其他尚未保存的操作。")) return;
        setBusy(true);
        try {
            download();
            for (const conflict of copyable) await preserveConflictCopies(conflict);
            window.location.reload();
        } catch (reason) { setError(String(reason)); setBusy(false); }
    };
    return <div role="alert" className="fixed right-4 top-4 z-[1000] max-h-[50vh] w-96 max-w-[calc(100vw-2rem)] overflow-auto rounded-xl border p-4 text-sm" style={{ background: theme.node.fill, color: theme.node.text, borderColor: theme.node.border }}>
        <strong>其他页面已更新这份内容</strong>
        <p className="my-2">已阻止覆盖。最新数据和本页修改均已保留；页面仍可编辑，本批修改等待处理。</p>
        <details className="my-2 text-xs"><summary>查看冲突详情</summary>{conflicts.map((item) => <p key={item.id}>{item.message}</p>)}</details>
        <div className="flex flex-wrap gap-2">
            <button disabled={busy} className="rounded px-2 py-1 hover:bg-black/5 dark:hover:bg-white/10" onClick={download}>下载本页冲突备份</button>
            <button disabled={busy} className="rounded px-2 py-1 hover:bg-black/5 dark:hover:bg-white/10" onClick={() => void recover()}>{copyable.length ? "保留修改为副本并刷新" : "备份并读取最新"}</button>
        </div>
        <p className="mt-2 text-xs">{copyable.length ? "画布或素材另存为副本；删除冲突保留对方内容。" : "刷新采用已保存数据。"}其他冲突内容保留在下载的备份中。</p>
        {error && <p className="mt-2 text-xs">{error}</p>}
    </div>;
}
