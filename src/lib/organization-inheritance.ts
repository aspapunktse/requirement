import type { ControlAssessmentStatus, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { SYSTEM_ACTOR, logChangeEvent } from "@/lib/change-events";
import { controlAppliesToSystem } from "@/lib/control-assessments";
import { scopeForControl } from "@/lib/applicability-recompute";
import {
  describeInheritedStatusChange,
  describeOrganizationImplementationChange,
  inheritanceSourcesFor,
  resolveEffectiveStatus,
  sourceGivesCredit,
} from "@/lib/effective-status";
import { loadProviderSources, toOwnAssessment } from "@/lib/effective-status-data";
import {
  saveOrganizationImplementation,
  type getOrganizationControl,
  type ImplementationEdit,
  type OrganizationControlRow,
} from "@/lib/organization-implementation";

/**
 * Saving an Organization Control Implementation and recording what it moved
 * (PRD 0001 F-IN.7, F-CE.2; issues #121 and #122).
 *
 * Nothing is copied to a System, so there is nothing to update on one: the
 * effective status is derived live and already reflects the new status. What
 * this adds is the record. When the change moves some Systems' effective status
 * (for a Both Control: the implementation becomes Fulfilled, or stops being),
 * each of those Systems gets one `"system"`-actor ASSESSMENT_STATUS_CHANGED
 * Change Event, written in the same transaction as the implementation, so a
 * System never shows a changed status without its event or the other way round.
 * Systems whose effective status stays the same (a person-set Assessment, an
 * own-Fulfilled one, a System the Control doesn't apply to, a System a Provider
 * (#124) already made Fulfilled) get none: each System is resolved with its
 * Provider sources too, under the Organization's old and new status.
 *
 * An Organizational Control is the other case (#122, product-owner decision): it
 * counts live on every System with the Framework in scope, so one status change
 * would move them all. It writes ONE System-less ORGANIZATION_IMPLEMENTATION_CHANGED
 * event, attributed to the User who made the edit (their direct edit, not a
 * computed side effect), and nothing per System. Only a status change writes it,
 * not a description-only or no-op edit. Since #284 (decision 1c) a Both Control's
 * status change writes that same System-less event too, in the same transaction and
 * on any status change, in addition to the per-System events above: it is the
 * Organization-level record the Organization Control Implementations page shows as
 * the Control's history.
 *
 * One transaction, not 50-System batches: the work is a handful of bulk
 * queries plus `createMany`, and the benchmark in HANDOFF.md shows 500 Systems
 * well inside the transaction timeout. A transaction-scoped advisory lock per
 * Control makes concurrent edits of the same Control run one after the other,
 * so each sees the status the previous one left and the events aren't doubled.
 */

type OrganizationControl = NonNullable<Awaited<ReturnType<typeof getOrganizationControl>>>;

/** Generous: a Both Control can apply to every System (PRD scale target: 500). */
export const ORGANIZATION_TRANSACTION_TIMEOUT_MS = 30_000;

const EVENT_INSERT_CHUNK = 1000;

/** Applies an edit exactly like `saveOrganizationImplementation`, plus the Change Events described above. */
export async function saveOrganizationImplementationWithEvents(
  control: OrganizationControl,
  userId: string,
  edit: ImplementationEdit,
): Promise<OrganizationControlRow> {
  return prisma.$transaction(
    (tx) => saveOrganizationImplementationIn(tx, control, edit, { userId, eventActorId: userId }),
    { timeout: ORGANIZATION_TRANSACTION_TIMEOUT_MS },
  );
}

/** The most Controls one bulk edit may take (#284): every one runs the full single-edit write inside one transaction. */
export const ORGANIZATION_BULK_MAX_CONTROLS = 100;

/** The bulk edit's transaction timeout: a few Both Controls can each apply to every System, and all of them share one transaction. */
export const ORGANIZATION_BULK_TRANSACTION_TIMEOUT_MS = 60_000;

/**
 * The same edit applied to several Controls (the bulk "Set status…", #284), all or nothing: one
 * transaction in which every Control goes through `saveOrganizationImplementationIn`, so each gets
 * exactly the events a single edit by `userId` would write. The Controls are taken in id order, so
 * two overlapping bulk edits take the Controls' advisory locks in the same order and can't deadlock.
 * Returns the saved rows in the order of `controls`.
 */
export async function saveOrganizationImplementationsWithEvents(
  controls: OrganizationControl[],
  userId: string,
  edit: ImplementationEdit,
): Promise<OrganizationControlRow[]> {
  const inLockOrder = [...controls].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const saved = await prisma.$transaction(
    async (tx) => {
      const rows = new Map<string, OrganizationControlRow>();
      for (const control of inLockOrder) {
        rows.set(control.id, await saveOrganizationImplementationIn(tx, control, edit, { userId, eventActorId: userId }));
      }
      return rows;
    },
    { timeout: ORGANIZATION_BULK_TRANSACTION_TIMEOUT_MS },
  );
  return controls.map((control) => saved.get(control.id)!);
}

/**
 * Who an implementation change is attributed to. `userId` is the person who edited it (null when
 * none did: an Internal Audit's Nonconformity, #157, whose set-back leaves "last updated by" as
 * it was); `eventActorId` is the actor of the System-less ORGANIZATION_IMPLEMENTATION_CHANGED
 * event (a User id, or `SYSTEM_ACTOR`). The per-System events a Both
 * Control writes are `SYSTEM_ACTOR`'s either way: they are computed side effects.
 */
export type ImplementationActor = { userId: string | null; eventActorId: string };

/**
 * The body of `saveOrganizationImplementationWithEvents` on the caller's transaction client, so
 * the evaluation of a Check-up (#157) can set an implementation back in its own transaction with
 * exactly the effects of a person's edit. Takes the Control's advisory lock itself (re-entrant in
 * one transaction); everything runs on `tx`.
 */
export async function saveOrganizationImplementationIn(
  tx: Prisma.TransactionClient,
  control: OrganizationControl,
  edit: ImplementationEdit,
  actor: ImplementationActor,
): Promise<OrganizationControlRow> {
  if (control.applicability !== "BOTH" && control.applicability !== "ORGANIZATIONAL") {
    return saveOrganizationImplementation(tx, control, actor.userId, edit);
  }

  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${control.id}))`;
  const current = await tx.organizationControlImplementation.findUnique({
    where: { controlId: control.id },
    select: { status: true },
  });
  const before = current?.status ?? "NOT_STARTED";
  const saved = await saveOrganizationImplementation(tx, control, actor.userId, edit);
  const after = saved.implementation.status;
  // Every status change is recorded once at the Organization level, whatever the applicability (#284).
  const detail = describeOrganizationImplementationChange(control.code, before, after);
  if (detail) await logChangeEvent(null, "ORGANIZATION_IMPLEMENTATION_CHANGED", detail, actor.eventActorId, tx);
  if (control.applicability === "ORGANIZATIONAL") return saved;
  // A Both Control also moves its Systems' effective status; nothing can move unless the source
  // went from giving credit to not, or back.
  if (sourceGivesCredit(before) !== sourceGivesCredit(after)) {
    await writeInheritedStatusEvents(tx, control.id, before, after);
  }
  return saved;
}

/**
 * One event per System whose effective status for the Control differs between
 * the Organization's old and new status. Bulk: the Systems that have a
 * Framework the Control maps to in scope (a superset of the ones it applies
 * to), then the Control's own Assessment rows, one per System at most. The
 * applicability filter and the resolution run in memory.
 */
async function writeInheritedStatusEvents(
  tx: Prisma.TransactionClient,
  controlId: string,
  before: ControlAssessmentStatus,
  after: ControlAssessmentStatus,
) {
  const scope = await scopeForControl(controlId, tx);
  if (!scope) return;

  const [control, systems, assessments] = await Promise.all([
    tx.control.findUniqueOrThrow({
      where: { id: controlId },
      select: {
        id: true,
        code: true,
        applicability: true,
        minConfidentialityImpactLevel: true,
        minIntegrityImpactLevel: true,
        minAvailabilityImpactLevel: true,
        deploymentFacets: { select: { id: true } },
        mappings: { select: { requirement: { select: { framework: { select: { id: true, status: true, isBase: true } } } } } },
      },
    }),
    tx.system.findMany({
      where: scope.systemsWhere,
      select: {
        id: true,
        confidentialityImpactLevel: true,
        integrityImpactLevel: true,
        availabilityImpactLevel: true,
        deploymentFacets: { select: { id: true } },
        frameworkScopes: { select: { id: true } },
      },
    }),
    tx.controlAssessment.findMany({
      where: { controlId },
      select: { systemId: true, status: true, assessedById: true },
    }),
  ]);
  const ownBySystemId = new Map(assessments.map((a) => [a.systemId, toOwnAssessment(a)]));
  const providerSources = await loadProviderSources(
    systems.map((system) => system.id),
    [controlId],
    tx,
  );

  const events: Prisma.ChangeEventCreateManyInput[] = [];
  for (const system of systems) {
    if (!controlAppliesToSystem(control, system)) continue;
    const own = ownBySystemId.get(system.id) ?? null;
    const providers = providerSources.get(system.id)?.get(controlId);
    const detail = describeInheritedStatusChange(
      control.code,
      resolveEffectiveStatus(own, inheritanceSourcesFor(control, before, providers)),
      resolveEffectiveStatus(own, inheritanceSourcesFor(control, after, providers)),
    );
    if (detail) events.push({ systemId: system.id, action: "ASSESSMENT_STATUS_CHANGED", detail, actorId: SYSTEM_ACTOR });
  }
  for (let i = 0; i < events.length; i += EVENT_INSERT_CHUNK) {
    await tx.changeEvent.createMany({ data: events.slice(i, i + EVENT_INSERT_CHUNK) });
  }
}
