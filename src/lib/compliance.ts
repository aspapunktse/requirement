import type { Prisma, ControlAssessmentStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getApplicableControls } from "@/lib/control-assessments";

/**
 * Statuses that count as "resolved" (not an open gap) for compliance
 * percentage: Fulfilled, or a deliberate risk-accepted decision (Waived/
 * Not Applicable) — both already require justification and Risk-Owner/
 * Admin sign-off. See CONTEXT.md's "Compliance Percentage" entry.
 */
const RESOLVED_STATUSES_LENIENT: ControlAssessmentStatus[] = ["FULFILLED", "WAIVED", "NOT_APPLICABLE"];

/** Some Frameworks only accept 100% Fulfilled — no partial credit for Waived/Not Applicable. */
const RESOLVED_STATUSES_STRICT: ControlAssessmentStatus[] = ["FULFILLED"];

export type SystemCompliance = {
  systemId: string;
  systemName: string;
  resolved: number;
  total: number;
  /** Null when `total` is 0 (no applicable mandatory Controls to measure against). */
  percentage: number | null;
};

export type ScopeCompliance = {
  resolved: number;
  total: number;
  percentage: number | null;
  bySystem: SystemCompliance[];
};

function percentageOf(resolved: number, total: number): number | null {
  if (total === 0) return null;
  return Math.round((resolved / total) * 1000) / 10;
}

/**
 * Compliance percentage across the Systems matched by `where`, optionally
 * narrowed to only the Controls mapped to a Requirement of `frameworkId`
 * (and using that Framework's strictComplianceRequired flag to decide which statuses
 * count as resolved). Pooled across every matched System — total resolved
 * ÷ total applicable mandatory assessments, not an average of each
 * System's own percentage — plus each System's own standalone percentage.
 * See #55 / CONTEXT.md's "Compliance Percentage" entry.
 */
export async function getComplianceForSystems(
  where: Prisma.SystemWhereInput,
  options: { frameworkId?: string } = {},
): Promise<ScopeCompliance> {
  const [systems, framework] = await Promise.all([
    prisma.system.findMany({
      where,
      include: { deploymentFacets: true, regulatoryOverlays: true, assessments: true },
    }),
    options.frameworkId
      ? prisma.framework.findUnique({ where: { id: options.frameworkId } })
      : Promise.resolve(null),
  ]);

  const resolvedStatuses = framework?.strictComplianceRequired
    ? RESOLVED_STATUSES_STRICT
    : RESOLVED_STATUSES_LENIENT;

  const bySystem = await Promise.all(
    systems.map(async (system): Promise<SystemCompliance> => {
      const applicable = await getApplicableControls(system);
      const mandatoryIds = applicable.filter((r) => r.mandatory).map((r) => r.id);

      const inScopeIds = options.frameworkId
        ? (
            await prisma.control.findMany({
              where: { id: { in: mandatoryIds }, mappings: { some: { requirement: { frameworkId: options.frameworkId } } } },
              select: { id: true },
            })
          ).map((r) => r.id)
        : mandatoryIds;

      const statusByControlId = new Map(system.assessments.map((a) => [a.controlId, a.status]));
      const resolved = inScopeIds.filter((id) =>
        resolvedStatuses.includes(statusByControlId.get(id) ?? "NOT_STARTED"),
      ).length;

      return {
        systemId: system.id,
        systemName: system.name,
        resolved,
        total: inScopeIds.length,
        percentage: percentageOf(resolved, inScopeIds.length),
      };
    }),
  );

  const resolved = bySystem.reduce((sum, s) => sum + s.resolved, 0);
  const total = bySystem.reduce((sum, s) => sum + s.total, 0);

  return { resolved, total, percentage: percentageOf(resolved, total), bySystem };
}
