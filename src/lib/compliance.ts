import type { Prisma } from "@prisma/client";
import {
  addDerivedStatusCounts,
  compliancePercentage,
  countRowStatuses,
  deriveStatusesFromData,
  readFrameworkDerivationDataWhere,
  emptyDerivedStatusCounts,
  isFrameworkInEffectiveScope,
  withDerivationSnapshot,
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
 * match (the Framework, the Systems, then the derivation's three). All of them
 * share one snapshot: pass a transaction client to use the caller's, or none to
 * get one RepeatableRead transaction of its own (`withDerivationSnapshot`).
 */
export function getComplianceForSystems(
  where: Prisma.SystemWhereInput,
  options: { frameworkId?: string } = {},
  db?: DerivationDb,
): Promise<ScopeCompliance> {
  return withDerivationSnapshot(db, (tx) => readComplianceForSystems(where, options, tx));
}

/** What the derivation reads of a System: the classification and the Framework Scope, with its name. */
const COMPLIANCE_SYSTEM_SELECT = {
  id: true,
  name: true,
  sensitivityLevel: true,
  integrityImpactLevel: true,
  availabilityImpactLevel: true,
  deploymentFacets: { select: { id: true } },
  frameworkScopes: { select: { id: true } },
} satisfies Prisma.SystemSelect;

type ComplianceSystem = Prisma.SystemGetPayload<{ select: typeof COMPLIANCE_SYSTEM_SELECT }>;

/**
 * `getComplianceForSystems` for Systems the caller has already read (in the same snapshot, with at least
 * the classification, Deployment Facet ids, Framework Scope ids and name of `COMPLIANCE_SYSTEM_SELECT`): the
 * same figures without reading the matched Systems again. `bySystem` follows the order given.
 */
export function getComplianceForLoadedSystems(
  systems: ComplianceSystem[],
  options: { frameworkId?: string } = {},
  db?: DerivationDb,
): Promise<ScopeCompliance> {
  return withDerivationSnapshot(db, (tx) => compliancePooled(systems, options, tx));
}

async function readComplianceForSystems(
  where: Prisma.SystemWhereInput,
  options: { frameworkId?: string },
  db: DerivationDb,
): Promise<ScopeCompliance> {
  const systems = await db.system.findMany({ where, select: COMPLIANCE_SYSTEM_SELECT, orderBy: { createdAt: "asc" } });
  return compliancePooled(systems, options, db);
}

async function compliancePooled(systems: ComplianceSystem[], options: { frameworkId?: string }, db: DerivationDb): Promise<ScopeCompliance> {
  // Sequential: a transaction has one connection. The Framework is found and its derivation data read in one go.
  const data = await readFrameworkDerivationDataWhere(options.frameworkId ? { id: options.frameworkId } : { isBase: true }, db);

  const emptyBySystem = systems.map((s): SystemCompliance => ({
    systemId: s.id,
    systemName: s.name,
    met: 0,
    applicable: 0,
    percentage: null,
  }));
  if (!data) return { framework: null, met: 0, applicable: 0, percentage: null, bySystem: emptyBySystem };
  const framework = data.framework;

  const inScope = systems.filter((s) => isFrameworkInEffectiveScope(framework, s.frameworkScopes));
  const derived = { bySystem: (await deriveStatusesFromData(data, inScope, db)).bySystem };

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
