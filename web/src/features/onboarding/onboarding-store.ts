// [dianran] First-run guide state. Uses its own localStorage key; upstream storage keys are untouched.
import { create } from "zustand";

import type { AiConfig } from "@/stores/use-config-store";

const DISMISS_KEY = "dianran:onboarding";

export type OnboardingSeed = {
    providerId?: string;
    baseUrl?: string;
    apiKey?: string;
    reason?: "first-run" | "missing-key" | "import" | "manual";
};

type OnboardingStore = {
    open: boolean;
    seed: OnboardingSeed;
    show: (seed?: OnboardingSeed) => void;
    close: (remember?: boolean) => void;
};

export const useOnboardingStore = create<OnboardingStore>()((set) => ({
    open: false,
    seed: {},
    show: (seed = {}) => set({ open: true, seed }),
    close: (remember = true) => {
        if (remember) {
            try {
                localStorage.setItem(DISMISS_KEY, JSON.stringify({ dismissedAt: new Date().toISOString() }));
            } catch {
                // storage unavailable
            }
        }
        set({ open: false });
    },
}));

export function onboardingDismissed() {
    try {
        return Boolean(localStorage.getItem(DISMISS_KEY));
    } catch {
        return false;
    }
}

/** A channel the app can actually call: base URL + key + at least one model. */
export function hasUsableChannel(config: AiConfig) {
    return config.channels.some((channel) => channel.baseUrl.trim() && channel.apiKey.trim() && channel.models.length);
}
