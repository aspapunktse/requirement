import { deriveDark, isHexColour } from "@/lib/sensitivity-colours";
import { DEFAULT_SENSITIVITY_LEVELS } from "@/lib/sensitivity-level-defaults";
import { sensitivityToken, type SensitivityLevelInfo } from "@/lib/sensitivity-level";

/**
 * The Sensitivity Level colour tokens (#291) as CSS: `--rg-sensitivity-<n>-fg` and `-bg` for n = 1..5. Light values sit
 * on `:root`; the derived dark values follow the mode rules of `design-tokens.css` (the OS preference unless
 * `data-theme="light"`, and `data-theme="dark"`). No theme sets these tokens, so a level looks the same in every theme,
 * and since this sheet comes after the theme sheet its rules win any tie.
 *
 * Only `#RRGGBB` values are ever written; a level whose stored colours are not that falls back to its default.
 */
export function sensitivityTokenCss(levels: readonly Pick<SensitivityLevelInfo, "level" | "textColor" | "backgroundColor">[]): string {
  const light: string[] = [];
  const dark: string[] = [];
  for (const fallback of DEFAULT_SENSITIVITY_LEVELS) {
    const stored = levels.find((row) => row.level === fallback.level);
    const usable = stored && isHexColour(stored.textColor) && isHexColour(stored.backgroundColor) ? stored : fallback;
    const pair = deriveDark(usable.textColor, usable.backgroundColor);
    light.push(`${sensitivityToken(fallback.level, "fg")}:${usable.textColor};${sensitivityToken(fallback.level, "bg")}:${usable.backgroundColor};`);
    dark.push(`${sensitivityToken(fallback.level, "fg")}:${pair.textColor};${sensitivityToken(fallback.level, "bg")}:${pair.backgroundColor};`);
  }
  return [
    `:root{${light.join("")}}`,
    `@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){${dark.join("")}}}`,
    `:root[data-theme="dark"]{${dark.join("")}}`,
  ].join("\n");
}
