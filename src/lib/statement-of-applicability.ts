import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { OwnAssessment } from "@/lib/effective-status";
import {
  loadOrganizationStatuses,
  loadProviderSources,
  toOwnAssessment,
} from "@/lib/effective-status-data";
import {
  deriveStatementOfApplicability,
  type StatementInputs,
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
export async function loadStatementOfApplicability(): Promise<
  StatementOfApplicabilityRow[]
> {
  // One REPEATABLE READ snapshot for every read: Prisma runs a nested include as several
  // statements, and a Requirement deleted between them (a curator, the import loader)
  // would otherwise leave a mapping whose required Requirement is gone and throw.
  // Read-only, so there is nothing to retry. Sequential: a transaction has one connection.
  const inputs = await prisma.$transaction(readStatementInputs, {
    isolationLevel: "RepeatableRead",
  });
  return deriveStatementOfApplicability(inputs);
}

/**
 * The reads above, on the caller's transaction client. The page (`statement-of-applicability/soa-data.ts`)
 * calls it inside its own RepeatableRead transaction so its extra reads see the same snapshot.
 */
export async function readStatementInputs(
  tx: Prisma.TransactionClient,
): Promise<StatementInputs> {
  const controls = await tx.control.findMany({
    select: {
      id: true,
      code: true,
      title: true,
      applicability: true,
      soaExclusionJustification: true,
      minConfidentialityImpactLevel: true,
      minIntegrityImpactLevel: true,
      minAvailabilityImpactLevel: true,
      deploymentFacets: { select: { id: true } },
      mappings: {
        select: {
          requirement: {
            select: {
              code: true,
              framework: {
                select: {
                  id: true,
                  name: true,
                  version: true,
                  status: true,
                  isBase: true,
                },
              },
            },
          },
        },
      },
    },
  });
  const systems = await tx.system.findMany({
    select: {
      id: true,
      confidentialityImpactLevel: true,
      integrityImpactLevel: true,
      availabilityImpactLevel: true,
      deploymentFacets: { select: { id: true } },
      frameworkScopes: { select: { id: true } },
    },
  });

  const controlIds = controls.map((control) => control.id);
  const systemControlIds = controls
    .filter((control) => control.applicability !== "ORGANIZATIONAL")
    .map((control) => control.id);
  const systemIds = systems.map((system) => system.id);

  const organizationStatusByControlId = await loadOrganizationStatuses(
    controlIds,
    tx,
  );
  const assessments =
    systemIds.length === 0 || systemControlIds.length === 0
      ? []
      : await tx.controlAssessment.findMany({
          where: {
            systemId: { in: systemIds },
            controlId: { in: systemControlIds },
          },
          select: {
            systemId: true,
            controlId: true,
            status: true,
            assessedById: true,
          },
        });
  const providerSourcesBySystemId = await loadProviderSources(
    systemIds,
    systemControlIds,
    tx,
  );

  const ownAssessmentsBySystemId = new Map<
    string,
    Map<string, NonNullable<OwnAssessment>>
  >();
  for (const assessment of assessments) {
    const own =
      ownAssessmentsBySystemId.get(assessment.systemId) ??
      new Map<string, NonNullable<OwnAssessment>>();
    own.set(assessment.controlId, toOwnAssessment(assessment));
    ownAssessmentsBySystemId.set(assessment.systemId, own);
  }

  return {
    controls,
    systems,
    organizationStatusByControlId,
    ownAssessmentsBySystemId,
    providerSourcesBySystemId,
  };
}
