import { installProxyTransport } from "@/services/api/proxy-transport";
import { reloadProxyPairing } from "@/stores/use-local-proxy-store";
import { reloadCapabilityEvidence } from "@/stores/use-capability-evidence-store";
import { useEffect, useState, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router-dom";
import { App, Button, ConfigProvider, Alert } from "antd";
import zhCN from "antd/es/locale/zh_CN";
import { AppProviders } from "@/components/layout/app-providers";
import { i18nReady } from "@/i18n";
import { initAnalytics } from "@/lib/analytics";
import { router } from "@/router";
import { installRequestTracker } from "@/features/tasks/request-tracker";
import { installPromptUsageFlush } from "@/services/usage-stats";
import { writeOwnership } from "@/lib/write-ownership";
import { registerMediaPage } from "@/services/media-references";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { useAssetStore } from "@/stores/use-asset-store";
import { useComposerStore, composerSaveError } from "@/stores/use-composer-store";
import { useConfigStore } from "@/stores/use-config-store";
import { usePluginStore } from "@/stores/canvas/use-plugin-store";
import { usePromptSourceStore } from "@/stores/use-prompt-source-store";
import { useWorkflowStore } from "@/stores/canvas/use-workflow-store";
import { useCanvasSaveStore } from "@/stores/canvas/use-canvas-save-store";
import { useAssetSaveStore } from "@/stores/use-asset-save-store";
import { useWorkbenchAgentStore } from "@/stores/use-workbench-agent-store";
import { useAgentStore } from "@/stores/use-agent-store";
import { reloadCreationTasks } from "@/features/tasks/task-store";
import { useThemeStore } from "@/stores/use-theme-store";
import { getAntThemeConfig } from "@/lib/app-theme";

const stores = [useCanvasStore, useAssetStore, useComposerStore, useConfigStore, usePluginStore, usePromptSourceStore];
async function reloadAuthoritativeData() {
    await reloadCreationTasks();
    reloadProxyPairing();
    await reloadCapabilityEvidence();
    for (const store of stores) {
        await store.persist.rehydrate();
        if (!store.persist.hasHydrated()) throw new Error("本地数据未读取成功，请保留原数据并重试读取");
    }
    await useWorkflowStore.getState().load();
    if (writeOwnership.getSnapshot() === "preparing") {
        const agent = useAgentStore.getState();
        const draft = useComposerStore.getState().agentDrafts[agent.url + ":" + agent.activeThreadId];
        useAgentStore.setState({ prompt: draft?.prompt || "", attachments: draft?.attachments || [], canvasReferences: draft?.canvasReferences || [], connected: false, canvasContext: null, messages: [], activeTurnId: "", conversation: { revision: 0, conversationId: "", threadId: "", status: "idle", mcpStatuses: {} } });
        useWorkbenchAgentStore.setState({ imageCommand: null, videoCommand: null });
        useWorkflowStore.setState({ proposal: undefined, panelOpen: false });
    }
    if (useCanvasSaveStore.getState().readFailed || useAssetSaveStore.getState().readFailed || composerSaveError()) throw new Error("本地数据未读取成功，请保留原数据并重试读取");
}
function CreationRoot() {
    const phase = useSyncExternalStore(writeOwnership.subscribe, writeOwnership.getSnapshot);
    const [error, setError] = useState("");
    const themeMode = useThemeStore((state) => state.theme);
    const load = () => {
        setError("");
        void registerMediaPage().then(() => writeOwnership.acquire(reloadAuthoritativeData)).catch((reason) => setError(String(reason)));
    };
    useEffect(load, []);
    return <ConfigProvider locale={zhCN} theme={getAntThemeConfig(themeMode === "dark")}><App className="flex h-dvh flex-col overflow-hidden">
        {error && <Alert className="shrink-0" type="error" showIcon title="本地数据读取失败" description={error} action={<Button type="text" onClick={load}>重试读取</Button>} />}
        <div className="min-h-0 flex-1 overflow-hidden">
            {phase === "writer" ? <AppProviders><RouterProvider router={router} /></AppProviders> : !error ? <div className="p-6">正在读取本地数据…</div> : null}
        </div>
    </App></ConfigProvider>;
}
installProxyTransport();
initAnalytics();
installRequestTracker();
installPromptUsageFlush();
document.body.style.fontFamily = "var(--font-sans)";
const root = import.meta.hot?.data.root || createRoot(document.getElementById("root")!);
if (import.meta.hot) import.meta.hot.data.root = root;
void i18nReady.then(() => root.render(<CreationRoot />));
