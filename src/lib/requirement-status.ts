import type { ControlAssessmentStatus, ControlApplicability, ImpactLevel } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { controlAppliesToSystem, type SystemClassification } from "@/lib/control-assessments";
import { getSystemFrameworkScopes } from "@/lib/framework-scope";
import type { MappingCoverage } from "@/lib/coverage-state";
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
 *   Requirements with their mapped Controls, then one query for the Systems'
 *   Control Assessments), never a query per System or per Requirement.
 *   Applicability is decided in memory by `controlAppliesToSystem`, which
 *   mirrors `getApplicableControls`.
 * - `countDerivedStatuses(rows.map((r) => r.status))` (from the rules module)
 *   gives per-status counts; Met ÷ `applicable` is the Met ratio, and
 *   `addDerivedStatusCounts` pools Systems (total Met ÷ total applicable).
 * - The caller decides which Systems to include. The derivation treats a
 *   Framework that isn't in a System's effective scope like any other: Controls
 *   mapped only to it don't apply there, so every Requirement comes out Not
 *   Applicable. Use `isFrameworkInEffectiveScope` to filter Systems first.
 */

export type DerivationSystem = SystemClassification & { id: string };

type DerivationFramework = { id: string; name: string; version: string; strictComplianceRequired: boolean };

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
};

/** One mapped Control of a Requirement, for one System. */
export type DerivedRequirementControl = {
  controlId: string;
  code: string;
  title: string;
  coverage: MappingCoverage;
  applicable: boolean;
  /** The System's Assessment status; null = no row yet (counts as Not Started). Null too when not applicable. */
  assessmentStatus: ControlAssessmentStatus | null;
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

const byNumericText = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true });

/** Load a Framework and, per Requirement, its mapped Controls. Two queries regardless of size. */
export async function loadFrameworkDerivationData(frameworkId: string): Promise<FrameworkDerivationData | null> {
  const framework = await prisma.framework.findUnique({
    where: { id: frameworkId },
    select: {
      id: true,
      name: true,
      version: true,
      strictComplianceRequired: true,
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

  return {
    framework: {
      id: framework.id,
      name: framework.name,
      version: framework.version,
      strictComplianceRequired: framework.strictComplianceRequired,
    },
    requirements,
    controlIds: [...new Set(requirements.flatMap((requirement) => requirement.controls.map((c) => c.id)))],
  };
}

/**
 * The derivation for one System, in memory: every Requirement of the Framework
 * with its derived status and the mapped Controls behind it.
 * `assessmentStatusByControlId` holds the System's Assessment rows; a Control
 * with no row counts as Not Started.
 */
export function deriveRequirementRowsForSystem(
  data: FrameworkDerivationData,
  system: SystemClassification,
  assessmentStatusByControlId: ReadonlyMap<string, ControlAssessmentStatus>,
): DerivedRequirementRow[] {
  // A Control appears under several Requirements: decide its applicability once.
  const applicableByControlId = new Map<string, boolean>();
  const applies = (control: DerivationControl) => {
    let value = applicableByControlId.get(control.id);
    if (value === undefined) {
      value = controlAppliesToSystem(control, system);
      applicableByControlId.set(control.id, value);
    }
    return value;
  };

  return data.requirements.map((requirement) => {
    const controls: DerivedRequirementControl[] = requirement.controls.map((control) => {
      const applicable = applies(control);
      return {
        controlId: control.id,
        code: control.code,
        title: control.title,
        coverage: control.coverage,
        applicable,
        assessmentStatus: applicable ? (assessmentStatusByControlId.get(control.id) ?? "NOT_STARTED") : null,
      };
    });
    const { status, basis } = deriveRequirementStatus({
      framework: data.framework,
      mappings: controls.map((c) => ({ coverage: c.coverage, applicable: c.applicable, status: c.assessmentStatus })),
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
 * data (three queries in total, however many Systems). Returns null if the
 * Framework doesn't exist; otherwise a Map with an entry for every System given.
 * This is the function the Requirement-based Compliance Percentage (#90) builds on.
 */
export async function deriveFrameworkStatusesForSystems(frameworkId: string, systems: DerivationSystem[]) {
  const data = await loadFrameworkDerivationData(frameworkId);
  if (!data) return null;

  const assessments =
    systems.length === 0 || data.controlIds.length === 0
      ? []
      : await prisma.controlAssessment.findMany({
          where: { systemId: { in: systems.map((s) => s.id) }, controlId: { in: data.controlIds } },
          select: { systemId: true, controlId: true, status: true },
        });
  const statusesBySystem = new Map<string, Map<string, ControlAssessmentStatus>>();
  for (const assessment of assessments) {
    const statuses = statusesBySystem.get(assessment.systemId) ?? new Map<string, ControlAssessmentStatus>();
    statuses.set(assessment.controlId, assessment.status);
    statusesBySystem.set(assessment.systemId, statuses);
  }

  const bySystem = new Map<string, DerivedRequirementRow[]>(
    systems.map((system) => [
      system.id,
      deriveRequirementRowsForSystem(data, system, statusesBySystem.get(system.id) ?? new Map()),
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
  framework: DerivationFramework & { isBase: boolean };
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
