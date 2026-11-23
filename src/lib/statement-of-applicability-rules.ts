import type { ControlApplicability } from "@prisma/client";

/**
 * What is left of the old per-Control Statement of Applicability (PRD 0001 F-OUT.4, #145): the statement is per Compliance Boundary
 * now (#420, #421), in `boundary-statement.ts`. Pure and Prisma-free (safe to import from client components).
 */

/** How the Control Library and the audit planner name a Control's applicability. */
export const APPLICABILITY_LABEL: Record<ControlApplicability, string> = {
  ORGANIZATIONAL: "Organizational",
  PER_SYSTEM: "Per-System",
  BOTH: "Both",
};

/** Trimmed; blank or null is "cleared" (null). */
export function normalizeExclusionJustification(text: string | null | undefined): string | null {
  const trimmed = text?.trim();
  return trimmed ? trimmed : null;
}
