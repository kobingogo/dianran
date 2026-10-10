import type { CanvasProject } from "@/stores/canvas/use-canvas-store";
import type { AppFileId } from "@/constant/brand";

export type CanvasExportFile = {
    app: AppFileId;
    version: 4;
    exportedAt: string;
    projects: CanvasProjectExportItem[];
    backup: { mode: "complete" | "rescue"; unavailableFiles: CanvasBackupIssue[]; externalLinks: CanvasBackupIssue[] };
};

export type CanvasBackupIssue = { projectId: string; reference: string; reason: string };

export type CanvasProjectExportItem = {
    project: CanvasProject;
    files: CanvasExportAsset[];
};

export type CanvasExportAsset = {
    storageKey: string;
    path: string;
    mimeType: string;
    bytes: number;
    sha256: string;
};
