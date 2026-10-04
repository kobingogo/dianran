import type { ReactNode } from "react";

import { AppTopNav } from "@/components/layout/app-top-nav";
import { LazyAgentPanel } from "@/components/layout/lazy-shell";
import { OnboardingHost } from "@/features/onboarding/onboarding-host";
import { TaskCenter } from "@/features/tasks/task-center";

export default function UserLayout({ children }: { children: ReactNode }) {
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
