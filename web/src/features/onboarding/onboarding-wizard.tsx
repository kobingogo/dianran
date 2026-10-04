// [dianran] 3-step first-run guide: pick provider -> paste key -> auto-fetch models & assign defaults.
import { useEffect, useMemo, useState } from "react";
import { App, Button, Input, Modal, Segmented, Select, Steps, Switch, Tag } from "antd";
import { ArrowLeft, ArrowRight, Check, Copy, ExternalLink, KeyRound, LoaderCircle, PencilRuler, ShieldCheck, Sparkles } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import copy from "copy-to-clipboard";

import { BRAND, LOCAL_PROXY_PACKAGE, PRESET_PROVIDERS, type PresetProvider } from "@/constant/brand";
import { FriendlyErrorView } from "@/features/errors/friendly-error-view";
import { toFriendlyError } from "@/lib/friendly-error";
import { fetchImageModels } from "@/services/api/image";
import { createModelChannel, DEFAULT_LOCAL_PROXY_URL, encodeChannelModel, modelOptionsFromChannels, useConfigStore, type AiConfig, type ApiCallFormat, type ModelCapability } from "@/stores/use-config-store";
import { buildChannelModels, type PickedDefaults } from "./model-defaults";
import { useOnboardingStore } from "./onboarding-store";

const CAPS: ModelCapability[] = ["image", "video", "text", "audio"];
const CAP_KEYS: Record<ModelCapability, "imageModel" | "videoModel" | "textModel" | "audioModel"> = { image: "imageModel", video: "videoModel", text: "textModel", audio: "audioModel" };

type FetchState = { status: "idle" | "loading" | "done" | "error"; error?: unknown; names: string[] };

function baseKey(url: string) {
    return url.trim().replace(/\/+$/, "").replace(/\/v1$/i, "").toLowerCase();
}

function regionTag(region: PresetProvider["region"], t: (key: string) => string) {
    if (region === "cn")
        return (
            <Tag color="green" className="m-0">
                {t("onboarding.region.cn")}
            </Tag>
        );
    if (region === "global") return <Tag className="m-0">{t("onboarding.region.global")}</Tag>;
    return (
        <Tag color="orange" className="m-0">
            {t("onboarding.region.any")}
        </Tag>
    );
}

