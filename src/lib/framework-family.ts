// Pure Framework family derivation for the Framework list (#266, product-owner decision 1a). No Prisma, so
// it is safe to import from client components. There is no family in the schema: it is read from the name.

/** The group of the base Framework, which is always on its own. */
export const BASE_GROUP = "Base Framework";
/** The group of every Framework that is neither the base nor a numbered level of a family. */
export const OTHER_GROUP = "Other Frameworks";

const LEVEL_NAME = /^(.*\S)\s+Level\s+(\d+)$/;

export type FrameworkFamily = {
  /** The group a Framework belongs to: "Base Framework", the family name, or "Other Frameworks". */
  group: string;
  /** The family name, e.g. "CMMC" for "CMMC Level 2"; null for the base and for a Framework outside any family. */
  family: string | null;
  /** The level of a family member ("CMMC Level 2" is 2); null otherwise. */
  level: number | null;
};

/**
 * A name ending " Level <n>" belongs to the family before it ("CMMC Level 2" is level 2 of CMMC, "DEF STAN
 * 05-138 Level 3" level 3 of DEF STAN 05-138). The base Framework is its own group whatever it is called.
 */
export function frameworkFamily(framework: { name: string; isBase: boolean }): FrameworkFamily {
  if (framework.isBase) return { group: BASE_GROUP, family: null, level: null };
  const match = LEVEL_NAME.exec(framework.name.trim());
  if (!match) return { group: OTHER_GROUP, family: null, level: null };
  return { group: match[1], family: match[1], level: Number(match[2]) };
}

/**
 * The Framework list's default order: the base Framework first, then by name (a family by its name), a
 * family's members by level, and a version by number last.
 */
export function compareFrameworksDefault(
  a: { name: string; version: string; isBase: boolean; family: string | null; level: number | null },
  b: { name: string; version: string; isBase: boolean; family: string | null; level: number | null },
): number {
  const text = (f: typeof a) => (f.family ?? f.name).toLowerCase();
  return (
    Number(b.isBase) - Number(a.isBase) ||
    text(a).localeCompare(text(b)) ||
    (a.level ?? 0) - (b.level ?? 0) ||
    a.name.localeCompare(b.name) ||
    a.version.localeCompare(b.version, undefined, { numeric: true })
  );
}

/**
 * When a Framework last changed (decision 2a): the latest of its own creation, its Requirements' `updatedAt` and
 * their Control Mappings' `updatedAt`. There is no `updatedAt` on the Framework itself. A deletion leaves no trace here.
 */
export function latestChange(createdAt: Date, changes: (Date | null)[]): Date {
  return changes.reduce<Date>((latest, change) => (change && change > latest ? change : latest), createdAt);
}
