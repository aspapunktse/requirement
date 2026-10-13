import { prisma } from "@/lib/prisma";
import type { OwnAssessment } from "@/lib/effective-status";
import { loadOrganizationStatuses, loadProviderSources, toOwnAssessment } from "@/lib/effective-status-data";
import {
  deriveStatementOfApplicability,
  type StatementOfApplicabilityRow,
} from "@/lib/statement-of-applicability-rules";

export * from "@/lib/statement-of-applicability-rules";

/**
 * The Statement of Applicability rows (PRD 0001 F-OUT.4, #145), one per Control,
 * in a constant number of queries however many Controls or Systems there are:
 *
 * 1. every Control with its Deployment Facets and its mappings (Requirement code
 *    and Framework);
 * 2. every System with its classification (Facets, Framework Scope, Impact Levels);
 * 3. the Organization's implementation statuses;
 * 4. the Systems' Control Assessments of the Per-System and Both Controls;
 * 5. up to four for the Systems' Provider sources (`loadProviderSources`).
 *
 * Everything else is decided in memory (`deriveStatementOfApplicability`). The
 * rows hold nothing a user may not see: only Published mappings feed the
 * justification, and no Draft Framework's name is read out anywhere.
 */
export async function loadStatementOfApplicability(): Promise<StatementOfApplicabilityRow[]> {
  const [controls, systems] = await Promise.all([
    prisma.control.findMany({
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
          select: {
            requirement: {
              select: {
                code: true,
                framework: { select: { id: true, name: true, version: true, status: true, isBase: true } },
              },
            },
          },
        },
      },
    }),
    prisma.system.findMany({
      select: {
        id: true,
        confidentialityImpactLevel: true,
        integrityImpactLevel: true,
        availabilityImpactLevel: true,
        deploymentFacets: { select: { id: true } },
        frameworkScopes: { select: { id: true } },
      },
    }),
  ]);

  const controlIds = controls.map((control) => control.id);
  const systemControlIds = controls.filter((control) => control.applicability !== "ORGANIZATIONAL").map((control) => control.id);
  const systemIds = systems.map((system) => system.id);

  const [organizationStatusByControlId, assessments, providerSourcesBySystemId] = await Promise.all([
    loadOrganizationStatuses(controlIds),
    systemIds.length === 0 || systemControlIds.length === 0
      ? []
      : prisma.controlAssessment.findMany({
          where: { systemId: { in: systemIds }, controlId: { in: systemControlIds } },
          select: { systemId: true, controlId: true, status: true, assessedById: true },
        }),
    loadProviderSources(systemIds, systemControlIds),
  ]);

  const ownAssessmentsBySystemId = new Map<string, Map<string, NonNullable<OwnAssessment>>>();
  for (const assessment of assessments) {
    const own = ownAssessmentsBySystemId.get(assessment.systemId) ?? new Map<string, NonNullable<OwnAssessment>>();
    own.set(assessment.controlId, toOwnAssessment(assessment));
    ownAssessmentsBySystemId.set(assessment.systemId, own);
  }

  return deriveStatementOfApplicability({
    controls,
    systems,
    organizationStatusByControlId,
    ownAssessmentsBySystemId,
    providerSourcesBySystemId,
  });
}
