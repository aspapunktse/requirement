import type { Prisma, RiskSeverity } from "@prisma/client";
import { EFFECTIVE_SCOPE_SELECT, withEffectiveScope } from "@/lib/effective-framework-scope";
import { prisma } from "@/lib/prisma";
import { controlAppliesToSystem } from "@/lib/control-applicability";
import { effectiveScopeFrameworkIdsForSystems, firstRoundControlIdsForSystems } from "@/lib/first-round";
import { inheritanceSourcesFor, resolveEffectiveStatus, type OwnAssessment } from "@/lib/effective-status";
import { loadOrganizationStatuses, loadProviderSources, toOwnAssessment } from "@/lib/effective-status-data";
import { OPEN_RISK_STATUS } from "@/lib/risk-analysis";
import { computeComparisonScore, type ComparisonClassification, type ComparisonScore } from "@/lib/comparison-score";

/**
 * Loader for the Comparison Score of one or several Systems (#371). The rules are the pure functions in
 * `comparison-score.ts`; this only reads their inputs. It does NO authorization: the routes of the later issues that
 * expose these figures decide who may see which System.
 *
 * Reads: one RepeatableRead transaction of its own, or the caller's transaction client (so a later issue can freeze
 * the figures inside its own transaction), with the queries awaited one after the other. The number of queries
 * depends on neither the number of Controls nor the number of Systems, only on which tables have rows (a step that
 * finds nothing skips the rest of its chain). Every helper it calls takes the client.
 *
 * A Control is a first-round Control of a System when `firstRoundControlIdsForSystems` says so (marked by the owner of
 * a Published Framework in the System's effective scope, still mapped to it) AND it applies to the System
 * (`controlAppliesToSystem`: Per-System or Both, in scope, facet and Impact Level thresholds met). An Organizational
 * Control has no per-System Assessment and never applies in that sense, so it is not part of the score (flagged for the
 * product owner). Its status is its effective status: the System's own Assessment (none = Not Started), the
 * Organization's implementation and the Providers' Offerings, exactly as `getSystemAssessments` composes them.
 *
 * "Open" Risk means what it means everywhere else in the app (`OPEN_RISK_STATUS`, the Open Risks count): status OPEN.
 */

export type ComparisonScoreDb = Pick<
  Prisma.TransactionClient,
  | "system"
  | "framework"
  | "frameworkFirstRoundControl"
  | "controlMapping"
  | "requirement"
  | "control"
  | "controlAssessment"
  | "organizationControlImplementation"
  | "providerDependency"
  | "controlOffering"
  | "risk"
>;

export type OpenRisksBySeverity = Record<RiskSeverity, number>;

export type SystemComparisonFigures = ComparisonScore & {
  systemId: string;
  name: string;
  openRisks: OpenRisksBySeverity;
  /** What `classificationDifferences` compares. */
  classification: ComparisonClassification;
};

/**
 * The Comparison figures of the Systems in `systemIds`, by System id. A System id that does not exist is left out
 * of the map (no error): the caller decides what a missing Candidate means. An empty list gives an empty map.
 * Pass a transaction client to read in the caller's snapshot; without one the reads run in a RepeatableRead transaction.
 */
export function loadComparisonScores(systemIds: string[], db?: ComparisonScoreDb): Promise<Map<string, SystemComparisonFigures>> {
  const ids = [...new Set(systemIds)];
  if (db) return readComparisonScores(db, ids);
  return prisma.$transaction((tx) => readComparisonScores(tx, ids), { isolationLevel: "RepeatableRead", timeout: 30_000 });
}