export function OnboardingWizard() {
    const { t, i18n } = useTranslation();
    const { message } = App.useApp();
    const navigate = useNavigate();
    const open = useOnboardingStore((state) => state.open);
    const seed = useOnboardingStore((state) => state.seed);
    const close = useOnboardingStore((state) => state.close);
    const locale = i18n.resolvedLanguage === "en-US" ? "en-US" : "zh-CN";

    const [step, setStep] = useState(0);
    const [provider, setProvider] = useState<PresetProvider | null>(null);
    const [baseUrl, setBaseUrl] = useState("");
    const [apiKey, setApiKey] = useState("");
    const [apiFormat, setApiFormat] = useState<ApiCallFormat>("openai");
    const [fetchState, setFetchState] = useState<FetchState>({ status: "idle", names: [] });
    const [manualNames, setManualNames] = useState<string[]>([]);
    const [defaults, setDefaults] = useState<PickedDefaults>({});
    const [finished, setFinished] = useState(false);
    const proxyEnabled = useConfigStore((state) => state.config.proxyEnabled);
    const updateConfig = useConfigStore((state) => state.updateConfig);

    // Reset / seed whenever the guide opens.
    useEffect(() => {
        if (!open) return;
        const seeded = seed.providerId
            ? PRESET_PROVIDERS.find((item) => item.id === seed.providerId)
            : seed.baseUrl
              ? PRESET_PROVIDERS.find((item) => item.baseUrl && baseKey(item.baseUrl) === baseKey(seed.baseUrl || "")) || PRESET_PROVIDERS.find((item) => item.id === "relay")
              : undefined;
        setProvider(seeded || null);
        setBaseUrl(seed.baseUrl || seeded?.baseUrl || "");
        setApiFormat(seeded?.apiFormat || "openai");
        setApiKey(seed.apiKey || "");
        setFetchState({ status: "idle", names: [] });
        setManualNames([]);
        setDefaults({});
        setFinished(false);
        setStep(seeded ? (seed.apiKey ? 2 : 1) : 0);
    }, [open, seed]);

    const built = useMemo(() => buildChannelModels([...fetchState.names, ...manualNames], provider || undefined), [fetchState.names, manualNames, provider]);

    useEffect(() => {
        setDefaults(built.defaults);
    }, [built]);

    const runFetch = async () => {
        setFetchState({ status: "loading", names: [] });
        try {
            const names = await fetchImageModels({ baseUrl: baseUrl.trim(), apiKey: apiKey.trim(), apiFormat });
            setFetchState({ status: names.length ? "done" : "error", names, error: names.length ? undefined : new Error(t("onboarding.fetch.empty")) });
        } catch (error) {
            setFetchState({ status: "error", names: [], error });
        }
    };

    // Auto-fetch when entering step 3.
    useEffect(() => {
        if (open && step === 2 && fetchState.status === "idle" && baseUrl.trim() && apiKey.trim()) void runFetch();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, step]);

    const pickProvider = (item: PresetProvider) => {
        setProvider(item);
        setBaseUrl(item.baseUrl);
        setApiFormat(item.apiFormat);
        setFetchState({ status: "idle", names: [] });
        setStep(1);
    };

    const baseUrlValid = /^https?:\/\/[^\s/]+/i.test(baseUrl.trim());
    const canContinueKey = baseUrlValid && apiKey.trim().length >= 6;

    const save = () => {
        const state = useConfigStore.getState();
        const config = state.config;
        const name = provider ? (provider.id === "relay" ? safeHost(baseUrl) : provider.name[locale]) : safeHost(baseUrl);
        const existingIndex = config.channels.findIndex((channel) => baseKey(channel.baseUrl) === baseKey(baseUrl));
        const replaceEmpty = existingIndex < 0 && config.channels.length === 1 && !config.channels[0].apiKey.trim();
        const base = existingIndex >= 0 ? config.channels[existingIndex] : undefined;
        const channel = createModelChannel({ ...(base || {}), name: base?.name || name, baseUrl: baseUrl.trim().replace(/\/+$/, ""), apiKey: apiKey.trim(), apiFormat, models: built.models });
        const channels = existingIndex >= 0 ? config.channels.map((item, index) => (index === existingIndex ? channel : item)) : replaceEmpty ? [channel] : [...config.channels, channel];
        const next: Partial<AiConfig> = { channels, models: modelOptionsFromChannels(channels), baseUrl: channels[0].baseUrl, apiKey: channels[0].apiKey, apiFormat: channels[0].apiFormat };
        for (const cap of CAPS) {
            const picked = defaults[cap];
            if (picked) next[CAP_KEYS[cap]] = encodeChannelModel(channel.id, picked);
            else if (replaceEmpty) next[CAP_KEYS[cap]] = "";
        }
        if (next.imageModel) next.model = next.imageModel;
        (Object.keys(next) as Array<keyof AiConfig>).forEach((key) => state.updateConfig(key, next[key] as never));
        setFinished(true);
        message.success(t("onboarding.saved", { name: channel.name }));
    };

    const finish = (path?: string) => {
        close(true);
        if (path) navigate(path);
    };

    const proxyCommand = `npx ${LOCAL_PROXY_PACKAGE}@latest`;
    const fetchKind = fetchState.status === "error" ? toFriendlyError(fetchState.error).kind : undefined;

    const stepProvider = (
        <div>
            <p className="mb-4 text-sm text-stone-500 dark:text-stone-400">{t("onboarding.provider.description")}</p>
            <div className="grid gap-3 sm:grid-cols-2" data-onboarding-providers>
                {PRESET_PROVIDERS.map((item) => (
                    <button
                        key={item.id}
                        type="button"
                        onClick={() => pickProvider(item)}
                        className={`group flex flex-col gap-1.5 rounded-xl border p-3.5 text-left transition hover:border-[var(--brand,#E8572A)] hover:shadow-sm ${provider?.id === item.id ? "border-[var(--brand,#E8572A)] bg-[var(--brand-soft,rgba(232,87,42,.08))]" : "border-stone-200 dark:border-stone-800"}`}
                    >
                        <div className="flex items-center justify-between gap-2">
                            <span className="text-sm font-semibold text-stone-900 dark:text-stone-100">{item.name[locale]}</span>
                            {regionTag(item.region, t)}
                        </div>
                        <span className="text-xs leading-5 text-stone-500 dark:text-stone-400">{item.note[locale]}</span>
                        <span className="truncate font-mono text-[11px] text-stone-400">{item.baseUrl || t("onboarding.provider.customUrl")}</span>
                    </button>
                ))}
            </div>
            <div className="mt-4 flex items-center gap-1.5 text-xs text-stone-400">
                <ShieldCheck className="size-3.5" />
                {t("onboarding.privacy", { name: BRAND.nameZh })}
            </div>
        </div>
    );

    const stepKey = (
        <div className="space-y-4">
            <div className="flex items-center gap-2 text-sm">
                <span className="font-semibold">{provider?.name[locale] || t("onboarding.provider.custom")}</span>
                {provider ? regionTag(provider.region, t) : null}
                <button type="button" className="ml-auto text-xs text-stone-400 hover:text-stone-700 dark:hover:text-stone-200" onClick={() => setStep(0)}>
                    {t("onboarding.key.change")}
                </button>
            </div>
            <label className="block">
                <div className="mb-1.5 text-xs font-medium text-stone-600 dark:text-stone-300">{t("onboarding.key.baseUrl")}</div>
                <Input
                    value={baseUrl}
                    placeholder="https://api.example.com/v1"
                    onChange={(event) => setBaseUrl(event.target.value)}
                    status={baseUrl && !baseUrlValid ? "error" : undefined}
                    disabled={Boolean(provider && !provider.customizable && provider.baseUrl)}
                />
                {provider?.customizable ? <div className="mt-1 text-[11px] text-stone-400">{t("onboarding.key.baseUrlHint")}</div> : null}
            </label>
            {provider?.customizable ? (
                <div>
                    <div className="mb-1.5 text-xs font-medium text-stone-600 dark:text-stone-300">{t("onboarding.key.protocol")}</div>
                    <Segmented
                        value={apiFormat}
                        onChange={(value) => setApiFormat(value as ApiCallFormat)}
                        options={[
                            { label: t("onboarding.key.openai"), value: "openai" },
                            { label: "Gemini", value: "gemini" },
                        ]}
                    />
                </div>
            ) : null}
            <label className="block">
                <div className="mb-1.5 flex items-center justify-between text-xs font-medium text-stone-600 dark:text-stone-300">
                    <span>API Key</span>
                    {provider?.keyUrl ? (
                        <a href={provider.keyUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[var(--brand,#E8572A)] hover:underline">
                            {t("onboarding.key.getKey")}
                            <ExternalLink className="size-3" />
                        </a>
                    ) : null}
                </div>
                <Input.Password autoFocus prefix={<KeyRound className="size-3.5 text-stone-400" />} value={apiKey} placeholder="sk-..." onChange={(event) => setApiKey(event.target.value)} onPressEnter={() => canContinueKey && setStep(2)} />
            </label>
            <div className="flex items-start gap-1.5 rounded-lg bg-stone-50 px-3 py-2 text-[11px] leading-5 text-stone-500 dark:bg-stone-900 dark:text-stone-400">
                <ShieldCheck className="mt-0.5 size-3.5 shrink-0" />
                {t("onboarding.privacy", { name: BRAND.nameZh })}
            </div>
        </div>
    );

    const stepModels = (
        <div className="space-y-4">
            {fetchState.status === "loading" ? (
                <div className="flex flex-col items-center gap-3 py-10 text-sm text-stone-500">
                    <LoaderCircle className="size-7 animate-spin text-[var(--brand,#E8572A)]" />
                    {t("onboarding.fetch.loading", { host: safeHost(baseUrl) })}
                </div>
            ) : null}
            {fetchState.status === "error" ? (
                <div className="rounded-xl border border-red-200 bg-red-50/60 p-4 dark:border-red-950 dark:bg-red-950/20" data-onboarding-error={fetchKind}>
                    <div className="flex justify-center">
                        <FriendlyErrorView error={fetchState.error} onRetry={() => void runFetch()} />
                    </div>
                    {fetchKind === "network" ? (
                        <div className="mt-4 space-y-2 border-t border-red-200/70 pt-3 text-xs text-stone-600 dark:border-red-900/50 dark:text-stone-300">
                            <div>{t("onboarding.fetch.proxyIntro")}</div>
                            <div className="flex items-center gap-2 rounded-md bg-white px-2 py-1.5 font-mono text-[11px] dark:bg-stone-900">
                                <span className="min-w-0 flex-1 truncate">{proxyCommand}</span>
                                <button type="button" className="text-stone-400 hover:text-stone-700" onClick={() => (copy(proxyCommand), message.success(t("onboarding.copied")))} aria-label="copy">
                                    <Copy className="size-3.5" />
                                </button>
                            </div>
                            <div className="flex items-center gap-2">
                                <Switch
                                    size="small"
                                    checked={proxyEnabled}
                                    onChange={(checked) => {
                                        updateConfig("proxyEnabled", checked);
                                        if (checked && !useConfigStore.getState().config.proxyUrl) updateConfig("proxyUrl", DEFAULT_LOCAL_PROXY_URL);
                                    }}
                                />
                                <span>{t("onboarding.fetch.proxySwitch", { url: DEFAULT_LOCAL_PROXY_URL })}</span>
                            </div>
                        </div>
                    ) : null}
                    <div className="mt-4 border-t border-red-200/70 pt-3 dark:border-red-900/50">
                        <div className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-stone-600 dark:text-stone-300">
                            <PencilRuler className="size-3.5" />
                            {t("onboarding.fetch.manual")}
                        </div>
                        <Select
                            mode="tags"
                            className="w-full"
                            value={manualNames}
                            onChange={setManualNames}
                            placeholder={t("onboarding.fetch.manualPlaceholder")}
                            tokenSeparators={[",", " "]}
                            options={Object.values(provider?.recommended || {})
                                .flat()
                                .map((name) => ({ value: name, label: name }))}
                        />
                    </div>
                </div>
            ) : null}
            {fetchState.status === "done" || manualNames.length ? (
                <div data-onboarding-models>
                    <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
                        <Check className="size-4 text-emerald-500" />
                        <span>{t("onboarding.fetch.found", { total: built.total || manualNames.length, kept: built.models.length })}</span>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                        {CAPS.map((cap) => {
                            const options = built.models.filter((model) => model.capability === cap).map((model) => ({ value: model.name, label: model.name }));
                            return (
                                <label key={cap} className="block">
                                    <div className="mb-1 flex items-center justify-between text-xs text-stone-600 dark:text-stone-300">
                                        <span className="font-medium">{t(`onboarding.caps.${cap}`)}</span>
                                        <span className="text-stone-400">{t("onboarding.fetch.count", { count: built.counts[cap] })}</span>
                                    </div>
                                    <Select
                                        className="w-full"
                                        showSearch
                                        allowClear
                                        value={defaults[cap]}
                                        placeholder={t("onboarding.fetch.none")}
                                        options={options}
                                        disabled={!options.length}
                                        onChange={(value) => setDefaults((current) => ({ ...current, [cap]: value }))}
                                    />
                                </label>
                            );
                        })}
                    </div>
                    <div className="mt-3 text-[11px] leading-5 text-stone-400">{t("onboarding.fetch.adjustLater")}</div>
                </div>
            ) : null}
        </div>
    );

    const done = (
        <div className="flex flex-col items-center gap-3 py-6 text-center" data-onboarding-done>
            <div className="grid size-12 place-items-center rounded-full bg-[var(--brand-soft,rgba(232,87,42,.1))] text-[var(--brand,#E8572A)]">
                <Sparkles className="size-6" />
            </div>
            <div className="text-lg font-semibold">{t("onboarding.done.title")}</div>
            <div className="max-w-sm text-sm text-stone-500 dark:text-stone-400">{t("onboarding.done.description")}</div>
            <div className="mt-2 flex flex-wrap justify-center gap-2">
                <Button type="primary" size="large" onClick={() => finish("/canvas?mode=new")} icon={<ArrowRight className="size-4" />} iconPlacement="end">
                    {t("onboarding.done.canvas")}
                </Button>
                <Button size="large" onClick={() => finish("/image")}>
                    {t("onboarding.done.image")}
                </Button>
            </div>
        </div>
    );

    const footer = finished ? null : (
        <div className="flex items-center justify-between gap-2">
            <Button type="text" onClick={() => close(true)}>
                {t("onboarding.skip")}
            </Button>
            <div className="flex gap-2">
                {step > 0 ? (
                    <Button icon={<ArrowLeft className="size-4" />} onClick={() => setStep(step - 1)}>
                        {t("onboarding.back")}
                    </Button>
                ) : null}
                {step === 1 ? (
                    <Button
                        type="primary"
                        disabled={!canContinueKey}
                        onClick={() => {
                            setFetchState({ status: "idle", names: [] });
                            setStep(2);
                        }}
                        icon={<ArrowRight className="size-4" />}
                        iconPlacement="end"
                    >
                        {t("onboarding.next")}
                    </Button>
                ) : null}
                {step === 2 ? (
                    <Button type="primary" disabled={!built.models.length} onClick={save} icon={<Check className="size-4" />}>
                        {t("onboarding.finish")}
                    </Button>
                ) : null}
            </div>
        </div>
    );

    return (
        <Modal
            open={open}
            onCancel={() => close(true)}
            width={720}
            centered
            footer={footer}
            destroyOnHidden
            title={
                <div>
                    <div className="text-lg font-semibold">{t(seed.reason === "missing-key" ? "onboarding.titleMissing" : "onboarding.title", { name: BRAND.nameZh })}</div>
                    <div className="mt-0.5 text-xs font-normal text-stone-500">{t("onboarding.subtitle")}</div>
                </div>
            }
        >
            <div data-onboarding-step={finished ? "done" : step}>
                {!finished ? <Steps size="small" current={step} className="!mb-5 !mt-2" items={[{ title: t("onboarding.steps.provider") }, { title: t("onboarding.steps.key") }, { title: t("onboarding.steps.models") }]} /> : null}
                {finished ? done : step === 0 ? stepProvider : step === 1 ? stepKey : stepModels}
            </div>
        </Modal>
    );
}

function safeHost(url: string) {
    try {
        return new URL(url.trim()).hostname.replace(/^(?:www|api)\./i, "");
    } catch {
        return url;
    }
}
