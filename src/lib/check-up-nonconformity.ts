import type { ControlApplicability, Prisma } from "@prisma/client";
import { logChangeEvent, SYSTEM_ACTOR } from "@/lib/change-events";
import { describeOwnEditEffect, effectiveSourceLabel } from "@/lib/effective-status";
import { loadEffectiveStatus, toOwnAssessment } from "@/lib/effective-status-data";
import { getOrganizationControl } from "@/lib/organization-implementation";
import { saveOrganizationImplementationIn } from "@/lib/organization-inheritance";
import { runProviderAssessmentWriteIn } from "@/lib/provider-inheritance";
import { checkUpFindingPath, nonconformityRiskText, setBackNote, type SetBackOutcome } from "@/lib/check-up-nonconformity-rules";

/**
 * What a Nonconformity does (PRD 0001 F-IA.7, F-CE.2, #157), inside the evaluation's transaction and
 * on its client only (no query on the global client: a second connection would starve CI's pool of
 * three while this transaction holds the Check-up's lock, and the work must commit or roll back with
 * the evaluation):
 *
 * 1. opens one Risk linked to the Check-up, whatever the target's status: on the System for a
 *    System-level Check-up, with no System for an Organization-level one;
 * 2. sets the target back to In Progress when, and only when, its STORED status is Fulfilled:
 *    a System's own Control Assessment, or the Control's Organization Control Implementation.
 *    Anything else is left exactly as it is, and the Risk's description says what was (not) done.
 *
 * Conforming and Observation never reach here.
 *
 * "A person set it". `resolveEffectiveStatus` treats a row nobody set (`assessedById` null) as
 * following its sources: written In Progress with no person, a System whose Fulfilled row was left
 * by a migration (assessedById null) would become effectively Fulfilled again through a Fulfilled
 * Organization or Full Provider source, which is exactly what a finding must not allow. So the
 * set-back of a System's Assessment keeps the row person-set: an existing `assessedById` is left
 * as it is, and a null one becomes the evaluating Internal Auditor (a real person whose finding
 * this is; they cannot be deleted, their evaluation keeps them Restrict). Nothing else about
 * "person set" needs to change: `toOwnAssessment`, `UNTOUCHED_ASSESSMENT_WHERE` and
 * `resetToInheritedRefusal` all read `assessedById`, so a set-back row is a person-set In Progress
 * row in each of them. The Change Events stay attributed to `SYSTEM_ACTOR`.
 *
 * LOCK ORDER. The evaluation holds the Check-up's row lock (`lockCheckUp`) first. Then, for a
 * Provider: the Provider's advisory lock and the Control's (sorted ids), inside
 * `runProviderAssessmentWriteIn`; for the Organization: the Control's advisory lock
 * (`saveOrganizationImplementationIn`); and last the System's Assessment row (FOR UPDATE).
 * Nothing else takes a Check-up row lock while holding any of those (the response and evaluation
 * writers take the Check-up lock first, and no Assessment, implementation or Provider path
 * touches a Check-up), so no cycle exists.
 */

type Tx = Prisma.TransactionClient;

export type NonconformityInput = {
  tx: Tx;
  checkUpId: string;
  /** The auditor's comment, required for a Nonconformity. */
  comment: string;
  /** The auditor, to whom a null `assessedById` is attributed (see above). */
  actorId: string;
};

export async function applyNonconformity({ tx, checkUpId, comment, actorId }: NonconformityInput): Promise<void> {
  const checkUp = await tx.checkUp.findUniqueOrThrow({
    where: { id: checkUpId },
    select: {
      internalAudit: { select: { title: true } },
      control: { select: { id: true, code: true, title: true, applicability: true } },
      system: { select: { id: true, name: true, isProvider: true } },
    },
  });
  const finding = checkUpFindingPath(checkUpId);
  const auditTitle = checkUp.internalAudit.title;

  const outcome = checkUp.system
    ? await setBackSystemAssessment(tx, checkUp.system, checkUp.control, auditTitle, finding, actorId)
    : await setBackOrganizationImplementation(tx, checkUp.control, auditTitle, finding);

  const text = nonconformityRiskText({
    auditTitle,
    control: checkUp.control,
    systemName: checkUp.system?.name ?? null,
    comment,
    outcome,
    finding,
  });
  await tx.risk.create({
    data: {
      systemId: checkUp.system?.id ?? null,
      checkUpId,
      title: text.title,
      description: text.description,
      // No input at evaluation, so the same defaults as a Risk a "No" Self-Assessment answer opens;
      // the Risk Owner adjusts them. No owner either: the Risk Owner assigns one.
      severity: "MEDIUM",
      likelihood: "MEDIUM",
    },
  });
  await logChangeEvent(
    checkUp.system?.id ?? null,
    "RISK_STATUS_CHANGED",
    `Risk "${text.title}" auto-opened (status: OPEN) from a Nonconformity (${finding})`,
    SYSTEM_ACTOR,
    tx,
  );
}

