import { z } from "zod";
import { contrastRatio, deriveDark, formatRatio, isHexColour, MIN_CONTRAST, normaliseHex } from "@/lib/sensitivity-colours";

/**
 * The Sensitivity Level scale (ADR 0011): five fixed, ordered levels keyed by their ordinal, 1 Public
 * to 5 Critical Sensitivity. The `SensitivityLevel` table (filled by a migration) holds the label,
 * description and colours; a System's level and a Control's minimum are the ordinal, and Controls
 * compare by it.
 */
export const MIN_SENSITIVITY_LEVEL = 1;
export const MAX_SENSITIVITY_LEVEL = 5;

/** A level on the request boundary: an integer 1 to 5, or null for "none". */
export const sensitivityLevelSchema = z.number().int().min(MIN_SENSITIVITY_LEVEL).max(MAX_SENSITIVITY_LEVEL).nullable();

/** One level as the UI shows it. */
export type SensitivityLevelInfo = {
  level: number;
  label: string;
  description: string;
  textColor: string;
  backgroundColor: string;
};

export const MAX_SENSITIVITY_LABEL_LENGTH = 40;
export const MAX_SENSITIVITY_DESCRIPTION_LENGTH = 300;

/** The CSS custom property for a level's colour: `--rg-sensitivity-3-fg` (text) or `--rg-sensitivity-3-bg` (background). */
export function sensitivityToken(level: number, part: "fg" | "bg"): string {
  return `--rg-sensitivity-${level}-${part}`;
}

/**
 * One level's edit on the request boundary (#291), shared by the Admin form and the API. Shape only; whether the
 * label is unique among the five and whether the colours reach contrast need the other levels, see
 * `checkSensitivityLevelEdit`.
 */
export const sensitivityLevelEditSchema = z.object({
  level: z.number().int().min(MIN_SENSITIVITY_LEVEL).max(MAX_SENSITIVITY_LEVEL),
  label: z
    .string()
    .trim()
    .min(1, "Give the level a label.")
    .max(MAX_SENSITIVITY_LABEL_LENGTH, `Keep the label to ${MAX_SENSITIVITY_LABEL_LENGTH} characters.`),
  description: z
    .string()
    .trim()
    .min(1, "Give the level a description.")
    .max(MAX_SENSITIVITY_DESCRIPTION_LENGTH, `Keep the description to ${MAX_SENSITIVITY_DESCRIPTION_LENGTH} characters.`),
  textColor: z.string().trim().refine(isHexColour, "Text colour must be a hex colour in the form #RRGGBB.").transform(normaliseHex),
  backgroundColor: z.string().trim().refine(isHexColour, "Background colour must be a hex colour in the form #RRGGBB.").transform(normaliseHex),
});
export type SensitivityLevelEdit = z.infer<typeof sensitivityLevelEditSchema>;

/**
 * The problems that stop this edit from being saved, each naming the level; empty when it can be saved.
 * `others` are the levels as stored (the edited level's own row is ignored). Labels are unique among the five,
 * ignoring case. A light pair whose derived dark pair misses 4.5:1 is refused too.
 */
export function checkSensitivityLevelEdit(
  edit: SensitivityLevelEdit,
  others: readonly Pick<SensitivityLevelInfo, "level" | "label">[],
): string[] {
  const problems: string[] = [];
  const name = edit.label;
  const clash = others.find((other) => other.level !== edit.level && other.label.trim().toLowerCase() === name.toLowerCase());
  if (clash) problems.push(`${name}: level ${clash.level} already has this label. Labels must be different.`);

  const light = contrastRatio(edit.textColor, edit.backgroundColor);
  if (light < MIN_CONTRAST) {
    problems.push(
      `${name}: contrast is ${formatRatio(light)}. WCAG AA needs ${MIN_CONTRAST}:1, so this pair can't be saved. Darken the text or lighten the background.`,
    );
  } else {
    const dark = deriveDark(edit.textColor, edit.backgroundColor);
    if (dark.ratio < MIN_CONTRAST) {
      problems.push(
        `${name}: the dark mode colours derived from this pair have contrast ${formatRatio(dark.ratio)}, under ${MIN_CONTRAST}:1. Pick a different pair.`,
      );
    }
  }
  return problems;
}
