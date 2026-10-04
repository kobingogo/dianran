import i18n from "i18next";
import { initReactI18next } from "react-i18next";

import enUS from "@/i18n/locales/en-US";
import zhCN from "@/i18n/locales/zh-CN";
import { brandOverrides, mergeDeep } from "@/i18n/brand-overrides";
import { storageKey } from "@/constant/brand";

export type AppLocale = "zh-CN" | "en-US";

const LOCALE_STORAGE_KEY = storageKey("locale");

i18n.use(initReactI18next).init({
    resources: {
        "zh-CN": { translation: mergeDeep(zhCN, brandOverrides["zh-CN"]) },
        "en-US": { translation: mergeDeep(enUS, brandOverrides["en-US"]) },
    },
    lng: (localStorage.getItem(LOCALE_STORAGE_KEY) as AppLocale) || "zh-CN",
    fallbackLng: "zh-CN",
    supportedLngs: ["zh-CN", "en-US"],
    initAsync: false,
    interpolation: { escapeValue: false },
    react: { useSuspense: false },
});

export function changeAppLocale(locale: AppLocale) {
    localStorage.setItem(LOCALE_STORAGE_KEY, locale);
    return i18n.changeLanguage(locale);
}

export default i18n;
