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
        workbenchUi: {
            tryExamples: "试试这些示例",
            shortcutHint: "Ctrl / ⌘ + Enter 快速生成",
            imageSubtitle: "文字或参考图生成图片",
            videoSubtitle: "文字或参考图生成短视频",
            imageEmptyTitle: "还没有生成图片",
            imageEmptyHint: "在左侧写下想要的画面，或挑一个示例开始；结果会出现在这里，可下载、存入素材或作为参考图继续创作。",
            videoEmptyTitle: "还没有生成视频",
            videoEmptyHint: "描述镜头运动和画面内容，可附上参考图；生成通常需要一到几分钟，结果会出现在这里。",
            imageExamples: "水墨山水，晨雾缭绕，大面积留白，竖幅构图|霓虹雨夜的城市街角，地面倒影，电影感广角|极简产品海报：一只素白陶瓷杯，柔和侧光，浅色背景",
            videoExamples: "镜头缓慢推进，晨雾中的竹林，光束穿过叶隙|一只纸鹤在书桌上展翅飞起，微距，浅景深|海浪拍打礁石，慢动作，黄昏逆光",
            logsEmptyHint: "生成过的内容会自动记录在这里（保存在本机浏览器）。",
        },
        home: {
            eyebrow: `${BRAND.nameEn} · by ${BRAND.owner}`,
            tagline: BRAND.taglineZh,
            description: "在 <canvas>节点画布</canvas> 上生成、连接和重组 <content>图片、视频与文字</content>，让每一次生成都成为下一步创作的起点。",
            start: "开始创作",
            openCanvas: "生图工作台",
            showcaseTitle: "从一个灵感开始",
            showcaseDescription: "来自点染提示词库里的热门作品：点开看大图，复制提示词到画布里复现。作品版权归原作者，点署名可查看原帖。",
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
                pluginReminderText: "只有安装 Codex 插件或手动添加 MCP 后，工具列表才会进入 Codex 上下文并增加 token 消耗；只在终端启动本地 Agent 不会安装 MCP。不用时可以用下面的命令移除。",
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
        workbenchUi: {
            tryExamples: "Try an example",
            shortcutHint: "Ctrl / ⌘ + Enter to generate",
            imageSubtitle: "Text or reference images to pictures",
            videoSubtitle: "Text or reference images to short videos",
            imageEmptyTitle: "No images yet",
            imageEmptyHint: "Describe the picture on the left or pick an example. Results show up here — download them, save to assets or reuse as references.",
            videoEmptyTitle: "No videos yet",
            videoEmptyHint: "Describe the camera motion and scene, optionally with reference images. Generation usually takes one to a few minutes.",
            imageExamples: "Ink-wash mountains in morning mist, generous negative space, portrait framing|A neon street corner on a rainy night, reflections, cinematic wide angle|Minimal product poster: a plain white ceramic cup, soft side light",
            videoExamples: "Slow push-in through a misty bamboo forest, light beams through leaves|A paper crane takes off from a desk, macro, shallow depth of field|Waves crashing on rocks in slow motion, backlit at sunset",
            logsEmptyHint: "Everything you generate is logged here (stored in this browser).",
        },
        home: {
            eyebrow: `${BRAND.nameZh} · by ${BRAND.owner}`,
            tagline: BRAND.taglineEn,
            description: "Generate, connect, and remix <content>images, video, and text</content> on a <canvas>node canvas</canvas>, turning one-off generations into a continuous creative flow.",
            start: "Start creating",
            openCanvas: "Image studio",
            showcaseTitle: "Start from a spark",
            showcaseDescription: "Popular works from the Dianran prompt libraries: open one, copy its prompt and remix it on a canvas. All rights belong to the original authors — tap the credit to see the source post.",
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
                pluginReminderText: "The tool list enters the Codex context and consumes additional tokens only after installing the Codex plugin or adding MCP manually. Starting the local Agent from a terminal alone does not install MCP. Remove them with the commands below when not in use.",
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
