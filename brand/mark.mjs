// 点染 Dianran logo geometry — single source for all generated SVGs.
// Concept: a brush-ink dot (点) whose "dye" (染) flows out along node-connecting lines.
export const COLORS = {
    vermilion: "#E8572A",
    vermilionDeep: "#C4421B",
    vermilionLight: "#FF7A4D",
    indigo: "#2F4A7A",
    indigoLight: "#8FA6D6",
    warmGray: "#A8A196",
    paper: "#F6F1E8",
    ink: "#1C1A17",
};

// Ink dot: slightly irregular, like a brush pressed onto rice paper.
// Calligraphic 点 stroke: sharp entry at upper-left, full rounded belly at lower-right.
export const DOT = "M13.4 11.6C24.2 14.6 38.6 23.4 42.8 34.4C46.6 44.6 40.2 54.4 29.4 54.2C20.2 54 14.6 47 16.2 39.2C17.6 32.2 19.6 22.4 13.4 11.6Z";
// Brush flick leaving the dot toward the upper node (tapered stroke, filled shape).
// Ink "dye" bleeding out of the stroke toward the upper node (tapered).
export const FLICK = "M38.6 28.6C42.6 25.6 46 23.2 49.4 21.2L51 23.8C47.8 25.8 44.6 28.4 41 31.6Z";
// Thin connector from the dot to the lower-right node.
export const LINE2 = { x1: 43.2, y1: 42.4, x2: 51.6, y2: 46.2 };
// Thin connector between the two satellite nodes.
export const LINE3 = { x1: 54.2, y1: 27.6, x2: 54.6, y2: 41.6 };
export const NODE1 = { cx: 53.4, cy: 21.4, r: 4.8 };
export const NODE2 = { cx: 54.6, cy: 47.6, r: 3.8 };

// Monochrome mark (currentColor) used by the header CSS mask and anywhere a single-colour glyph is needed.
export function monoMark({ color = "currentColor" } = {}) {
    return `<g fill="${color}">
    <path d="${DOT}"/>
    <path d="${FLICK}"/>
    <circle cx="${NODE1.cx}" cy="${NODE1.cy}" r="${NODE1.r}"/>
    <circle cx="${NODE2.cx}" cy="${NODE2.cy}" r="${NODE2.r}"/>
  </g>
  <g stroke="${color}" stroke-width="2.4" stroke-linecap="round" fill="none">
    <line x1="${LINE2.x1}" y1="${LINE2.y1}" x2="${LINE2.x2}" y2="${LINE2.y2}"/>
    <line x1="${LINE3.x1}" y1="${LINE3.y1}" x2="${LINE3.x2}" y2="${LINE3.y2}" stroke-dasharray="0.1 4.6"/>
  </g>`;
}

// Full-colour mark. `dark` lightens the secondary colours for dark backgrounds.
export function colorMark({ id = "dr", dark = false } = {}) {
    const second = dark ? COLORS.indigoLight : COLORS.indigo;
    const gray = dark ? "#CFC8BC" : COLORS.warmGray;
    return `<defs>
    <linearGradient id="${id}-ink" x1="12" y1="11" x2="38" y2="54" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="${COLORS.vermilionLight}"/>
      <stop offset="0.45" stop-color="${COLORS.vermilion}"/>
      <stop offset="1" stop-color="${COLORS.vermilionDeep}"/>
    </linearGradient>
    <linearGradient id="${id}-flick" x1="41" y1="31" x2="51" y2="23" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="${COLORS.vermilion}"/>
      <stop offset="1" stop-color="${second}"/>
    </linearGradient>
  </defs>
  <path d="${DOT}" fill="url(#${id}-ink)"/>
  <path d="${FLICK}" fill="url(#${id}-flick)"/>
  <g stroke-width="2.4" stroke-linecap="round" fill="none">
    <line x1="${LINE2.x1}" y1="${LINE2.y1}" x2="${LINE2.x2}" y2="${LINE2.y2}" stroke="${gray}"/>
    <line x1="${LINE3.x1}" y1="${LINE3.y1}" x2="${LINE3.x2}" y2="${LINE3.y2}" stroke="${gray}" stroke-dasharray="0.1 4.6"/>
  </g>
  <circle cx="${NODE1.cx}" cy="${NODE1.cy}" r="${NODE1.r}" fill="${second}"/>
  <circle cx="${NODE2.cx}" cy="${NODE2.cy}" r="${NODE2.r}" fill="${gray}"/>`;
}
