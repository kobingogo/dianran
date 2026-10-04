import type { ReactNode } from "react";

import { AppRail } from "@/components/layout/app-rail";
import { AppTopNav } from "@/components/layout/app-top-nav";
import { BottomTabBar } from "@/components/layout/bottom-tab-bar";
import { LazyAgentPanel } from "@/components/layout/lazy-shell";
import { OnboardingHost } from "@/features/onboarding/onboarding-host";
import { TaskCenter } from "@/features/tasks/task-center";

export default function UserLayout({ children }: { children: ReactNode }) {
    return (
        <div className="flex h-dvh overflow-hidden bg-background text-foreground">
            <AppRail />
            <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
                <AppTopNav />
                <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
                <BottomTabBar />
            </div>
            <LazyAgentPanel />
            <OnboardingHost />
            <TaskCenter />
        </div>
    );
}
