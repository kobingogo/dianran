// Regenerate every 点染 brand asset in web/public from mark.mjs.
// Usage: cd brand && bun install && bun run render.mjs   (needs @resvg/resvg-js + png-to-ico)
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Resvg } from "@resvg/resvg-js";
import pngToIco from "png-to-ico";
import { COLORS, colorMark, monoMark } from "./mark.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const pub = join(here, "..", "web", "public");
const out = join(here, "generated");
mkdirSync(out, { recursive: true });

const svg = (w, h, body, vb = `0 0 ${w} ${h}`) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="${vb}" fill="none">\n  ${body}\n</svg>\n`;
const write = (name, content, dir = pub) => { writeFileSync(join(dir, name), content); console.log("wrote", name); };
const png = (svgText, width) => new Resvg(svgText, { fitTo: { mode: "width", value: width }, font: { loadSystemFonts: true, defaultFontFamily: "Noto Sans CJK SC" } }).render().asPng();

// 1. Logo SVGs
const logoMono = svg(64, 64, monoMark());
const logoColor = svg(64, 64, colorMark({ id: "c" }));
const favicon = svg(64, 64, `<style>@media (prefers-color-scheme: dark){.l{display:none}}@media (prefers-color-scheme: light){.d{display:none}}</style>
  <g class="l">${colorMark({ id: "l" })}</g>
  <g class="d">${colorMark({ id: "d", dark: true })}</g>`);
// App icon tile (paper background), used for PNG icons. `pad` = how much the mark is shrunk (maskable needs a larger safe zone).
const tile = (pad = 0.8, radius = 14) => svg(64, 64, `<rect width="64" height="64" rx="${radius}" fill="${COLORS.paper}"/>
  <g transform="translate(${32 - 33.4 * pad} ${32 - 32.4 * pad}) scale(${pad})">${colorMark({ id: "t" })}</g>`);
const appIcon = tile(0.8, 14);
const maskable = tile(0.62, 0);

write("logo.svg", logoMono);
write("logo-color.svg", logoColor);
write("favicon.svg", favicon);
write("app-icon.svg", appIcon, out);
write("app-icon-maskable.svg", maskable, out);

// 2. Wordmarks (text relies on installed fonts; PNG versions are rendered for portability)
const wordmark = (dark) => svg(360, 96, `<g transform="translate(8 16)">${colorMark({ id: dark ? "wd" : "wl", dark })}</g>
  <text x="86" y="63" font-family="'Noto Serif CJK SC','Source Han Serif SC','Songti SC',serif" font-size="46" font-weight="700" fill="${dark ? "#F5F1EA" : COLORS.ink}">点染</text>
  <text x="194" y="62" font-family="Inter,'Helvetica Neue',Arial,sans-serif" font-size="30" font-weight="600" letter-spacing="1" fill="${dark ? "#CFC8BC" : "#6B655C"}">Dianran</text>`);
write("wordmark-light.svg", wordmark(false));
write("wordmark-dark.svg", wordmark(true));

// 3. PNG icon set
const pngs = [
    ["favicon-16.png", logoColor, 16],
    ["favicon-32.png", logoColor, 32],
    ["favicon-48.png", logoColor, 48],
    ["apple-touch-icon.png", tile(0.78, 0), 180],
    ["icon-192.png", appIcon, 192],
    ["icon-512.png", appIcon, 512],
    ["icon-maskable-512.png", maskable, 512],
];
for (const [name, source, width] of pngs) write(name, png(source, width));
const ico = await pngToIco([16, 32, 48].map((s) => join(pub, `favicon-${s}.png`)));
write("favicon.ico", ico);
// 16/48 only feed the .ico; keep 32 for <link rel=icon type=image/png>.
for (const s of [16, 48]) { try { (await import("node:fs")).unlinkSync(join(pub, `favicon-${s}.png`)); } catch {} }

// 4. OG image 1200x630
const nodes = [
    { x: 760, y: 120, w: 300, h: 120, title: "提示词", body: "清晨的江南小巷，水墨淡彩", accent: COLORS.indigo },
    { x: 820, y: 320, w: 280, h: 190, title: "生图", body: "", accent: COLORS.vermilion, image: true },
];
const og = svg(1200, 630, `<defs>
    <pattern id="grid" width="28" height="28" patternUnits="userSpaceOnUse"><circle cx="2" cy="2" r="1.6" fill="#D9D1C3"/></pattern>
    <radialGradient id="wash" cx="0.18" cy="0.2" r="0.9"><stop offset="0" stop-color="#FBE3D6"/><stop offset="0.5" stop-color="${COLORS.paper}" stop-opacity="0"/></radialGradient>
    <linearGradient id="img" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#F3B79C"/><stop offset="0.5" stop-color="${COLORS.vermilion}"/><stop offset="1" stop-color="${COLORS.indigo}"/></linearGradient>
  </defs>
  <rect width="1200" height="630" fill="${COLORS.paper}"/>
  <rect width="1200" height="630" fill="url(#grid)"/>
  <rect width="1200" height="630" fill="url(#wash)"/>
  <path d="M1060 180 C1160 220 1150 300 1100 330" stroke="${COLORS.warmGray}" stroke-width="3" stroke-dasharray="2 9" stroke-linecap="round"/>
  <path d="M700 300 C740 300 760 380 820 400" stroke="${COLORS.vermilion}" stroke-width="3" stroke-linecap="round"/>
  ${nodes.map((n) => `<g>
    <rect x="${n.x}" y="${n.y}" width="${n.w}" height="${n.h}" rx="18" fill="#FFFFFF" stroke="#E4DCCD" stroke-width="2"/>
    <circle cx="${n.x + 26}" cy="${n.y + 28}" r="7" fill="${n.accent}"/>
    <text x="${n.x + 44}" y="${n.y + 36}" font-family="'Noto Sans CJK SC',sans-serif" font-size="22" font-weight="700" fill="${COLORS.ink}">${n.title}</text>
    ${n.image ? `<rect x="${n.x + 20}" y="${n.y + 56}" width="${n.w - 40}" height="${n.h - 76}" rx="10" fill="url(#img)"/><circle cx="${n.x + n.w - 70}" cy="${n.y + 96}" r="18" fill="#FFF4EC" opacity="0.85"/>` : `<text x="${n.x + 24}" y="${n.y + 84}" font-family="'Noto Sans CJK SC',sans-serif" font-size="22" fill="#6B655C">${n.body}</text>`}
  </g>`).join("\n  ")}
  <g transform="translate(96 150) scale(2.6)">${colorMark({ id: "og" })}</g>
  <text x="96" y="410" font-family="'Noto Serif CJK SC',serif" font-size="128" font-weight="700" fill="${COLORS.ink}">点染</text>
  <text x="372" y="404" font-family="Inter,sans-serif" font-size="52" font-weight="600" fill="#6B655C" letter-spacing="2">Dianran</text>
  <text x="100" y="480" font-family="'Noto Sans CJK SC',sans-serif" font-size="36" font-weight="500" fill="${COLORS.vermilionDeep}">一点灵感，染成画面</text>
  <text x="100" y="530" font-family="'Noto Sans CJK SC',sans-serif" font-size="26" fill="#6B655C">节点式 AI 创作画布 · 生图 · 视频 · 文本 · 连续推演</text>
  <text x="100" y="588" font-family="Inter,sans-serif" font-size="20" fill="${COLORS.warmGray}" letter-spacing="1">by KobinFlow</text>`);
write("og-image.svg", og, out);
write("og-image.png", png(og, 1200));
