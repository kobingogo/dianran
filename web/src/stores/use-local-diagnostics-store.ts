import localforage from "localforage";
import { create } from "zustand";
import { STORAGE_NS } from "@/constant/brand";
import { assertBusinessWriter, writeOwnership } from "@/lib/write-ownership";

export type DiagnosticAction = "generation-success" | "generation-uncertain" | "reference-reuse" | "template-created" | "candidate-adopted" | "backup-exported" | "backup-restored" | "help-needed";
type DiagnosticEvent = { id: string; session: string; action: DiagnosticAction; at: string; durationMs?: number };
const storage = localforage.createInstance({ name: STORAGE_NS, storeName: "local_diagnostics" });
export const useLocalDiagnosticsStore = create<{ session: string; error: string }>(() => ({ session: "", error: "" }));
let writes: Promise<unknown> = Promise.resolve();
export function startLocalDiagnostics() { assertBusinessWriter(); useLocalDiagnosticsStore.setState({ session: crypto.randomUUID(), error: "" }); }
export function stopLocalDiagnostics() { useLocalDiagnosticsStore.setState({ session: "" }); }
export function recordLocalDiagnostic(action: DiagnosticAction, durationMs?: number) {
    const session = useLocalDiagnosticsStore.getState().session;
    if (!session || !writeOwnership.canWrite()) return Promise.resolve();
    const event: DiagnosticEvent = { id: crypto.randomUUID(), session, action, at: new Date().toISOString(), ...(Number.isFinite(durationMs) && durationMs! >= 0 ? { durationMs } : {}) };
    const write = writes.catch(() => {}).then(() => storage.setItem(event.id, event));
    writes = write;
    return write.then(() => {}, () => { useLocalDiagnosticsStore.setState({ error: "本地诊断记录未保存，不影响作品；可停止记录并导出已保存部分" }); });
}
export async function exportLocalDiagnostics() {
    await writes.catch(() => {});
    const events: DiagnosticEvent[] = [];
    await storage.iterate<DiagnosticEvent, void>((event) => { events.push(event); });
    return new Blob([JSON.stringify({ version: 1, scope: "local-opt-in-action-events", events: events.sort((a, b) => a.at.localeCompare(b.at)) }, null, 2)], { type: "application/json" });
}
export async function clearLocalDiagnostics() {
    assertBusinessWriter(); stopLocalDiagnostics(); await writes.catch(() => {}); await storage.clear();
}
