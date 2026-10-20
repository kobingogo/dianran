import { Alert, App, Button, Form, Input, Space, Switch, Typography, Upload } from "antd";
import { Copy, Network, Wifi, FileKey } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useCopyText } from "@/hooks/use-copy-text";
import { pairLocalProxy, testLocalProxy } from "@/services/api/local-proxy";
import { DEFAULT_LOCAL_PROXY_URL, LOCAL_PROXY_PACKAGE, useConfigStore } from "@/stores/use-config-store";
import { useLocalProxyStore, forgetProxyPairing } from "@/stores/use-local-proxy-store";
import { showErrorToast } from "@/features/errors/error-toast";
import { normalizeProxyBase, normalizeProxyTarget } from "../../../../canvas-proxy/policy.js";

const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
export function ConfigLocalProxy() {
    const { message } = App.useApp();
    const { t } = useTranslation();
    const copyText = useCopyText();
    const [testing, setTesting] = useState(false);
    const [pairing, setPairing] = useState(false);
    const [extraTargets, setExtraTargets] = useState("");
    const [error, setError] = useState("");
    const config = useConfigStore((state) => state.config);
    const webdav = useConfigStore((state) => state.webdav);
    const updateConfig = useConfigStore((state) => state.updateConfig);
    const paired = useLocalProxyStore((state) => state.pairing);
    const storedError = useLocalProxyStore((state) => state.error);
    const candidates = [...config.channels.map((channel) => channel.baseUrl), webdav.url, ...extraTargets.split("\n")].map((value) => value.trim()).filter(Boolean);
    const targets: string[] = [];
    let commandError = "";
    for (const value of candidates) {
        try { targets.push(normalizeProxyTarget(value)); } catch { commandError = "服务地址无效或含凭据/查询参数，请填写渠道或服务的基础地址"; }
    }
    let command = "";
    try {
        const proxy = new URL(normalizeProxyBase(config.proxyUrl || DEFAULT_LOCAL_PROXY_URL));
        if (!targets.length) commandError = "请先配置渠道或填写其他服务地址";
        const bin = import.meta.env.DEV ? "node canvas-proxy/index.js" : `npx ${LOCAL_PROXY_PACKAGE}@0.2.0`;
        command = `${bin} --host ${quote(proxy.hostname)} --port ${quote(proxy.port || (proxy.protocol === "https:" ? "443" : "80"))} --origin ${quote(window.location.origin)} ${[...new Set(targets)].map((target) => `--target ${quote(target)}`).join(" ")}`;
        if (proxy.protocol !== "http:") commandError = "当前代理通过 HTTP 监听，请填写 http:// 的本机地址";
    } catch { commandError = "代理地址必须是 http://127.0.0.1:端口、localhost 或 [::1]"; }
    const testProxy = async () => {
        setTesting(true); setError("");
        try { message.success(t("config.proxy.available", { proxy: await testLocalProxy(config.proxyUrl) })); }
        catch (reason) { setError(reason instanceof Error ? reason.message : "连接失败"); }
        finally { setTesting(false); }
    };
    return <Form layout="vertical" requiredMark={false}>
        <section className="rounded-lg border border-stone-200 p-3 dark:border-stone-800">
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div><div className="flex items-center gap-2 text-sm font-semibold"><Network className="size-4" />{t("config.proxy.title")}</div><div className="mt-1 text-xs text-stone-500">仅转发给本机明确授权的服务，连接前需要导入配对文件。</div></div>
                <Switch checked={config.proxyEnabled} onChange={(checked) => updateConfig("proxyEnabled", checked)} />
            </div>
            {config.proxyEnabled && <>
                <Form.Item label={t("config.proxy.address")} extra="更换代理地址后需为新地址重新配对。" className="mt-3 mb-0">
                    <Input value={config.proxyUrl} placeholder={DEFAULT_LOCAL_PROXY_URL} onChange={(event) => updateConfig("proxyUrl", event.target.value)} />
                </Form.Item>
                <Form.Item label="其他需要授权的服务" extra="每行一个基础地址，例如本地模型或下载域名。渠道与 WebDAV 地址已包含在下面的命令中。" className="mt-3 mb-0">
                    <Input.TextArea value={extraTargets} onChange={(event) => setExtraTargets(event.target.value)} autoSize placeholder="http://127.0.0.1:11434" />
                </Form.Item>
                {commandError ? <Alert className="mt-3" type="warning" title={commandError} /> : <div className="mt-3 rounded-md bg-stone-100 px-3 py-2 dark:bg-stone-900">
                    <div className="mb-1 text-xs text-stone-500">核对来源与服务后，在终端运行。{import.meta.env.DEV ? "开发版从项目根目录运行；软件包与网页须成对发布。" : "需要代理 0.2.0 配对版本。"}</div>
                    <div className="flex items-center gap-3"><code className="min-w-0 flex-1 break-all text-xs">{command}</code><Button size="small" type="text" aria-label="复制代理启动命令" icon={<Copy className="size-3.5" />} onClick={() => copyText(command)} /></div>
                </div>}
                <Typography.Paragraph className="mt-3" type="secondary">启动后会显示配对文件路径。将该文件导入此处；代理重启、增加服务或更换站点后需重新配对。配对凭据单独保存在当前浏览器，不进入配置分享。</Typography.Paragraph>
                <Space wrap>
                    <Upload accept=".json" showUploadList={false} beforeUpload={(file) => {
                        setPairing(true); setError("");
                        void file.text().then(pairLocalProxy).then((url) => { updateConfig("proxyUrl", url); message.success("本地代理配对成功"); }).catch((reason) => setError(reason instanceof Error ? reason.message : "配对失败")).finally(() => setPairing(false));
                        return false;
                    }}><Button icon={<FileKey className="size-4" />} loading={pairing}>导入配对文件</Button></Upload>
                    <Button icon={<Wifi className="size-4" />} loading={testing} onClick={() => void testProxy()}>{t("config.proxy.test")}</Button>
                    {(paired || storedError) && <Button type="text" onClick={() => { try { forgetProxyPairing(); setError(""); message.success("已移除本浏览器配对"); } catch (reason) { showErrorToast(message, reason); } }}>移除配对</Button>}
                </Space>
                {(error || storedError) && <Alert className="mt-3" type="error" showIcon title="本地代理未连接" description={error || storedError} />}
                {paired && <div className="mt-3 text-xs"><div>已配对地址：{paired.proxyUrl}</div><div>已授权服务：</div>{paired.targets.map((target) => <div key={target} className="break-all">{target}</div>)}</div>}
            </>}
        </section>
    </Form>;
}
