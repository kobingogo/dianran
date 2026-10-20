// [dianran] Heavy shell widgets loaded on first use (Agent panel, settings dialog).
import { lazy, Suspense, useEffect, useState } from "react";

import { useAgentStore } from "@/stores/use-agent-store";
import { useConfigStore } from "@/stores/use-config-store";

const AgentPanelImpl = lazy(() => import("@/components/agent/agent-panel").then((module) => ({ default: module.AgentPanel })));
const AppConfigModalImpl = lazy(() => import("@/components/layout/app-config-modal").then((module) => ({ default: module.AppConfigModal })));

export function LazyAgentPanel() {
    const panelMounted = useAgentStore((state) => state.panelMounted);
    if (!panelMounted) return null;
    return (
        <Suspense fallback={null}>
            <AgentPanelImpl />
        </Suspense>
    );
}

export function LazyAppConfigModal() {
    const isConfigOpen = useConfigStore((state) => state.isConfigOpen);
    const [requested, setRequested] = useState(isConfigOpen);
    useEffect(() => {
        if (isConfigOpen) setRequested(true);
    }, [isConfigOpen]);
    if (!requested) return null;
    return (
        <Suspense fallback={null}>
            <AppConfigModalImpl />
        </Suspense>
    );
}
