// Procedurally generated, original sample artwork for the homepage showcase (no third-party images, no network).
// Usage: cd brand && bun run showcase.mjs  -> web/public/showcase/*.webp
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Resvg } from "@resvg/resvg-js";
import sharp from "sharp";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, "..", "web", "public", "showcase");
mkdirSync(outDir, { recursive: true });

let seed = 7;
const rand = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
const W = 960, H = 720;
const wrap = (body, defs = "") => `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><defs>${defs}</defs>${body}</svg>`;
const ridge = (base, amp, step = 40) => {
    let d = `M0 ${H} L0 ${base}`;
    for (let x = 0; x <= W + step; x += step) d += ` L${x} ${base - Math.abs(Math.sin(x / 130 + rand() * 0.6)) * amp - rand() * amp * 0.3}`;
    return d + ` L${W} ${H} Z`;
};

const art = {
    "ink-mountains": () => wrap(`<rect width="${W}" height="${H}" fill="url(#sky)"/>
        <circle cx="690" cy="210" r="70" fill="#E8572A" opacity="0.92"/>
        ${[[430, 170, "#B9B2A6", 0.55], [500, 150, "#8C857A", 0.7], [570, 130, "#4E4A44", 0.85], [640, 90, "#1F1D1A", 0.95]].map(([b, a, c, o]) => `<path d="${ridge(b, a)}" fill="${c}" opacity="${o}"/>`).join("")}
        <rect y="300" width="${W}" height="140" fill="url(#mist)"/>`,
        `<linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#F4EEE3"/><stop offset="1" stop-color="#E7DFD2"/></linearGradient>
         <linearGradient id="mist" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#F4EEE3" stop-opacity="0"/><stop offset="0.5" stop-color="#F4EEE3" stop-opacity="0.8"/><stop offset="1" stop-color="#F4EEE3" stop-opacity="0"/></linearGradient>`),
    "neon-city": () => wrap(`<rect width="${W}" height="${H}" fill="url(#night)"/>
        ${Array.from({ length: 60 }, () => `<circle cx="${rand() * W}" cy="${rand() * 300}" r="${rand() * 1.8}" fill="#fff" opacity="${0.3 + rand() * 0.6}"/>`).join("")}
        ${Array.from({ length: 22 }, (_, i) => { const w = 30 + rand() * 60, h = 160 + rand() * 360, x = i * 46 - 20; return `<rect x="${x}" y="${H - h}" width="${w}" height="${h}" fill="#140F2B" stroke="${rand() > 0.5 ? "#FF4FD8" : "#38E1FF"}" stroke-opacity="0.55" stroke-width="2"/>` + Array.from({ length: 8 }, () => `<rect x="${x + 6 + rand() * (w - 14)}" y="${H - h + 12 + rand() * (h - 20)}" width="6" height="9" fill="${rand() > 0.5 ? "#FFD36E" : "#7DF9FF"}" opacity="0.8"/>`).join(""); }).join("")}
        <rect y="${H - 90}" width="${W}" height="90" fill="url(#glow)"/>`,
        `<linearGradient id="night" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0B0820"/><stop offset="1" stop-color="#3A1552"/></linearGradient>
         <linearGradient id="glow" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FF4FD8" stop-opacity="0"/><stop offset="1" stop-color="#FF4FD8" stop-opacity="0.45"/></linearGradient>`),
    "product-poster": () => wrap(`<rect width="${W}" height="${H}" fill="url(#bg)"/>
        <ellipse cx="480" cy="600" rx="260" ry="46" fill="#E9C9B5"/><rect x="220" y="560" width="520" height="40" fill="#F2D9C9"/><ellipse cx="480" cy="560" rx="260" ry="46" fill="#FBEDE3"/>
        <rect x="410" y="250" width="140" height="300" rx="34" fill="url(#bottle)"/><rect x="445" y="200" width="70" height="60" rx="10" fill="#2F4A7A"/>
        <rect x="430" y="360" width="100" height="80" rx="8" fill="#FFF7F1" opacity="0.85"/><circle cx="480" cy="400" r="18" fill="#E8572A"/>
        <circle cx="250" cy="200" r="60" fill="#FFFFFF" opacity="0.5"/><circle cx="730" cy="300" r="34" fill="#FFFFFF" opacity="0.55"/>`,
        `<linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#FFE3D3"/><stop offset="1" stop-color="#F7B9A0"/></linearGradient>
         <linearGradient id="bottle" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#F7A27E"/><stop offset="0.45" stop-color="#E8572A"/><stop offset="1" stop-color="#B23C17"/></linearGradient>`),
    "bauhaus": () => wrap(`<rect width="${W}" height="${H}" fill="#F1EADD"/>
        <rect x="80" y="80" width="360" height="360" fill="#2F4A7A"/><circle cx="600" cy="260" r="180" fill="#E8572A"/>
        <path d="M80 640 A 280 280 0 0 1 640 640 Z" fill="#E7B23B"/><rect x="640" y="460" width="240" height="180" fill="#1C1A17"/>
        <circle cx="260" cy="260" r="90" fill="#F1EADD"/><line x1="460" y1="80" x2="880" y2="500" stroke="#1C1A17" stroke-width="10"/>`),
    "lotus-moon": () => wrap(`<rect width="${W}" height="${H}" fill="url(#water)"/>
        <circle cx="700" cy="170" r="80" fill="#FFF6DD" opacity="0.95"/><circle cx="700" cy="170" r="130" fill="#FFF6DD" opacity="0.12"/>
        ${Array.from({ length: 9 }, () => { const x = rand() * W, y = 380 + rand() * 300, r = 50 + rand() * 70; return `<ellipse cx="${x}" cy="${y}" rx="${r}" ry="${r * 0.42}" fill="#2E5B4A" opacity="0.92"/><path d="M${x} ${y} L${x + r * 0.9} ${y - r * 0.1}" stroke="#1E3D31" stroke-width="3"/>`; }).join("")}
        <g transform="translate(330 420)"><path d="M0 0 C -40 -60 -20 -110 0 -130 C 20 -110 40 -60 0 0Z" fill="#F4A6B6"/><path d="M0 0 C -80 -40 -90 -80 -70 -100 C -40 -80 -20 -40 0 0Z" fill="#F7BFCB"/><path d="M0 0 C 80 -40 90 -80 70 -100 C 40 -80 20 -40 0 0Z" fill="#F7BFCB"/></g>`,
        `<linearGradient id="water" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0E1E33"/><stop offset="1" stop-color="#1C3A4F"/></linearGradient>`),
    "nebula": () => wrap(`<rect width="${W}" height="${H}" fill="#05060F"/>
        <circle cx="380" cy="320" r="320" fill="url(#n1)"/><circle cx="640" cy="420" r="280" fill="url(#n2)"/>
        ${Array.from({ length: 140 }, () => `<circle cx="${rand() * W}" cy="${rand() * H}" r="${rand() * 1.6 + 0.2}" fill="#fff" opacity="${0.3 + rand() * 0.7}"/>`).join("")}
        <circle cx="520" cy="360" r="8" fill="#fff"/><circle cx="520" cy="360" r="26" fill="#fff" opacity="0.15"/>`,
        `<radialGradient id="n1"><stop offset="0" stop-color="#E8572A" stop-opacity="0.75"/><stop offset="1" stop-color="#E8572A" stop-opacity="0"/></radialGradient>
         <radialGradient id="n2"><stop offset="0" stop-color="#5B7BD8" stop-opacity="0.7"/><stop offset="1" stop-color="#5B7BD8" stop-opacity="0"/></radialGradient>`),
    "silk-ribbons": () => wrap(`<rect width="${W}" height="${H}" fill="#2A1C17"/>
        ${["#E8572A", "#E7B23B", "#3F8F86", "#C24E6A", "#F2E3C6"].map((c, i) => `<path d="M-50 ${180 + i * 90} C 240 ${60 + i * 70}, 520 ${420 + i * 30}, 1010 ${150 + i * 100}" stroke="${c}" stroke-width="${46 - i * 6}" fill="none" stroke-linecap="round" opacity="0.9"/>`).join("")}`),
    "snow-lake": () => wrap(`<rect width="${W}" height="${H}" fill="url(#s)"/>
        <path d="M0 420 L180 240 L280 330 L420 150 L560 320 L660 230 L960 420 Z" fill="#E9EEF4"/><path d="M420 150 L470 210 L440 205 L420 230 L400 200 Z" fill="#fff"/>
        <path d="M0 420 L180 240 L280 330 L420 150 L560 320 L660 230 L960 420 Z" fill="#6E8BAA" opacity="0.35"/>
        <rect y="420" width="${W}" height="300" fill="url(#lake)"/><path d="M0 420 L180 600 L280 510 L420 690 L560 520 L660 610 L960 420 Z" fill="#9FB4CB" opacity="0.35"/>`,
        `<linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#BFD3E8"/><stop offset="1" stop-color="#F3F6FA"/></linearGradient>
         <linearGradient id="lake" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5E7FA3"/><stop offset="1" stop-color="#2C4766"/></linearGradient>`),
};

for (const [name, make] of Object.entries(art)) {
    const png = new Resvg(make(), { fitTo: { mode: "width", value: W } }).render().asPng();
    await sharp(png).webp({ quality: 80 }).toFile(join(outDir, `${name}.webp`));
    console.log("wrote showcase", name);
}
