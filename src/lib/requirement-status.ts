import type { ControlAssessmentStatus, ControlApplicability, ImpactLevel } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { controlAppliesToSystem, type SystemClassification } from "@/lib/control-assessments";
import { getSystemFrameworkScopes } from "@/lib/framework-scope";
import type { MappingCoverage } from "@/lib/coverage-state";
import {
  inheritanceSourcesFor,
  resolveEffectiveStatus,
  resolveImplementedByOrganization,
  type EffectiveStatus,
  type OwnAssessment,
  type ProviderSource,
} from "@/lib/effective-status";
import { loadOrganizationStatuses, loadProviderSources, toOwnAssessment } from "@/lib/effective-status-data";
import {
  countDerivedStatuses,
  deriveRequirementStatus,
  type DerivationBasis,
  type DerivedRequirementStatus,
  type DerivedStatusCounts,
} from "@/lib/requirement-status-rules";

export * from "@/lib/requirement-status-rules";

/**
 * Derived Requirement status per System (PRD 0001 F-AS.3, OQ-1; issue #89),
 * computed live, never stored. The decision rules are the pure functions in
 * `requirement-status-rules.ts`; this module bulk-loads the data they need.
 *
 * Shape for callers (the Compliance Percentage, #90, pools many Systems):
 *
 * - `deriveFrameworkStatusesForSystems(frameworkId, systems)`: many Systems x
 *   ONE Framework in a constant number of queries (the Framework and its
 *   Requirements with their mapped Controls, the Organization's implementation
 *   statuses of those Controls, then one query for the Systems' Control
 *   Assessments and the few that load the Systems' Provider sources, #124),
 *   never a query per System or per Requirement.
 *   Whether a mapped Control counts for a System is decided in memory:
 *   `controlAppliesToSystem` (which mirrors `getApplicableControls`) for a
 *   Per-System or Both Control, and the Framework being in the System's
 *   effective scope for an Organizational one (#122, `controlCountsForSystem`).
 * - Each mapped Control that counts for the System is judged by its *effective*
 *   status: a Both Control the System hasn't assessed itself is Fulfilled while
 *   the Organization's implementation is (`resolveEffectiveStatus`, #121), a
 *   Per-System or Both Control is Fulfilled while a Full Offering of a Provider
 *   the System depends on is (#124), and an
 *   Organizational Control is whatever the Organization's implementation says
 *   (`resolveImplementedByOrganization`, #122). The stored Assessment status is
 *   never changed or copied.
 * - `countDerivedStatuses(rows.map((r) => r.status))` (from the rules module)
 *   gives per-status counts; Met ÷ `applicable` is the Met ratio, and
 *   `addDerivedStatusCounts` pools Systems (total Met ÷ total applicable).
 * - The caller decides which Systems to include. The derivation treats a
 *   Framework that isn't in a System's effective scope like any other: Controls
 *   mapped only to it don't count there (an Organizational Control never does
 *   outside the Framework's scope), so every Requirement comes out Not
 *   Applicable. Use `isFrameworkInEffectiveScope` to filter Systems first.
 */

export type DerivationSystem = SystemClassification & { id: string };

type DerivationFramework = {
  id: string;
  name: string;
  version: string;
  strictComplianceRequired: boolean;
  /** Needed to tell whether the Framework is in a System's effective scope (an Organizational Control counts only there, #122). */
  status: string;
  isBase: boolean;
};

/** A Requirement's mapped Control, with everything needed to decide applicability. */
type DerivationControl = {
  id: string;
  code: string;
  title: string;
  coverage: MappingCoverage;
  applicability: ControlApplicability;
  deploymentFacets: { id: string }[];
  minConfidentialityImpactLevel: ImpactLevel | null;
  minIntegrityImpactLevel: ImpactLevel | null;
  minAvailabilityImpactLevel: ImpactLevel | null;
  mappings: { requirement: { framework: { id: string; status: string; isBase: boolean } } }[];
};

/** The System-independent half of the derivation for one Framework. */
export type FrameworkDerivationData = {
  framework: DerivationFramework;
  requirements: {
    id: string;
    code: string;
    section: string;
    title: string;
    gapAcceptedAt: Date | null;
    controls: DerivationControl[];
  }[];
  /** Every Control mapped to any of the Framework's Requirements. */
  controlIds: string[];
  /**
   * The Organization's implementation status of those Controls (#121, #122). A
   * Control with no row is absent and reads as Not Started; it only matters for
   * Both and Organizational Controls.
   */
  organizationStatusByControlId: ReadonlyMap<string, ControlAssessmentStatus>;
};

/** One mapped Control of a Requirement, for one System. */
export type DerivedRequirementControl = {
  controlId: string;
  code: string;
  title: string;
  coverage: MappingCoverage;
  /** Does this Control count for the System? (A Per-System/Both Control that applies, or an Organizational Control while the Framework is in scope.) */
  applicable: boolean;
  /**
   * The System's own stored Assessment status; null = no row yet (counts as Not
   * Started). Null too when not applicable, and for an Organizational Control,
   * which has no per-System Assessment.
   */
  assessmentStatus: ControlAssessmentStatus | null;
  /**
   * The status the derivation judges: the own status, Fulfilled through
   * inheritance (#121), or the Organization's implementation status for an
   * Organizational Control (#122). Null when not applicable.
   */
  effective: EffectiveStatus | null;
};

