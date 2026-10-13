import type { ControlApplicability, Prisma } from "@prisma/client";
import { logChangeEvent, SYSTEM_ACTOR } from "@/lib/change-events";
import { describeOwnEditEffect, effectiveSourceLabel } from "@/lib/effective-status";
import { loadEffectiveStatus, toOwnAssessment } from "@/lib/effective-status-data";
import { getOrganizationControl } from "@/lib/organization-implementation";
import { saveOrganizationImplementationIn } from "@/lib/organization-inheritance";
import { runProviderAssessmentWriteIn } from "@/lib/provider-inheritance";
import { checkUpFindingPath, nonconformityRiskText, overrideNote, setBackNote, type SetBackOutcome } from "@/lib/check-up-nonconformity-rules";

/**
 * What a Nonconformity does (PRD 0001 F-IA.7, F-CE.2, #157), inside the evaluation's transaction and
 * on its client only (no query on the global client: a second connection would starve CI's pool of
 * three while this transaction holds the Check-up's lock, and the work must commit or roll back with
 * the evaluation):
 *
 * 1. opens one Risk linked to the Check-up, whatever the target's status: on the System for a
 *    System-level Check-up, with no System for an Organization-level one;
 * 2. sets the target to In Progress, as follows (cases):
 *    - a System's stored Assessment is Fulfilled: set back, notes appended, kept person-set;
 *    - a System with no row, or a row nobody set that is not Fulfilled, that is effectively Fulfilled only
 *      through an Organization or Full Provider source (product-owner decision 21b of 2026-10-13, comment
 *      on #157): its own person-set In Progress is written (row created if missing), overriding the source.
 *      A person-set non-Fulfilled row can't be here (the System's own status wins in `resolveEffectiveStatus`),
 *      and a Shared source gives credit only when the own row is Fulfilled, the first case;
 *    - the Organization Control Implementation is Fulfilled: set back, the existing save path and events;
 *    - anything else (not Fulfilled and not effectively Fulfilled) is left exactly as it is.
 *    The Risk's description says what was done. A Provider's dependents read its OWN stored status, so
 *    overriding an inherited-only Provider row (stored not Fulfilled) never moves them; they are handled by
 *    the same `runProviderAssessmentWriteIn` path regardless.
 *
 * Conforming and Observation never reach here.
 *
 * "A person set it". `resolveEffectiveStatus` treats a row nobody set (`assessedById` null) as
 * following its sources: written In Progress with no person, a System whose Fulfilled row was left
 * by a migration (assessedById null) would become effectively Fulfilled again through a Fulfilled
 * Organization or Full Provider source, which is exactly what a finding must not allow. So the
 * set-back of a System's Assessment keeps the row person-set: an existing `assessedById` is left
 * as it is, and a null one becomes the evaluating Internal Auditor (a real person whose finding
 * this is; they cannot be deleted, their evaluation keeps them Restrict; product-owner decision 23a of
 * 2026-10-13, comment on #157; "reset to inherited" stays allowed on such a row, 22a). Nothing else about
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
        // Fulfilled only through a source (decision 21b): write the System's own In Progress, person-set. Only a
        // row nobody set, or no row, can be here: a person-set non-Fulfilled status always wins over a source.
        const source = effectiveSourceLabel(effective);
        const now = new Date();
        await db.controlAssessment.upsert({
          where: { systemId_controlId: { systemId: system.id, controlId: control.id } },
          create: {
            systemId: system.id,
            controlId: control.id,
            status: "IN_PROGRESS",
            notes: overrideNote(auditTitle, finding, source),
            assessedById: actorId,
            assessedAt: now,
          },
          update: {
            status: "IN_PROGRESS",
            notes: appendNote(row?.notes ?? null, overrideNote(auditTitle, finding, source)),
            ...(row?.assessedById == null && { assessedById: actorId, assessedAt: now }),
          },
        });
        await logChangeEvent(
          system.id,
          "ASSESSMENT_STATUS_CHANGED",
          `${control.code} status was inherited (${source}) and is now this System's own IN_PROGRESS because of an Internal Audit Nonconformity (${finding})`,
          SYSTEM_ACTOR,
          db,
        );
        return { kind: "INHERITED_OVERRIDDEN", status, source };
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
