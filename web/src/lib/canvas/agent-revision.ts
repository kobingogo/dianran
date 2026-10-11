import type { CanvasAgentSnapshot } from "./canvas-agent-ops";

/** A mount-specific revision prevents a project A → B → A from accepting old operations. */
export function createAgentRevision() {
    let signature = "", revision = "";
    return (snapshot: Omit<CanvasAgentSnapshot, "revision">): CanvasAgentSnapshot => {
        const current = JSON.stringify(snapshot);
        if (current !== signature) { signature = current; revision = crypto.randomUUID(); }
        return { ...snapshot, revision };
    };
}
