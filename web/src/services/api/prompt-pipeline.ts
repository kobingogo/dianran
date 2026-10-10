import localforage from "localforage";
import { STORAGE_NS } from "@/constant/brand";
import { useAgentStore } from "@/stores/use-agent-store";
import { fetchAgentJson } from "./canvas-agent";
import i18n from "@/i18n";
import { verifyPublishedPromptSnapshot } from "./prompts";

export type PromptPipelineJob = { id: string; status: "running" | "published" | "unchanged" | "held" | "failed" | "unknown"; phase: string; snapshot?: string; added?: number; sources?: string };
const receipts = localforage.createInstance({ name: STORAGE_NS, storeName: "prompt_pipeline" });
type Receipt = { id: string; terminal: boolean };

/** Persist identity before submission: uncertain requests resume the same publication, never a new one. */
export async function collectAndPublishPrompts(onProgress: (job: PromptPipelineJob) => void) {
    const { url, token } = useAgentStore.getState();
    if (!url || !token) throw new Error(i18n.t("config.promptSources.pipelineConnect"));
    const previous = await receipts.getItem<Receipt>(url);
    const receipt = previous && !previous.terminal ? previous : { id: crypto.randomUUID(), terminal: false };
    await receipts.setItem(url, receipt);
    let { data: job } = await fetchAgentJson<{ data: PromptPipelineJob }>(url, token, "/agent/prompt-pipeline/jobs", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ requestId: receipt.id }),
    });
    onProgress(job);
    while (job.status === "running") {
        await new Promise(resolve => window.setTimeout(resolve, 1000));
        ({ data: job } = await fetchAgentJson<{ data: PromptPipelineJob }>(url, token, `/agent/prompt-pipeline/jobs/${receipt.id}`));
        onProgress(job);
    }
    if (job.status === "held" || job.status === "failed" || job.status === "unknown") {
        if (job.status !== "unknown") await receipts.setItem(url, { ...receipt, terminal: true });
        throw new Error(i18n.t(`config.promptSources.pipeline${job.status}`));
    }
    // The configured static host must actually serve this snapshot before reporting success.
    if (!job.snapshot || !await verifyPublishedPromptSnapshot(job.snapshot)) throw new Error(i18n.t("config.promptSources.pipelineSnapshotMismatch"));
    await receipts.setItem(url, { ...receipt, terminal: true });
    return job;
}
