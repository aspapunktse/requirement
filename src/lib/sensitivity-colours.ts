/**
 * Colour maths for the Sensitivity Level colours (#291), ported from the design prototype
 * (`public/design/sensitivity/sensitivity.js`). Pure functions, no DOM, so the form, the API and the token CSS share them.
 *
 * The Admin sets a text and a background colour per level for light mode. Dark mode is derived from that pair
 * (`deriveDark`). Both pairs must reach WCAG AA contrast for normal text, 4.5:1.
 */

/** WCAG AA contrast for normal text. */
export const MIN_CONTRAST = 4.5;

const HEX_PATTERN = /^#[0-9a-f]{6}$/i;

/** True for `#RRGGBB` (any case). Nothing else is ever written into CSS. */
export function isHexColour(value: unknown): value is string {
  return typeof value === "string" && HEX_PATTERN.test(value);
}

/** Trimmed and upper-cased: `" #1d4ed8"` becomes `"#1D4ED8"`. */
export function normaliseHex(value: string): string {
  return value.trim().toUpperCase();
}

function channels(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function luminance(hex: string): number {
  const [r, g, b] = channels(hex).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two `#RRGGBB` colours, 1 to 21. */
export function contrastRatio(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** `"4.52:1"` */
export function formatRatio(ratio: number): string {
  return `${ratio.toFixed(2)}:1`;
}

/** `[hue 0-360, saturation 0-100, lightness 0-100]` */
export function toHsl(hex: string): [number, number, number] {
  const [r, g, b] = channels(hex).map((v) => v / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  let hue = 0;
  let s = 0;
  if (d) {
    s = d / (1 - Math.abs(2 * l - 1));
    hue = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    hue = (hue * 60 + 360) % 360;
  }
  return [hue, s * 100, l * 100];
}

export function fromHsl(h: number, s: number, l: number): string {
  const sat = s / 100;
  const light = l / 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = sat * Math.min(light, 1 - light);
  const f = (n: number) => light - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return "#" + [f(0), f(8), f(4)].map((v) => Math.round(v * 255).toString(16).padStart(2, "0")).join("").toUpperCase();
}

export type DarkPair = { textColor: string; backgroundColor: string; ratio: number };

/**
 * The dark pair from the light pair: the background keeps its hue on a dark 17% lightness, the text keeps its hue as a
 * light tint (starts at 86% lightness and rises until the pair passes 4.5:1). The returned ratio can still be under
 * 4.5 for an unusual light pair; callers refuse such a pair rather than show it.
 */
export function deriveDark(textColor: string, backgroundColor: string): DarkPair {
  const [hf, sf] = toHsl(textColor);
  const [hb, sb] = toHsl(backgroundColor);
  const background = fromHsl(hb, Math.min(sb, 50), 17);
  const saturation = Math.max(20, Math.min(sf, 85));
  let lightness = 86;
  let text = fromHsl(hf, saturation, lightness);
  while (contrastRatio(text, background) < MIN_CONTRAST && lightness < 98) {
    lightness += 1;
    text = fromHsl(hf, saturation, lightness);
  }
  return { textColor: text, backgroundColor: background, ratio: contrastRatio(text, background) };
}