async function readComparisonScores(db: ComparisonScoreDb, systemIds: string[]) {
  const result = new Map<string, SystemComparisonFigures>();
  if (systemIds.length === 0) return result;

  const systems = (await db.system.findMany({
    where: { id: { in: systemIds } },
    select: {
      id: true,
      name: true,
      sensitivityLevel: true,
      integrityImpactLevel: true,
      availabilityImpactLevel: true,
      deploymentFacets: { select: { id: true } },
      ...EFFECTIVE_SCOPE_SELECT,
    },
  })).map(withEffectiveScope);
  if (systems.length === 0) return result;
  const existingIds = systems.map((system) => system.id);

  const scopeBySystem = await effectiveScopeFrameworkIdsForSystems(existingIds, db);
  const firstRoundBySystem = await firstRoundControlIdsForSystems(existingIds, { db, scopeBySystem });
  const firstRoundIds = [...new Set([...firstRoundBySystem.values()].flatMap((ids) => [...ids]))];

  const controls =
    firstRoundIds.length === 0
      ? []
      : await db.control.findMany({
          where: { id: { in: firstRoundIds } },
          select: {
            id: true,
            code: true,
            title: true,
            mandatory: true,
            applicability: true,
            minSensitivityLevel: true,
            minIntegrityImpactLevel: true,
            minAvailabilityImpactLevel: true,
            deploymentFacets: { select: { id: true } },
            mappings: { select: { requirement: { select: { framework: { select: { id: true, status: true, isBase: true } } } } } },
          },
        });
  const assessments =
    controls.length === 0
      ? []
      : await db.controlAssessment.findMany({
          where: { systemId: { in: existingIds }, controlId: { in: controls.map((control) => control.id) } },
          select: { systemId: true, controlId: true, status: true, assessedById: true },
        });
  const organizationStatuses = await loadOrganizationStatuses(
    controls.filter((control) => control.applicability === "BOTH").map((control) => control.id),
    db,
  );
  const providerSources = await loadProviderSources(existingIds, controls.map((control) => control.id), db);

  const ownBySystemControl = new Map<string, NonNullable<OwnAssessment>>(
    assessments.map((assessment) => [`${assessment.systemId}|${assessment.controlId}`, toOwnAssessment(assessment)]),
  );

  const riskRows = await db.risk.groupBy({
    by: ["systemId", "severity"],
    where: { systemId: { in: existingIds }, status: OPEN_RISK_STATUS },
    _count: { _all: true },
  });
  const openRisksBySystem = new Map<string, OpenRisksBySeverity>();
  for (const row of riskRows) {
    if (row.systemId === null) continue;
    const counts = openRisksBySystem.get(row.systemId) ?? { LOW: 0, MEDIUM: 0, HIGH: 0, CRITICAL: 0 };
    counts[row.severity] = row._count._all;
    openRisksBySystem.set(row.systemId, counts);
  }

  for (const system of systems) {
    const firstRound = firstRoundBySystem.get(system.id) ?? new Set<string>();
    const rows = controls
      .filter((control) => firstRound.has(control.id) && controlAppliesToSystem(control, system))
      .map((control) => ({
        controlId: control.id,
        code: control.code,
        title: control.title,
        mandatory: control.mandatory,
        status: resolveEffectiveStatus(
          ownBySystemControl.get(`${system.id}|${control.id}`) ?? null,
          inheritanceSourcesFor(control, organizationStatuses.get(control.id), providerSources.get(system.id)?.get(control.id)),
        ).status,
      }));
    result.set(system.id, {
      ...computeComparisonScore(rows),
      systemId: system.id,
      name: system.name,
      openRisks: openRisksBySystem.get(system.id) ?? { LOW: 0, MEDIUM: 0, HIGH: 0, CRITICAL: 0 },
      classification: {
        deploymentFacetIds: system.deploymentFacets.map((facet) => facet.id),
        sensitivityLevel: system.sensitivityLevel,
        integrityImpactLevel: system.integrityImpactLevel,
        availabilityImpactLevel: system.availabilityImpactLevel,
        frameworkScopeIds: scopeBySystem.get(system.id) ?? [],
      },
    });
  }
  return result;
}
