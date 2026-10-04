// [dianran] Brand copy layered on top of the upstream locale files (deep-merged in i18n/index.ts).
// Keeping overrides here instead of editing zh-CN.ts / en-US.ts keeps upstream merges conflict-free.
import { BRAND } from "@/constant/brand";

type Overrides = { [key: string]: string | Overrides };

export const brandOverrides: Record<"zh-CN" | "en-US", Overrides> = {
    "zh-CN": {
        meta: { title: BRAND.nameZh, description: BRAND.descriptionZh },
        modelPlugin: { authoring: { intro: `请为 ${BRAND.nameZh}（${BRAND.nameEn}）编写一段模型调用脚本。能力类型：{{capability}}。目标模型：{{model}}。` } },
        canvas: {
            defaultTitle: "未命名画布 {{count}}",
            title: "我的画布",
            export: { defaultProjectName: `${BRAND.nameZh}画布` },
            plugins: { officialDescription: `${BRAND.nameZh}官方插件，随站点一起发布`, noOfficial: "暂无官方插件，可在下方通过 URL 安装" },
        },
        home: {
            eyebrow: `${BRAND.nameEn} · by ${BRAND.owner}`,
            tagline: BRAND.taglineZh,
            description: "在 <canvas>节点画布</canvas> 上生成、连接和重组 <content>图片、视频与文字</content>，让每一次生成都成为下一步创作的起点。",
            start: "开始创作",
            openCanvas: "生图工作台",
            showcaseTitle: "从一个灵感开始",
            showcaseDescription: "挑一个示例提示词，复制到画布里，一点一点染出你的画面。",
            copyPrompt: "复制提示词",
            copied: "已复制提示词",
        },
        config: {
            localStorage: {
                description: `查看${BRAND.nameZh}在浏览器中保存的数据量，并按对象仓库统计内容体积。`,
                mainDatabase: `${BRAND.nameZh}主数据`,
            },
        },
        agent: {
            connect: {
                pluginText: "在终端运行下面两条命令安装点染插件（插件名 dianran），然后在 Codex 里说“打开点染画布”。插件会启动本地 Agent，并把 Local URL 和 Connect token 放在链接里自动连接。",
                pluginReminderText: "只有安装 Codex 插件或手动添加 MCP 后，工具列表才会进入 Codex 上下文并增加 token 消耗；只在终端启动本地 Agent 不会安装 MCP。0.7.0 之前的插件和 MCP 叫 infinite-canvas（会运行上游的 Agent），装过的话建议用最后两条命令移除。",
                removeLegacy: "移除旧版",
                autoDiscover: "网页会自动探测本机 Agent 的地址；Connect token 不会自动下发，需要通过插件打开的链接带入，或从终端输出复制粘贴到下面。",
            },
            events: { diagnostics: "本地 Agent 诊断" },
        },
    },
    "en-US": {
        meta: { title: BRAND.nameEn, description: BRAND.descriptionEn },
        modelPlugin: { authoring: { intro: `Write a model request script for ${BRAND.nameEn}. Capability: {{capability}}. Target model: {{model}}.` } },
        canvas: {
            defaultTitle: "Untitled canvas {{count}}",
            title: "My canvases",
            export: { defaultProjectName: `${BRAND.nameEn} canvas` },
            plugins: { officialDescription: `Official ${BRAND.nameEn} plugins shipped with this site`, noOfficial: "No official plugins yet. Install one by URL below." },
        },
        home: {
            eyebrow: `${BRAND.nameZh} · by ${BRAND.owner}`,
            tagline: BRAND.taglineEn,
            description: "Generate, connect, and remix <content>images, video, and text</content> on a <canvas>node canvas</canvas>, turning one-off generations into a continuous creative flow.",
            start: "Start creating",
            openCanvas: "Image studio",
            showcaseTitle: "Start from a spark",
            showcaseDescription: "Pick a sample prompt, copy it into a canvas, and build your picture step by step.",
            copyPrompt: "Copy prompt",
            copied: "Prompt copied",
        },
        config: {
            localStorage: {
                description: `See how much browser storage ${BRAND.nameEn} uses, grouped by object store.`,
                mainDatabase: `${BRAND.nameEn} data`,
            },
        },
        agent: {
            connect: {
                pluginText: "Run the two commands below to install the Dianran plugin (named dianran), then ask Codex to \"open the Dianran canvas\". The plugin starts the local Agent and passes the Local URL and Connect token in the link, so the page connects automatically.",
                pluginReminderText: "The tool list enters the Codex context and consumes additional tokens only after installing the Codex plugin or adding MCP manually. Starting the local Agent from a terminal alone does not install MCP. Before 0.7.0 the plugin and MCP were named infinite-canvas (and ran the upstream agent); remove them with the last two commands if installed.",
                removeLegacy: "Remove old",
                autoDiscover: "The page detects the local Agent address automatically. The Connect token is never handed out automatically: it arrives in the link the plugin opens, or paste it from the terminal output below.",
            },
            events: { diagnostics: "Local Agent diagnostics" },
        },
    },
};

export function mergeDeep<T extends Record<string, unknown>>(base: T, extra: Overrides): T {
    const out: Record<string, unknown> = { ...base };
    for (const [key, value] of Object.entries(extra)) {
        const current = out[key];
        out[key] = typeof value === "object" && value && typeof current === "object" && current ? mergeDeep(current as Record<string, unknown>, value) : value;
    }
    return out as T;
}
