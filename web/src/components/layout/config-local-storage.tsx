import { Alert, Button, Progress, Spin } from "antd";
import type { TFunction } from "i18next";
import { Database, HardDrive, Layers3, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { readLocalStorageUsage, type LocalStorageUsage } from "@/services/local-storage-usage";
import { readStoragePersistence, requestStoragePersistence, type StoragePersistence } from "@/services/storage-persistence";
import { useLocalDiagnosticsStore, startLocalDiagnostics, stopLocalDiagnostics, recordLocalDiagnostic, exportLocalDiagnostics, clearLocalDiagnostics } from "@/stores/use-local-diagnostics-store";
import { saveAs } from "file-saver";

const storeLabelKeys: Record<string, string> = {
    app_state: "appState",
    image_files: "images",
    image_previews: "imagePreviews",
    media_files: "media",
    image_generation_logs: "imageLogs",
    video_generation_logs: "videoLogs",
    agent_chat_messages: "agentMessages",
    prompt_cache: "promptCache",
};

export function ConfigLocalStorage({ active }: { active: boolean }) {
    const { t } = useTranslation();
    const [usage, setUsage] = useState<LocalStorageUsage | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const [persistence, setPersistence] = useState<StoragePersistence>();
    const [requesting, setRequesting] = useState(false);
    const diagnostics = useLocalDiagnosticsStore();

    const refresh = useCallback(async () => {
        setLoading(true);
        setError("");
        try {
            const [nextUsage, nextPersistence] = await Promise.all([readLocalStorageUsage(), readStoragePersistence()]);
            setUsage(nextUsage);
            setPersistence(nextPersistence);
        } catch (reason) {
            setError(reason instanceof Error ? reason.message : t("config.localStorage.readFailed"));
        } finally {
            setLoading(false);
        }
    }, [t]);

    useEffect(() => {
        if (active && !usage) void refresh();
    }, [active, refresh, usage]);

    const indexedDbBytes = usage?.contentBytes ?? 0;
    const percent = usage?.quota ? Math.min(100, (usage.usage / usage.quota) * 100) : 0;

    return (
        <div className="space-y-3">
            <Alert type="info" showIcon title="本机保存与备份是两件事" description={<>
                <p>画布、素材和生成记录主要保存在当前浏览器的当前站点。更换设备、浏览器、域名或端口不会自动带走作品；请先导出项目 ZIP 和素材备份，或使用 WebDAV。项目 ZIP 不包含全部站点配置与记录，完整性以导出清单为准。</p>
                <p>API Key 保存在浏览器，生成时发往所选渠道；启用代理后经本机代理转发。Agent 按批准的工具读取内容，WebDAV 按同步范围上传作品，均不等于内置云账户。</p>
                <p>浏览器存储：{persistence === "persistent" ? "已获持久化许可" : persistence === "temporary" ? "未获持久化许可" : persistence === "unsupported" ? "不支持持久化许可查询" : "尚未读取"}。持久化可降低浏览器自动回收风险，不能代替备份，也无法防止手动清除。</p>
                <Button type="text" disabled={persistence === "persistent" || persistence === "unsupported"} loading={requesting} onClick={async () => {
                    setRequesting(true);
                    try { setPersistence(await requestStoragePersistence()); }
                    catch (reason) { setError(reason instanceof Error ? reason.message : "申请持久化失败，请继续使用导出备份"); }
                    finally { setRequesting(false); }
                }}>申请浏览器持久化</Button>
            </>} />
            <Alert type="info" title="自愿本地诊断" description={<>
                <p>默认关闭。开始后只在本页面会话记录操作类别、时间和耗时，不记录提示词、素材、Key、渠道或项目身份，也不上传。停止或刷新后不再记录；历史记录由你主动导出或删除。人工观察与真实用户反馈仍需另行取得同意。</p>
                <div className="my-2 flex flex-wrap gap-2">
                    <Button type="text" onClick={() => { try { diagnostics.session ? stopLocalDiagnostics() : startLocalDiagnostics(); } catch (reason) { setError(String(reason)); } }}>{diagnostics.session ? "停止记录" : "开始本地记录"}</Button>
                    <Button type="text" disabled={!diagnostics.session} onClick={() => void recordLocalDiagnostic("help-needed")}>记录一次需要帮助</Button>
                    <Button type="text" onClick={async () => { try { saveAs(await exportLocalDiagnostics(), "dianran-local-diagnostics.json"); } catch (reason) { setError(String(reason)); } }}>导出诊断</Button>
                    <Button type="text" onClick={async () => { try { await clearLocalDiagnostics(); } catch (reason) { setError(String(reason)); } }}>删除诊断记录</Button>
                </div>
                {diagnostics.error && <p>{diagnostics.error}</p>}
            </>} />
            <section className="rounded-lg border border-stone-200 p-4 dark:border-stone-800">
                <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                        <div className="flex items-center gap-2 text-sm font-semibold">
                            <Database className="size-4" />
                            {t("config.localStorage.title")}
                        </div>
                        <div className="mt-1 text-xs text-stone-500">{t("config.localStorage.description")}</div>
                    </div>
                    <Button icon={<RefreshCw className="size-4" />} loading={loading} onClick={() => void refresh()}>
                        {t("config.localStorage.refresh")}
                    </Button>
                </div>
                {error ? <Alert className="mt-4" type="error" showIcon message={t("config.localStorage.readFailed")} description={error} /> : null}
                {!usage && loading ? (
                    <div className="flex min-h-48 items-center justify-center"><Spin /></div>
                ) : usage ? (
                    <>
                        <div className="mt-4 grid gap-3 sm:grid-cols-3">
                            <StorageMetric icon={<Database className="size-4" />} label={t("config.localStorage.indexedDbUsage")} value={formatStorageBytes(indexedDbBytes)} hint={t("config.localStorage.contentEstimate")} />
                            <StorageMetric icon={<HardDrive className="size-4" />} label={t("config.localStorage.siteUsage")} value={formatStorageBytes(usage.usage)} hint={t("config.localStorage.siteUsageHint")} />
                            <StorageMetric icon={<Layers3 className="size-4" />} label={t("config.localStorage.quota")} value={formatStorageBytes(usage.quota)} hint={t("config.localStorage.quotaHint")} />
                        </div>
                        <div className="mt-4">
                            <div className="mb-1 flex justify-between text-xs text-stone-500">
                                <span>{t("config.localStorage.quotaProgress")}</span>
                                <span className="tabular-nums">{percent.toFixed(2)}%</span>
                            </div>
                            <Progress percent={percent} showInfo={false} />
                        </div>
                    </>
                ) : null}
            </section>
            {usage?.databases.map((database) => (
                <section key={database.name} className="overflow-hidden rounded-lg border border-stone-200 dark:border-stone-800">
                    <div className="flex items-center justify-between gap-3 border-b border-stone-200 px-4 py-3 dark:border-stone-800">
                        <div className="min-w-0">
                            <div className="truncate text-sm font-semibold">{t("config.localStorage.mainDatabase")}</div>
                            <div className="mt-0.5 truncate font-mono text-[11px] text-stone-500">{database.name} · v{database.version}</div>
                        </div>
                        <div className="shrink-0 text-sm font-medium tabular-nums">{formatStorageBytes(database.bytes)}</div>
                    </div>
                    <div className="divide-y divide-stone-200 dark:divide-stone-800">
                        {database.stores.map((store) => (
                            <div key={store.name} className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-4 px-4 py-3 text-sm">
                                <div className="min-w-0">
                                    <div className="truncate font-medium">{storeLabel(store.name, t)}</div>
                                    <div className="mt-0.5 truncate font-mono text-[11px] text-stone-500">{store.name}</div>
                                </div>
                                <div className="text-right text-xs text-stone-500 tabular-nums">{t("config.localStorage.records", { count: store.records })}</div>
                                <div className="w-20 text-right font-medium tabular-nums">{formatStorageBytes(store.bytes)}</div>
                            </div>
                        ))}
                    </div>
                </section>
            ))}
        </div>
    );
}

function StorageMetric({ icon, label, value, hint }: { icon: ReactNode; label: string; value: string; hint: string }) {
    return (
        <div className="rounded-lg bg-stone-100/70 p-3 dark:bg-stone-900/70">
            <div className="flex items-center gap-2 text-xs text-stone-500">{icon}{label}</div>
            <div className="mt-2 text-xl font-semibold tabular-nums">{value}</div>
            <div className="mt-1 text-[11px] text-stone-500">{hint}</div>
        </div>
    );
}

function storeLabel(name: string, t: TFunction) {
    const key = storeLabelKeys[name];
    return key ? t(`config.localStorage.stores.${key}`) : name;
}

function formatStorageBytes(bytes: number) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
    return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
