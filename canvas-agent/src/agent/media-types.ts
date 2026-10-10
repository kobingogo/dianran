/** Media protocol is independent of conversation/message storage versions. */
export const MEDIA_PROTOCOL_VERSION = 1;
export type MediaCapability = "text-to-image" | "image-edit" | "text-to-video" | "image-to-video";
export type MediaCapabilities = { agentId: string; tool: string; backend: string; billing: string; capabilities: Partial<Record<MediaCapability, "verified" | "unverified" | "unavailable">>; query: boolean; cancel: boolean; reason?: string };
export type MediaRequest = { requestId: string; projectId: string; revision: string; agentId: string; capability: MediaCapability; prompt: string; codexModel?: string; references?: Array<{ id: string; name: string; dataUrl: string }>; parameters?: Record<string, unknown>; allowUnverified?: boolean };
export type MediaArtifact = { id: string; itemId: string; kind: "image" | "video"; contentType: string; sha256: string; bytes: number };
export type MediaTask = { version: 1; id: string; request: MediaRequest; status: "pending" | "running" | "completed" | "failed" | "unknown"; native?: { threadId: string; turnId: string }; artifacts: MediaArtifact[]; error?: string; createdAt: number };
export interface MediaAdapter { capabilities(): Promise<MediaCapabilities>; submit(request: MediaRequest): Promise<MediaTask>; query?(taskId: string, projectId: string): Promise<MediaTask>; cancel?(taskId: string): Promise<void> }
