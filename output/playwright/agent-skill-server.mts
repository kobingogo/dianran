import http from "node:http";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { startHttpServer } from "../../canvas-agent/src/server/http.ts";
import { MCP_SERVER_NAME } from "../../canvas-agent/src/config.ts";
import { SkillStore } from "../../canvas-agent/src/skills/store.ts";

const directory = await fs.mkdtemp(path.join(os.tmpdir(), "dianran-skill-editor-"));
const service = startHttpServer({ config: { url: "http://127.0.0.1:4318", token: "external-fixture-token", origins: ["http://127.0.0.1:4317"], workspace: { workspacePath: directory, activeThreadId: "fixture-external" } }, persist: false, port: 4318, quiet: true });
service.session.beginConversation({ threadId: "fixture-external" });
service.session.completeConversationMcpInventory([{ name: MCP_SERVER_NAME, authStatus: "loggedIn" }]);
service.session.completeConversationPreparation("fixture-external");
service.session.setCodexState({ busy: false, threadId: "fixture-external", turnId: "" });
const control = http.createServer(async (req, res) => {
    const json = (status: number, data: unknown) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(data)); };
    try {
        if (req.url === "/health") return json(200, { isolated: true });
        if (req.url === "/skills") {
            const store = new SkillStore(directory);
            const names = await fs.readdir(store.skillsPath).catch(error => { if (error.code === "ENOENT") return []; throw error; });
            return json(200, { ok: true, data: await Promise.all(names.map(async name => ({ ...await store.get(name), enabled: true, scope: "repo" }))) });
        }
        json(404, { error: "Unknown fixture route" });
    } catch (error) { json(500, { error: error instanceof Error ? error.message : String(error) }); }
});
control.listen(4319, "127.0.0.1");
process.on("SIGTERM", () => { void (async () => {
    service.server.closeAllConnections(); control.closeAllConnections();
    await Promise.all([new Promise<void>(resolve => service.server.close(() => resolve())), new Promise<void>(resolve => control.close(() => resolve()))]);
    await fs.rm(directory, { recursive: true, force: true }); process.exit(0);
})(); });