/** A Requirement with its derived status for one System, plain JSON (safe to pass to a client component). */
export type DerivedRequirementRow = {
  requirementId: string;
  code: string;
  section: string;
  title: string;
  status: DerivedRequirementStatus;
  basis: DerivationBasis;
  gapAccepted: boolean;
  controls: DerivedRequirementControl[];
};

/**
 * Does a mapped Control count for the System when deriving a Requirement of the
 * Framework? A Per-System or Both Control does when it applies to the System
 * (`controlAppliesToSystem`). An Organizational Control is implemented once by
 * the Organization, so for every System it counts exactly while the Requirement's
 * Framework is Published and in the System's effective scope; Deployment Facets
 * and Impact Levels don't apply to it (#122). It still gets no Control
 * Assessment: `controlAppliesToSystem` and `getApplicableControls` keep excluding
 * it, because they decide what a System assesses.
 */
export function controlCountsForSystem(
  control: Parameters<typeof controlAppliesToSystem>[0],
  system: SystemClassification,
  frameworkInScope: boolean,
): boolean {
  return control.applicability === "ORGANIZATIONAL" ? frameworkInScope : controlAppliesToSystem(control, system);
}

const byNumericText = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true });

/**
 * Load a Framework and, per Requirement, its mapped Controls, plus the
 * Organization's implementation status of those Controls, in a constant number
 * of queries regardless of size.
 */
export async function loadFrameworkDerivationData(frameworkId: string): Promise<FrameworkDerivationData | null> {
  const framework = await prisma.framework.findUnique({
    where: { id: frameworkId },
    select: {
      id: true,
      name: true,
      version: true,
      strictComplianceRequired: true,
      status: true,
      isBase: true,
      requirements: {
        select: {
          id: true,
          code: true,
          section: true,
          title: true,
          gapAcceptedAt: true,
          mappings: {
            orderBy: { control: { code: "asc" } },
            select: {
              coverage: true,
              control: {
                select: {
                  id: true,
                  code: true,
                  title: true,
                  applicability: true,
                  minConfidentialityImpactLevel: true,
                  minIntegrityImpactLevel: true,
                  minAvailabilityImpactLevel: true,
                  deploymentFacets: { select: { id: true } },
                  mappings: {
                    select: { requirement: { select: { framework: { select: { id: true, status: true, isBase: true } } } } },
                  },
                },
              },
            },
          },
        },
      },
    },
  });
  if (!framework) return null;

  const requirements = framework.requirements
    .map((requirement) => ({
      id: requirement.id,
      code: requirement.code,
      section: requirement.section,
      title: requirement.title,
      gapAcceptedAt: requirement.gapAcceptedAt,
      controls: requirement.mappings.map((mapping) => ({ ...mapping.control, coverage: mapping.coverage })),
    }))
    .sort((a, b) => byNumericText(a.section, b.section) || byNumericText(a.code, b.code));

  const controlIds = [...new Set(requirements.flatMap((requirement) => requirement.controls.map((c) => c.id)))];
  return {
    framework: {
      id: framework.id,
      name: framework.name,
      version: framework.version,
      strictComplianceRequired: framework.strictComplianceRequired,
      status: framework.status,
      isBase: framework.isBase,
    },
    requirements,
    controlIds,
    organizationStatusByControlId: await loadOrganizationStatuses(controlIds),
  };
}

/**
 * The derivation for one System, in memory: every Requirement of the Framework
 * with its derived status and the mapped Controls behind it.
 * `ownAssessmentByControlId` holds the System's own Assessment rows; a Control
 * with no row counts as an untouched Not Started one. Each Control is judged by
 * its effective status (#121, #122), through `resolveEffectiveStatus` or, for an
 * Organizational Control, `resolveImplementedByOrganization`.
 * `providerSourcesByControlId` holds the Offerings of the Providers the System
 * depends on (`loadProviderSources`, #124), by Control id; a Control without
 * an entry has no Provider source.
 */
