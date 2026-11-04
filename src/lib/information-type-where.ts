import { isBelowInformationTypes } from "@/lib/information-type-floor";

/**
 * "Where can I put this information?" (#305, ADR 0012), pure and Prisma-free so the loader (which counts over every
 * System) and the page (which lists the Systems the viewer may see) apply one rule.
 *
 * For one Information Type, a System falls in exactly one group:
 * - "declared": it declares the type. Marked "Below its Information Types" when its level is declared and lower than
 *   the type's; otherwise "Declared".
 * - "hold" (may hold it): it does not declare the type and its level is at or above the type's (equal counts).
 * - "below" (below it, so no): it does not declare the type and its level is lower than the type's, or not declared at
 *   all (a System with no level never may hold anything).
 * "May hold it" is about the level only: the owner still has to declare the type on the System's Profile.
 */

export type WhereGroup = "declared" | "hold" | "below";

/** A System as the rule needs it. */
export type WhereSystemFacts = { sensitivityLevel: number | null; declares: boolean };

export function whereGroupOf(typeLevel: number, system: WhereSystemFacts): WhereGroup {
  if (system.declares) return "declared";
  return system.sensitivityLevel !== null && system.sensitivityLevel >= typeLevel ? "hold" : "below";
}

/** A declaring System whose level is below the type's: the same "below its Information Types" the System page flags. */
export function declaresBelow(type: { id: string; name: string; sensitivityLevel: number }, level: number | null): boolean {
  return isBelowInformationTypes(level, [type]);
}

/**
 * How many Systems fall in each group, how many of the declaring ones are below the type's level, and how many Systems
 * (declaring or not) have a level at or above it: the figure the summary line calls "may hold it".
 */
export type WhereCounts = { declared: number; hold: number; below: number; declaredBelow: number; atOrAbove: number };

export function whereCounts(type: { id: string; name: string; sensitivityLevel: number }, systems: readonly { sensitivityLevel: number | null; typeIds: readonly string[] }[]): WhereCounts {
  const counts: WhereCounts = { declared: 0, hold: 0, below: 0, declaredBelow: 0, atOrAbove: 0 };
  for (const system of systems) {
    const group = whereGroupOf(type.sensitivityLevel, { sensitivityLevel: system.sensitivityLevel, declares: system.typeIds.includes(type.id) });
    counts[group] += 1;
    if (system.sensitivityLevel !== null && system.sensitivityLevel >= type.sensitivityLevel) counts.atOrAbove += 1;
    if (group === "declared" && declaresBelow(type, system.sensitivityLevel)) counts.declaredBelow += 1;
  }
  return counts;
}
