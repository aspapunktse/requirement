import { z } from "zod";

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
