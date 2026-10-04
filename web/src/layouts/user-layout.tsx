import { useEffect, type ReactNode } from "react";
import { useLocation } from "react-router-dom";

import { AppTopNav } from "@/components/layout/app-top-nav";
import { LazyAgentPanel } from "@/components/layout/lazy-shell";
import { OnboardingHost } from "@/features/onboarding/onboarding-host";
import { TaskCenter } from "@/features/tasks/task-center";
import { rememberNonCanvasRoute } from "@/lib/canvas/last-non-canvas-route";

export default function UserLayout({ children }: { children: ReactNode }) {
    const { pathname, search } = useLocation();
    useEffect(() => {
        rememberNonCanvasRoute(pathname, search);
    }, [pathname, search]);

    return (
        <div className="flex h-dvh overflow-hidden bg-background text-foreground">
            <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
                <AppTopNav />
                <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
            </div>
            {/* [dianran] lazy Agent panel, first-run guide, task center */}
            <LazyAgentPanel />
            <OnboardingHost />
            <TaskCenter />
        </div>
    );
}
