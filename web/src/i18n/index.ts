import i18n from "i18next";
import { initReactI18next } from "react-i18next";

import enUS from "@/i18n/locales/en-US";
import zhCN from "@/i18n/locales/zh-CN";
import { brandOverrides, mergeDeep } from "@/i18n/brand-overrides";
import { dianranStrings, mapStrings } from "@/i18n/dianran-strings";
import { storageKey } from "@/constant/brand";

export type AppLocale = "zh-CN" | "en-US";

const LOCALE_STORAGE_KEY = storageKey("locale");

i18n.use(initReactI18next).init({
    resources: {
        // [dianran] upstream -> brand overrides -> phase-2 copy; zh-CN unifies 资产 as 素材.
        "zh-CN": { translation: mergeDeep(mergeDeep(mapStrings(zhCN, (text) => text.replaceAll("资产", "素材")), brandOverrides["zh-CN"]), dianranStrings["zh-CN"]) },
        "en-US": { translation: mergeDeep(mergeDeep(enUS, brandOverrides["en-US"]), dianranStrings["en-US"]) },
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
