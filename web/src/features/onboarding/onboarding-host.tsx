// [dianran] Decides when to show the first-run guide. Mounted once in the user layout.
import { lazy, Suspense, useEffect } from "react";

import { useConfigStore } from "@/stores/use-config-store";
import { PRESET_PROVIDERS } from "@/constant/brand";
import { hasUsableChannel, useOnboardingStore } from "./onboarding-store";

const OnboardingWizard = lazy(() => import("./onboarding-wizard").then((module) => ({ default: module.OnboardingWizard })));

function whenHydrated(callback: () => void) {
    const persist = useConfigStore.persist;
    if (persist.hasHydrated()) callback();
    else {
        const unsubscribe = persist.onFinishHydration(() => {
            unsubscribe();
            callback();
        });
    }
}

export function OnboardingHost() {
    const open = useOnboardingStore((state) => state.open);

    useEffect(() => {
        whenHydrated(() => {
            const params = new URLSearchParams(window.location.search);
            const providerId = params.get("provider");
            if (providerId && PRESET_PROVIDERS.some((item) => item.id === providerId)) {
                params.delete("provider");
                window.history.replaceState(null, "", `${window.location.pathname}${params.size ? `?${params}` : ""}${window.location.hash}`);
                useOnboardingStore.getState().show({ providerId, reason: "manual" });
                return;
            }
            // PLAN P1-5: no auto-popup on first visit any more — the home page shows an inline
            // setup card the first time the user presses 落笔生成 without a usable key.
        });
        // Generating without a usable key opens the config dialog with "continue after saving";
        // when nothing is configured yet, show the guide instead of the full settings panel.
        const unsubscribe = useConfigStore.subscribe((state, previous) => {
            if (!state.isConfigOpen || previous.isConfigOpen || !state.shouldPromptContinue) return;
            if (hasUsableChannel(state.config)) return;
            useConfigStore.setState({ isConfigOpen: false, shouldPromptContinue: false });
            useOnboardingStore.getState().show({ reason: "missing-key" });
        });
        return () => {
            unsubscribe();
        };
    }, []);

    return open ? (
        <Suspense fallback={null}>
            <OnboardingWizard />
        </Suspense>
    ) : null;
}
