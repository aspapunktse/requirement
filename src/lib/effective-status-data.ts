import type { ControlAssessmentStatus, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { OwnAssessment } from "@/lib/effective-status";

/**
 * Loaders for the inputs of `resolveEffectiveStatus` (issue #121); the rules
 * themselves are the pure functions in `effective-status.ts`. One query each,
 * however many Controls or Systems, so the bulk readers keep their constant
 * number of queries.
 */

type OrganizationDb = Pick<Prisma.TransactionClient, "organizationControlImplementation">;

/**
 * The Organization's recorded status for each of `controlIds`, by Control id. A
 * Control with no row is absent from the map and reads as Not Started
 * (`inheritanceSourcesFor`; the missing-row rule of #120).
 */
export async function loadOrganizationStatuses(
  controlIds: string[],
  db: OrganizationDb = prisma,
): Promise<Map<string, ControlAssessmentStatus>> {
  if (controlIds.length === 0) return new Map();
  const rows = await db.organizationControlImplementation.findMany({
    where: { controlId: { in: controlIds } },
    select: { controlId: true, status: true },
  });
  return new Map(rows.map((row) => [row.controlId, row.status]));
}

/** A stored Control Assessment as `resolveEffectiveStatus` wants it: a person set it when `assessedById` is not null. */
export function toOwnAssessment(row: { status: ControlAssessmentStatus; assessedById: string | null }): NonNullable<OwnAssessment> {
  return { status: row.status, personSet: row.assessedById !== null };
}
