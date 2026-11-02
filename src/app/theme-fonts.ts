import localFont from "next/font/local";

/**
 * The web fonts of the themes (#286), committed as woff2 files in `src/app/fonts/` (latin subset, with each
 * family's OFL licence beside it) and served by `next/font/local`: nothing is fetched from Google at build or run
 * time. Register, the default theme, uses the system faces and has none.
 *
 * Each font defines a CSS variable (`--font-<name>`) that `design-tokens.css` puts first in the theme's
 * `--rg-font-sans` / `--rg-font-mono`, followed by the system faces. The variable classes sit on <html> so any
 * theme can use them, but `preload: false` means no font file is preloaded, and a browser downloads a face only
 * when text is set in it: a page loads the selected theme's fonts and nothing else.
 *
 * A theme must not move the layout, so each face is tuned to the system face it replaces with `size-adjust`
 * (equal average character width, so text wraps in the same places) and `ascent-override`, `descent-override`
 * and `line-gap-override` (equal line height). The sans faces target Segoe UI, the mono faces Consolas. The
 * numbers come from `scripts/font-metrics.ts`, which derives them; change both together. The fallback is simply
 * the system face (the stack in `design-tokens.css`), which the web face is tuned to, so `adjustFontFallback`
 * is off.
 *
 * The options must be written out as literals for each call: `next/font` reads them at build time.
 */
const atkinsonSans = localFont({
  src: "./fonts/AtkinsonHyperlegibleNext.woff2",
  weight: "200 800",
  display: "swap",
  preload: false,
  adjustFontFallback: false,
  variable: "--font-atkinson-sans",
  declarations: [
    { prop: "size-adjust", value: "99.9%" },
    { prop: "ascent-override", value: "108.1%" },
    { prop: "descent-override", value: "25.1%" },
    { prop: "line-gap-override", value: "0.0%" },
  ],
});
const atkinsonMono = localFont({
  src: "./fonts/AtkinsonHyperlegibleMono.woff2",
  weight: "200 800",
  display: "swap",
  preload: false,
  adjustFontFallback: false,
  variable: "--font-atkinson-mono",
  declarations: [
    { prop: "size-adjust", value: "87.0%" },
    { prop: "ascent-override", value: "85.4%" },
    { prop: "descent-override", value: "29.6%" },
    { prop: "line-gap-override", value: "15.3%" },
  ],
});
const sourceSans = localFont({
  src: "./fonts/SourceSans3.woff2",
  weight: "200 900",
  display: "swap",
  preload: false,
  adjustFontFallback: false,
  variable: "--font-source-sans",
  declarations: [
    { prop: "size-adjust", value: "111.4%" },
    { prop: "ascent-override", value: "96.9%" },
    { prop: "descent-override", value: "22.5%" },
    { prop: "line-gap-override", value: "0.0%" },
  ],
});
const sourceCode = localFont({
  src: "./fonts/SourceCodePro.woff2",
  weight: "200 900",
  display: "swap",
  preload: false,
  adjustFontFallback: false,
  variable: "--font-source-code",
  declarations: [
    { prop: "size-adjust", value: "91.6%" },
    { prop: "ascent-override", value: "81.0%" },
    { prop: "descent-override", value: "28.1%" },
    { prop: "line-gap-override", value: "14.5%" },
  ],
});
const inter = localFont({
  src: "./fonts/Inter.woff2",
  weight: "100 900",
  display: "swap",
  preload: false,
  adjustFontFallback: false,
  variable: "--font-inter",
  declarations: [
    { prop: "size-adjust", value: "92.8%" },
    { prop: "ascent-override", value: "116.2%" },
    { prop: "descent-override", value: "27.0%" },
    { prop: "line-gap-override", value: "0.0%" },
  ],
});
const jetbrainsMono = localFont({
  src: "./fonts/JetBrainsMono.woff2",
  weight: "100 800",
  display: "swap",
  preload: false,
  adjustFontFallback: false,
  variable: "--font-jetbrains-mono",
  declarations: [
    { prop: "size-adjust", value: "91.6%" },
    { prop: "ascent-override", value: "81.0%" },
    { prop: "descent-override", value: "28.1%" },
    { prop: "line-gap-override", value: "14.5%" },
  ],
});
const publicSans = localFont({
  src: "./fonts/PublicSans.woff2",
  weight: "100 900",
  display: "swap",
  preload: false,
  adjustFontFallback: false,
  variable: "--font-public-sans",
  declarations: [
    { prop: "size-adjust", value: "97.3%" },
    { prop: "ascent-override", value: "110.9%" },
    { prop: "descent-override", value: "25.8%" },
    { prop: "line-gap-override", value: "0.0%" },
  ],
});
// IBM Plex Mono is not a variable font: one file per weight.
const plexMono = localFont({
  src: [
    { path: "./fonts/IBMPlexMono-400.woff2", weight: "400", style: "normal" },
    { path: "./fonts/IBMPlexMono-500.woff2", weight: "500", style: "normal" },
    { path: "./fonts/IBMPlexMono-600.woff2", weight: "600", style: "normal" },
    { path: "./fonts/IBMPlexMono-700.woff2", weight: "700", style: "normal" },
  ],
  display: "swap",
  preload: false,
  adjustFontFallback: false,
  variable: "--font-plex-mono",
  declarations: [
    { prop: "size-adjust", value: "91.6%" },
    { prop: "ascent-override", value: "81.0%" },
    { prop: "descent-override", value: "28.1%" },
    { prop: "line-gap-override", value: "14.5%" },
  ],
});

/** The class names that define the font variables, for the <html> element. */
export const FONT_VARIABLE_CLASSES = [atkinsonSans, atkinsonMono, sourceSans, sourceCode, inter, jetbrainsMono, publicSans, plexMono]
  .map((font) => font.variable)
  .join(" ");
