// [dianran] Bundled homepage showcase: original sample artwork in public/showcase, no network requests.
export type ShowcaseItem = { id: string; title: { "zh-CN": string; "en-US": string }; tags: string[]; prompt: string; cover: string };

const base = import.meta.env.BASE_URL || "/";
const cover = (name: string) => `${base}showcase/${name}.webp`;

export const showcaseItems: ShowcaseItem[] = [
    { id: "ink-mountains", title: { "zh-CN": "水墨远山", "en-US": "Ink mountains" }, tags: ["国风", "水墨"], cover: cover("ink-mountains"), prompt: "水墨画风格的层叠远山，晨雾在山谷间流动，一轮朱砂色的太阳，宣纸纹理，大面积留白，极简构图" },
    { id: "neon-city", title: { "zh-CN": "霓虹夜城", "en-US": "Neon city" }, tags: ["赛博朋克", "夜景"], cover: cover("neon-city"), prompt: "赛博朋克城市夜景，高楼轮廓描着品红与青色霓虹，窗户星星点点，地面泛起紫色辉光，电影感广角" },
    { id: "product-poster", title: { "zh-CN": "电商主图", "en-US": "Product hero shot" }, tags: ["电商", "产品"], cover: cover("product-poster"), prompt: "一瓶朱红色精华液立在奶油色圆形展台上，柔和蜜桃色渐变背景，漂浮的柔光圆点，干净的商业产品摄影" },
    { id: "bauhaus", title: { "zh-CN": "包豪斯几何", "en-US": "Bauhaus geometry" }, tags: ["海报", "几何"], cover: cover("bauhaus"), prompt: "包豪斯风格海报，靛蓝方块、朱红圆形、明黄半圆与黑色矩形组合，一条斜线贯穿画面，米白纸张底色" },
    { id: "lotus-moon", title: { "zh-CN": "荷塘月色", "en-US": "Lotus under the moon" }, tags: ["插画", "夜晚"], cover: cover("lotus-moon"), prompt: "深蓝色夜晚的荷塘，一朵粉色荷花在墨绿荷叶间绽放，月亮散发柔和光晕，扁平插画风格" },
    { id: "nebula", title: { "zh-CN": "星云", "en-US": "Nebula" }, tags: ["宇宙", "抽象"], cover: cover("nebula"), prompt: "深空星云，朱红与钴蓝两团气体交织，中心一颗明亮恒星，细密星点，梦幻柔焦" },
    { id: "silk-ribbons", title: { "zh-CN": "飞天绸带", "en-US": "Silk ribbons" }, tags: ["敦煌", "色彩"], cover: cover("silk-ribbons"), prompt: "敦煌壁画配色的抽象飘带，朱红、赭黄、石绿、胭脂与象牙白的绸带在深褐背景上流动" },
    { id: "snow-lake", title: { "zh-CN": "雪山湖泊", "en-US": "Snowy lake" }, tags: ["风景", "极简"], cover: cover("snow-lake"), prompt: "极简风格的雪山与平静湖面倒影，冷色调蓝灰渐变，低饱和，留白，适合做壁纸" },
];