export function deriveRequirementRowsForSystem(
  data: FrameworkDerivationData,
  system: SystemClassification,
  ownAssessmentByControlId: ReadonlyMap<string, NonNullable<OwnAssessment>>,
  providerSourcesByControlId: ReadonlyMap<string, ProviderSource[]> = new Map(),
): DerivedRequirementRow[] {
  // A Control appears under several Requirements: decide whether it counts once.
  const frameworkInScope = isFrameworkInEffectiveScope(data.framework, system.frameworkScopes);
  const applicableByControlId = new Map<string, boolean>();
  const applies = (control: DerivationControl) => {
    let value = applicableByControlId.get(control.id);
    if (value === undefined) {
      value = controlCountsForSystem(control, system, frameworkInScope);
      applicableByControlId.set(control.id, value);
    }
    return value;
  };

  return data.requirements.map((requirement) => {
    const controls: DerivedRequirementControl[] = requirement.controls.map((control) => {
      const applicable = applies(control);
      const own = ownAssessmentByControlId.get(control.id);
      return {
        controlId: control.id,
        code: control.code,
        title: control.title,
        coverage: control.coverage,
        applicable,
        assessmentStatus: applicable && control.applicability !== "ORGANIZATIONAL" ? (own?.status ?? "NOT_STARTED") : null,
        effective: !applicable
          ? null
          : control.applicability === "ORGANIZATIONAL"
            ? resolveImplementedByOrganization(data.organizationStatusByControlId.get(control.id))
            : resolveEffectiveStatus(
                own ?? null,
                inheritanceSourcesFor(
                  control,
                  data.organizationStatusByControlId.get(control.id),
                  providerSourcesByControlId.get(control.id),
                ),
              ),
      };
    });
    const { status, basis } = deriveRequirementStatus({
      framework: data.framework,
      mappings: controls.map((c) => ({ coverage: c.coverage, applicable: c.applicable, status: c.effective?.status ?? null })),
      gapAcceptedAt: requirement.gapAcceptedAt,
    });
    return {
      requirementId: requirement.id,
      code: requirement.code,
      section: requirement.section,
      title: requirement.title,
      status,
      basis,
      gapAccepted: requirement.gapAcceptedAt !== null,
      controls,
    };
  });
}

/**
 * Derived Requirement rows for many Systems x one Framework, from bulk-loaded
 * data (a constant number of queries, however many Systems). Returns null if the
 * Framework doesn't exist; otherwise a Map with an entry for every System given.
 * This is the function the Requirement-based Compliance Percentage (#90) builds on.
 */
export async function deriveFrameworkStatusesForSystems(frameworkId: string, systems: DerivationSystem[]) {
  const data = await loadFrameworkDerivationData(frameworkId);
  if (!data) return null;

  const systemIds = systems.map((s) => s.id);
  const [assessments, providerSources] = await Promise.all([
    systems.length === 0 || data.controlIds.length === 0
      ? []
      : prisma.controlAssessment.findMany({
          where: { systemId: { in: systemIds }, controlId: { in: data.controlIds } },
          select: { systemId: true, controlId: true, status: true, assessedById: true },
        }),
    loadProviderSources(systemIds, data.controlIds),
  ]);
  const assessmentsBySystem = new Map<string, Map<string, NonNullable<OwnAssessment>>>();
  for (const assessment of assessments) {
    const own = assessmentsBySystem.get(assessment.systemId) ?? new Map<string, NonNullable<OwnAssessment>>();
    own.set(assessment.controlId, toOwnAssessment(assessment));
    assessmentsBySystem.set(assessment.systemId, own);
  }

  const bySystem = new Map<string, DerivedRequirementRow[]>(
    systems.map((system) => [
      system.id,
      deriveRequirementRowsForSystem(
        data,
        system,
        assessmentsBySystem.get(system.id) ?? new Map(),
        providerSources.get(system.id) ?? new Map(),
      ),
    ]),
  );
  return { framework: data.framework, bySystem };
}

/** Per-status counts of one System's rows (Met ÷ `applicable` is its Met ratio). */
export function countRowStatuses(rows: Pick<DerivedRequirementRow, "status">[]): DerivedStatusCounts {
  return countDerivedStatuses(rows.map((row) => row.status));
}

/**
 * Is `framework` in the System's effective Framework Scope: Published, and either
 * the base Framework (always in scope) or declared in the System's scope rows.
 */
export function isFrameworkInEffectiveScope(
  framework: { id: string; status: string; isBase: boolean },
  declaredScopes: { id: string }[],
): boolean {
  return framework.status === "PUBLISHED" && (framework.isBase || declaredScopes.some((s) => s.id === framework.id));
}

export type SystemFrameworkRequirements = {
  framework: Pick<DerivationFramework, "id" | "name" | "version" | "strictComplianceRequired" | "isBase">;
  counts: DerivedStatusCounts;
  rows: DerivedRequirementRow[];
};

/**
 * The per-Framework view's data for one System (`/systems/[id]`, F-OUT.2):
 * for each Published Framework in its effective scope (declared rows plus the
 * base; Draft Frameworks are inert and left out), its Requirements with
 * derived status and the mapped Controls behind each.
 */
export async function getSystemFrameworkRequirements(system: DerivationSystem): Promise<SystemFrameworkRequirements[]> {
  const scoped = (await getSystemFrameworkScopes(system.id)).filter((framework) => framework.status === "PUBLISHED");
  const results = await Promise.all(
    scoped.map(async (framework) => {
      const derived = await deriveFrameworkStatusesForSystems(framework.id, [system]);
      const rows = derived?.bySystem.get(system.id) ?? [];
      return {
        framework: {
          id: framework.id,
          name: framework.name,
          version: framework.version,
          strictComplianceRequired: framework.strictComplianceRequired,
          isBase: framework.isBase,
        },
        counts: countRowStatuses(rows),
        rows,
      };
    }),
  );
  return results;
}
