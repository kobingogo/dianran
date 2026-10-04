import { create } from "zustand";
import { persist } from "zustand/middleware";
import { storageKey } from "@/constant/brand";

export type ThemeName = "light" | "dark";

type ThemeStore = {
    theme: ThemeName;
    setTheme: (theme: ThemeName) => void;
};

const THEME_STORAGE_KEY = storageKey("theme_store");

/** Missing key → light. A stored "light" or "dark" is kept. Persist name stays infinite-canvas:theme_store. */
function readStoredTheme(): ThemeName {
    if (typeof localStorage === "undefined") return "light";
    try {
        const raw = localStorage.getItem(THEME_STORAGE_KEY);
        if (!raw) return "light";
        const parsed = JSON.parse(raw) as { state?: { theme?: unknown } };
        const theme = parsed.state?.theme;
        if (theme === "dark" || theme === "light") return theme;
        return "light";
    } catch {
        return "light";
    }
}

export const useThemeStore = create<ThemeStore>()(
    persist(
        (set) => ({
            theme: readStoredTheme(),
            setTheme: (theme) => set({ theme }),
        }),
        { name: THEME_STORAGE_KEY },
    ),
);
