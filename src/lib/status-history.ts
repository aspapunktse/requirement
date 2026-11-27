/**
 * The append-only status history (#456, ADR 0019): one `StatusChange` row each time a Risk's status or a Control Assessment's
 * stored status changes. Every function takes the caller's transaction client (`tx`), so the row commits or rolls back with the
 * status write it records; nothing here uses the global client. There is deliberately no function that updates or deletes a row.
 *
 * - A creation records `from: null`. A write that leaves the status as it was records nothing (`from === to`).
 * - `actorId` is the person whose action caused the change; `null` or `SYSTEM_ACTOR` (the system made it) is stored as null,
 *   since "system" is not a User row.
 * - The Control Assessment's *stored* status is what is recorded. A dependent System's effective status moving because its
 *   Provider's status moved is not a write to that Assessment, so it is not history here (the Change Events still say so).
 */
import type { ControlAssessmentStatus, Prisma, RiskStatus } from "@prisma/client";
import { SYSTEM_ACTOR } from "@/lib/change-events";

type Db = Pick<Prisma.TransactionClient, "statusChange">;

const actorOf = (actorId: string | null | undefined) => (actorId && actorId !== SYSTEM_ACTOR ? actorId : null);

/** True when `from` -> `to` is a change worth a row: a creation (`from` null) always is, a write that keeps the status never is. */
const isChange = (from: string | null, to: string) => from === null || from !== to;

export async function recordRiskStatusChange(
  tx: Db,
  input: { riskId: string; systemId: string | null; from: RiskStatus | null; to: RiskStatus; actorId?: string | null },
): Promise<void> {
  if (!isChange(input.from, input.to)) return;
  await tx.statusChange.create({
    data: { systemId: input.systemId, subjectType: "RISK", subjectId: input.riskId, fromStatus: input.from, toStatus: input.to, actorId: actorOf(input.actorId) },
  });
}

/**
 * One Control Assessment's status change. A creation (`from: null`) is recorded once only: two first touches of the same new
 * row (both read "no row" before either wrote) leave one creation row, not two.
 */
export async function recordAssessmentStatusChange(
  tx: Db,
  input: { assessmentId: string; systemId: string; controlId: string; from: ControlAssessmentStatus | null; to: ControlAssessmentStatus; actorId?: string | null },
): Promise<void> {
  if (!isChange(input.from, input.to)) return;
  if (input.from === null) {
    const already = await tx.statusChange.findFirst({ where: { subjectType: "CONTROL_ASSESSMENT", subjectId: input.assessmentId, fromStatus: null }, select: { id: true } });
    if (already) return;
  }
  await tx.statusChange.create({
    data: {
      systemId: input.systemId,
      subjectType: "CONTROL_ASSESSMENT",
      subjectId: input.assessmentId,
      controlId: input.controlId,
      fromStatus: input.from,
      toStatus: input.to,
      actorId: actorOf(input.actorId),
    },
  });
}

/** Creation rows for Control Assessments just created in bulk (`createManyAndReturn`), in one insert. */
export async function recordAssessmentsCreated(
  tx: Db,
  rows: { id: string; systemId: string; controlId: string; status: ControlAssessmentStatus }[],
  actorId?: string | null,
): Promise<void> {
  if (rows.length === 0) return;
  await tx.statusChange.createMany({
    data: rows.map((r) => ({
      systemId: r.systemId,
      subjectType: "CONTROL_ASSESSMENT" as const,
      subjectId: r.id,
      controlId: r.controlId,
      fromStatus: null,
      toStatus: r.status,
      actorId: actorOf(actorId),
    })),
  });
}

/** A Control Assessment's `upsert` where `update` leaves its status alone (evidence, a Query): returns the row and records its creation if it made one. */
export async function ensureAssessment(
  tx: Prisma.TransactionClient,
  where: { systemId: string; controlId: string },
  actorId: string | null,
): Promise<{ id: string; status: ControlAssessmentStatus }> {
  const previous = await tx.controlAssessment.findUnique({ where: { systemId_controlId: where }, select: { id: true } });
  const saved = await tx.controlAssessment.upsert({
    where: { systemId_controlId: where },
    create: where,
    update: {},
    select: { id: true, status: true },
  });
  if (!previous) await recordAssessmentStatusChange(tx, { assessmentId: saved.id, ...where, from: null, to: saved.status, actorId });
  return saved;
}
