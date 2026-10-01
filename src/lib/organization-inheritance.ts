import type { ControlAssessmentStatus, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { SYSTEM_ACTOR } from "@/lib/change-events";
import { controlAppliesToSystem } from "@/lib/control-assessments";
import { scopeForControl } from "@/lib/applicability-recompute";
import {
  describeInheritedStatusChange,
  inheritanceSourcesFor,
  resolveEffectiveStatus,
  sourceGivesCredit,
} from "@/lib/effective-status";
import { toOwnAssessment } from "@/lib/effective-status-data";
import {
  saveOrganizationImplementation,
  type getOrganizationControl,
  type ImplementationEdit,
  type OrganizationControlRow,
} from "@/lib/organization-implementation";

/**
 * Saving an Organization Control Implementation and telling the Systems that
 * inherit from it (PRD 0001 F-IN.7, F-CE.2; issue #121).
 *
 * Nothing is copied to a System, so there is nothing to update on one: the
 * effective status is derived live and already reflects the new status. What
 * this adds is the record. When the change moves some Systems' effective status
 * (for a Both Control: the implementation becomes Fulfilled, or stops being),
 * each of those Systems gets one `"system"`-actor ASSESSMENT_STATUS_CHANGED
 * Change Event, written in the same transaction as the implementation, so a
 * System never shows a changed status without its event or the other way round.
 * Systems whose effective status stays the same (a person-set Assessment, an
 * own-Fulfilled one, a System the Control doesn't apply to) get none.
 *
 * One transaction, not 50-System batches: the work is a handful of bulk
 * queries plus `createMany`, and the benchmark in HANDOFF.md shows 500 Systems
 * well inside the transaction timeout. A transaction-scoped advisory lock per
 * Control makes concurrent edits of the same Control run one after the other,
 * so each sees the status the previous one left and the events aren't doubled.
 */

type OrganizationControl = NonNullable<Awaited<ReturnType<typeof getOrganizationControl>>>;

/** Generous: a Both Control can apply to every System (PRD scale target: 500). */
const TRANSACTION_TIMEOUT_MS = 30_000;

const EVENT_INSERT_CHUNK = 1000;

/** Applies an edit exactly like `saveOrganizationImplementation`, plus the Change Events described above. */
export async function saveOrganizationImplementationWithEvents(
  control: OrganizationControl,
  userId: string,
  edit: ImplementationEdit,
): Promise<OrganizationControlRow> {
  return prisma.$transaction(
    async (tx) => {
      if (control.applicability !== "BOTH") return saveOrganizationImplementation(tx, control, userId, edit);

      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${control.id}))`;
      const current = await tx.organizationControlImplementation.findUnique({
        where: { controlId: control.id },
        select: { status: true },
      });
      const before = current?.status ?? "NOT_STARTED";
      const saved = await saveOrganizationImplementation(tx, control, userId, edit);
      const after = saved.implementation.status;
      // Nothing can move unless the source went from giving credit to not, or back.
      if (sourceGivesCredit(before) !== sourceGivesCredit(after)) {
        await writeInheritedStatusEvents(tx, control.id, before, after);
      }
      return saved;
    },
    { timeout: TRANSACTION_TIMEOUT_MS },
  );
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
  const scope = await scopeForControl(controlId);
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

  const events: Prisma.ChangeEventCreateManyInput[] = [];
  for (const system of systems) {
    if (!controlAppliesToSystem(control, system)) continue;
    const own = ownBySystemId.get(system.id) ?? null;
    const detail = describeInheritedStatusChange(
      control.code,
      resolveEffectiveStatus(own, inheritanceSourcesFor(control, before)),
      resolveEffectiveStatus(own, inheritanceSourcesFor(control, after)),
    );
    if (detail) events.push({ systemId: system.id, action: "ASSESSMENT_STATUS_CHANGED", detail, actorId: SYSTEM_ACTOR });
  }
  for (let i = 0; i < events.length; i += EVENT_INSERT_CHUNK) {
    await tx.changeEvent.createMany({ data: events.slice(i, i + EVENT_INSERT_CHUNK) });
  }
}
