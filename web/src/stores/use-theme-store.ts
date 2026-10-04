import { create } from "zustand";
import { persist } from "zustand/middleware";
import { storageKey } from "@/constant/brand";

export type ThemeName = "light" | "dark";

type ThemeStore = {
    theme: ThemeName;
    setTheme: (theme: ThemeName) => void;
};

export const useThemeStore = create<ThemeStore>()(
    persist(
        (set) => ({
            theme: "dark",
            setTheme: (theme) => set({ theme }),
        }),
        { name: storageKey("theme_store") },
    ),
);
