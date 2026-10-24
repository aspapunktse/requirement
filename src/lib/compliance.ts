import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  addDerivedStatusCounts,
  compliancePercentage,
  countRowStatuses,
  deriveFrameworkStatusesForSystems,
  emptyDerivedStatusCounts,
  isFrameworkInEffectiveScope,
  type DerivationDb,
} from "@/lib/requirement-status";

/**
 * The Requirement-based Compliance Percentage (PRD 0001 F-AS.4, F-OUT.3; #90;
 * CONTEXT.md -> Compliance Percentage), built on the derived Requirement status
 * of #89: for one Framework, Met Requirements ÷ applicable Requirements (every
 * derived status except Not Applicable), with Partially Met counting as not Met.
 * Whether Waived / Not Applicable Assessments count as Fulfilled is decided in
 * the derivation (`isEffectivelyFulfilled`, strict Frameworks), not here.
 */

export type SystemCompliance = {
  systemId: string;
  systemName: string;
  /** Requirements of the Framework derived as Met on this System. */
  met: number;
  /** Requirements of the Framework that are applicable on this System (not Not Applicable). */
  applicable: number;
  /** Null when `applicable` is 0 (nothing to measure against), or the Framework isn't in this System's scope. */
  percentage: number | null;
};

export type ComplianceFramework = {
  id: string;
  name: string;
  version: string;
  isBase: boolean;
  strictComplianceRequired: boolean;
};

export type ScopeCompliance = {
  /** The Framework the figures are for: the filtered one, else the base Framework. Null if there is none. */
  framework: ComplianceFramework | null;
  met: number;
  applicable: number;
  /** Pooled: total Met ÷ total applicable across the Systems, never an average of percentages. Null when `applicable` is 0. */
  percentage: number | null;
  bySystem: SystemCompliance[];
};

/**
 * Compliance percentage across the Systems matched by `where`, for one
 * Framework: `options.frameworkId`, or, with no filter, the **base Framework**.
 * Pooled across every matched System that has the Framework in its effective
 * scope (total Met ÷ total applicable, not an average of each System's own
 * percentage), plus each System's own standalone figure. A matched System
 * without the Framework in scope is listed with 0 applicable and a null
 * percentage and adds nothing to the pool.
 *
 * Uses the bulk derivation: a constant number of queries however many Systems
 * match (the Framework, the Systems, then the derivation's three).
 */
export async function getComplianceForSystems(
  where: Prisma.SystemWhereInput,
  options: { frameworkId?: string } = {},
  // Pass a transaction client to read in the caller's snapshot.
  db: DerivationDb = prisma,
): Promise<ScopeCompliance> {
  const [framework, systems] = await Promise.all([
    db.framework.findFirst({
      where: options.frameworkId ? { id: options.frameworkId } : { isBase: true },
      select: { id: true, name: true, version: true, isBase: true, status: true, strictComplianceRequired: true },
    }),
    db.system.findMany({
      where,
      select: {
        id: true,
        name: true,
        confidentialityImpactLevel: true,
        integrityImpactLevel: true,
        availabilityImpactLevel: true,
        deploymentFacets: { select: { id: true } },
        frameworkScopes: { select: { id: true } },
      },
      orderBy: { createdAt: "asc" },
    }),
  ]);

  const emptyBySystem = systems.map((s): SystemCompliance => ({
    systemId: s.id,
    systemName: s.name,
    met: 0,
    applicable: 0,
    percentage: null,
  }));
  if (!framework) return { framework: null, met: 0, applicable: 0, percentage: null, bySystem: emptyBySystem };

  const inScope = systems.filter((s) => isFrameworkInEffectiveScope(framework, s.frameworkScopes));
  const derived = await deriveFrameworkStatusesForSystems(framework.id, inScope, db);

  let pooled = emptyDerivedStatusCounts();
  const bySystem = systems.map((system): SystemCompliance => {
    const rows = derived?.bySystem.get(system.id);
    if (!rows) return { systemId: system.id, systemName: system.name, met: 0, applicable: 0, percentage: null };
    const counts = countRowStatuses(rows);
    pooled = addDerivedStatusCounts(pooled, counts);
    return {
      systemId: system.id,
      systemName: system.name,
      met: counts.MET,
      applicable: counts.applicable,
      percentage: compliancePercentage(counts),
    };
  });

  return {
    framework: {
      id: framework.id,
      name: framework.name,
      version: framework.version,
      isBase: framework.isBase,
      strictComplianceRequired: framework.strictComplianceRequired,
    },
    met: pooled.MET,
    applicable: pooled.applicable,
    percentage: compliancePercentage(pooled),
    bySystem,
  };
}
