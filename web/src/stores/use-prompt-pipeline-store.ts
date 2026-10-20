import { create } from "zustand";
import { collectAndPublishPrompts, type PromptPipelineJob } from "@/services/api/prompt-pipeline";

let current: Promise<PromptPipelineJob> | null = null;
export const usePromptPipelineStore = create<{
    running: boolean;
    job: PromptPipelineJob | null;
    error: string;
    collect: () => Promise<PromptPipelineJob>;
}>((set) => ({
    running: false, job: null, error: "",
    collect: () => {
        if (current) return current;
        set({ running: true, job: null, error: "" });
        current = collectAndPublishPrompts(job => set({ job }))
            .catch(error => { set({ error: error instanceof Error ? error.message : String(error) }); throw error; })
            .finally(() => { current = null; set({ running: false }); });
        return current;
    },
}));
