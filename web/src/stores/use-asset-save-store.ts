import { create } from "zustand";
import type { SaveStatus } from "@/lib/canvas/save-queue";

export const useAssetSaveStore = create<{ status: SaveStatus; error: string; readFailed: boolean }>(() => ({ status: "loading", error: "", readFailed: false }));