async function setBackSystemAssessment(
  tx: Tx,
  system: { id: string; name: string; isProvider: boolean },
  control: { id: string; code: string; applicability: ControlApplicability },
  auditTitle: string,
  finding: string,
  actorId: string,
): Promise<SetBackOutcome> {
  return runProviderAssessmentWriteIn(tx, system, control.id, async (db): Promise<SetBackOutcome> => {
    // Serialise with a person editing this very row; the Provider and Control locks are already ours.
    await db.$queryRaw`SELECT "id" FROM "ControlAssessment" WHERE "systemId" = ${system.id} AND "controlId" = ${control.id} FOR UPDATE`;
    const row = await db.controlAssessment.findUnique({ where: { systemId_controlId: { systemId: system.id, controlId: control.id } } });
    if (!row || row.status !== "FULFILLED") {
      const status = row?.status ?? "NOT_STARTED";
      const effective = await loadEffectiveStatus(system.id, control, row ? toOwnAssessment(row) : null, db);
      if (effective.status === "FULFILLED" && effective.source.kind !== "SYSTEM") {
        return { kind: "INHERITED_ONLY", status, source: effectiveSourceLabel(effective) };
      }
      return { kind: "NOT_FULFILLED", status };
    }

    const saved = await db.controlAssessment.update({
      where: { id: row.id },
      data: {
        status: "IN_PROGRESS",
        notes: appendNote(row.notes, setBackNote(auditTitle, finding)),
        // Keep it person-set (see the module comment).
        ...(row.assessedById === null && { assessedById: actorId, assessedAt: new Date() }),
      },
    });
    const effect = describeOwnEditEffect("IN_PROGRESS", await loadEffectiveStatus(system.id, control, toOwnAssessment(saved), db));
    await logChangeEvent(
      system.id,
      "ASSESSMENT_STATUS_CHANGED",
      `${control.code} status changed from FULFILLED to IN_PROGRESS (Internal Audit Nonconformity, ${finding}${effect ? `; ${effect}` : ""})`,
      SYSTEM_ACTOR,
      db,
    );
    return { kind: "SET_BACK" };
  });
}

async function setBackOrganizationImplementation(
  tx: Tx,
  control: { id: string },
  auditTitle: string,
  finding: string,
): Promise<SetBackOutcome> {
  // The Control's lock first, then the read that decides: a person's concurrent edit has finished.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${control.id}))`;
  const organizationControl = await getOrganizationControl(tx, control.id);
  // A Per-System Control has no implementation: there is nothing at Organization level to set back.
  const implementation = organizationControl?.organizationImplementation;
  if (!organizationControl || !implementation || implementation.status !== "FULFILLED") {
    return { kind: "NOT_FULFILLED", status: implementation?.status ?? "NOT_STARTED" };
  }
  await saveOrganizationImplementationIn(
    tx,
    organizationControl,
    { status: "IN_PROGRESS", description: appendNote(implementation.description, setBackNote(auditTitle, finding)) },
    // No person edited it: "last updated by" is left as it was; the events are the system's.
    { userId: null, eventActorId: SYSTEM_ACTOR },
  );
  return { kind: "SET_BACK" };
}

/** Appends `note` after what is there, never replacing what the owner wrote. */
export function appendNote(existing: string | null, note: string): string {
  const current = existing?.trim();
  return current ? `${existing}\n\n${note}` : note;
}
