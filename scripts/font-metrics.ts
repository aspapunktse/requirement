/**
 * The size and vertical-metric overrides of the theme fonts (#286). Run `npx tsx scripts/font-metrics.ts` to print
 * the numbers that `src/app/theme-fonts.ts` carries as `declarations`.
 *
 * Why: a theme changes colours and fonts and must not move the layout. A web font that is wider than the system
 * face re-wraps text, and one with other ascent/descent/line-gap metrics changes the height of every line box.
 * So each face is tuned to the system face it replaces, with three `@font-face` descriptors:
 *
 *   size-adjust       scales the glyphs so the AVERAGE character width equals the target's:
 *                       size-adjust = (target.xWidthAvg / target.unitsPerEm) / (font.xWidthAvg / font.unitsPerEm)
 *   ascent-override   the target's ascent (in em), divided by size-adjust, because the overrides are applied
 *   descent-override  before the scaling; line-gap-override is the same for the line gap. The line box then has
 *   line-gap-override the target's height at the same font-size.
 *
 * Targets (the first face the `--rg-font-*` stacks reach on Windows, where most users are):
 *   sans  Segoe UI. Metrics from next's capsize table (node_modules/next/dist/server/capsize-font-metrics.json,
 *         entry `segoeUI`).
 *   mono  Consolas, the monospace of the stack (`ui-monospace, "Cascadia Mono", Consolas`) that is always
 *         present on Windows; Chromium does not support `ui-monospace`. Consolas is not in the capsize table;
 *         its numbers are its hhea values as remembered, not read from a file here (2048 units per em, ascent 1521, descent 527, line gap 272, advance 1126; the sum, 1.133 em, is the line height Chromium uses for it).
 *         Only the width is exact to the table; treat the vertical values as best available.
 *
 * The fonts' own metrics are measured from the committed woff2 files (latin subset, default instance) with
 * `@capsizecss/unpack` (`fromFile(path)` gives ascent, descent, lineGap, unitsPerEm and xWidthAvg), so they
 * describe exactly what ships. They are pasted below; re-measure and re-run this script when a file changes.
 */

type Metrics = { ascent: number; descent: number; lineGap: number; unitsPerEm: number; xWidthAvg: number };

const SEGOE_UI: Metrics = { ascent: 2210, descent: -514, lineGap: 0, unitsPerEm: 2048, xWidthAvg: 908 };
const CONSOLAS: Metrics = { ascent: 1521, descent: -527, lineGap: 272, unitsPerEm: 2048, xWidthAvg: 1126 };

/** Measured from the woff2 files in src/app/fonts. */
export const FONTS: { name: string; file: string; target: Metrics; metrics: Metrics }[] = [
  { name: "Atkinson Hyperlegible Next", file: "AtkinsonHyperlegibleNext.woff2", target: SEGOE_UI, metrics: { ascent: 984, descent: -316, lineGap: 0, unitsPerEm: 1000, xWidthAvg: 444 } },
  { name: "Atkinson Hyperlegible Mono", file: "AtkinsonHyperlegibleMono.woff2", target: CONSOLAS, metrics: { ascent: 984, descent: -316, lineGap: 0, unitsPerEm: 1000, xWidthAvg: 632 } },
  { name: "Source Sans 3", file: "SourceSans3.woff2", target: SEGOE_UI, metrics: { ascent: 1024, descent: -400, lineGap: 0, unitsPerEm: 1000, xWidthAvg: 398 } },
  { name: "Source Code Pro", file: "SourceCodePro.woff2", target: CONSOLAS, metrics: { ascent: 984, descent: -273, lineGap: 0, unitsPerEm: 1000, xWidthAvg: 600 } },
  { name: "Inter", file: "Inter.woff2", target: SEGOE_UI, metrics: { ascent: 1984, descent: -494, lineGap: 0, unitsPerEm: 2048, xWidthAvg: 978 } },
  { name: "JetBrains Mono", file: "JetBrainsMono.woff2", target: CONSOLAS, metrics: { ascent: 1020, descent: -300, lineGap: 0, unitsPerEm: 1000, xWidthAvg: 600 } },
  { name: "Public Sans", file: "PublicSans.woff2", target: SEGOE_UI, metrics: { ascent: 1900, descent: -450, lineGap: 0, unitsPerEm: 2000, xWidthAvg: 911 } },
  { name: "IBM Plex Mono", file: "IBMPlexMono-*.woff2", target: CONSOLAS, metrics: { ascent: 1025, descent: -275, lineGap: 0, unitsPerEm: 1000, xWidthAvg: 600 } },
];

const percent = (value: number) => `${(Math.round(value * 1000) / 10).toFixed(1)}%`;

export function overridesFor({ target, metrics }: { target: Metrics; metrics: Metrics }) {
  const sizeAdjust = target.xWidthAvg / target.unitsPerEm / (metrics.xWidthAvg / metrics.unitsPerEm);
  return {
    "size-adjust": percent(sizeAdjust),
    "ascent-override": percent(target.ascent / target.unitsPerEm / sizeAdjust),
    "descent-override": percent(Math.abs(target.descent) / target.unitsPerEm / sizeAdjust),
    "line-gap-override": percent(target.lineGap / target.unitsPerEm / sizeAdjust),
  };
}

if (process.argv[1]?.endsWith("font-metrics.ts")) {
  for (const font of FONTS) console.log(font.name.padEnd(28), overridesFor(font));
}
