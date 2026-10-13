import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { SYSTEM_ACTOR } from "@/lib/change-events";
import { controlAppliesToSystem } from "@/lib/control-applicability";
import {
  CREDITED_OFFERING_TYPES,
  describeInheritedStatusChange,
  inheritanceSourcesFor,
  resolveEffectiveStatus,
  type EffectiveStatus,
} from "@/lib/effective-status";
import { loadOrganizationStatuses, loadProviderSources, toOwnAssessment } from "@/lib/effective-status-data";

/**
 * Recording what a change to a Provider moved on the Systems that depend on it
 * (PRD 0001 F-IN.7, F-CE.2; issues #124 and #125).
 *
 * Nothing is copied to a dependent, so there is nothing to update on one: its
 * effective status is derived live and already reflects the change. What this
 * adds is the record. Around each change that can move a dependent's effective
 * status, `withProviderInheritanceEvents` resolves every affected (dependent,
 * Control) pair before and after, and writes one `"system"`-actor
 * ASSESSMENT_STATUS_CHANGED event on each dependent whose effective status for a
 * Control actually moved: none on the others (a person-set Assessment, a
 * Control the dependent doesn't take, another source that already gave credit).
 * The events are written in the same transaction as the change (except for the
 * optional triggers, see `recordProviderChange`), in bulk (`createMany`), so a dependent never shows a changed status without its event
 * or the other way round. It mirrors `organization-inheritance.ts`; the
 * Organization's fan-out resolves each System's Provider sources too, so it
 * never logs "now Fulfilled" on a System a Provider already made Fulfilled.
 *
 * A Shared Offering (#125) is recorded like a Full one: the same triggers move a
 * dependent whose own Assessment is Fulfilled, in both directions (`describeInheritedStatusChange`
 * words "now Fulfilled, inherited from ... (Shared)" and "now In Progress: waiting for ...").
 * What the dependent's OWN edit does to its Control is not recorded here but in
 * the edit route's own event.
 *
 * Triggers (each is one small call):
 * - the Provider's own Assessment status changes: the edit, answer and reset
 *   routes (`runProviderAssessmentWrite`);
 * - the Provider becomes Onboarded (the onboard route);
 * - an Offering is added, changed or removed (`control-offerings.ts`);
 * - a dependency is declared or removed (`provider-dependencies.ts`), scoped to
 *   that one dependent.
 *
 * LOCKS. Every transaction that can move a dependent through a Provider takes
 * `pg_advisory_xact_lock(hashtext(providerId))` first (`lockProvider`), then the
 * Control locks (`pg_advisory_xact_lock(hashtext(controlId))`) of the Controls it
 * resolves, in sorted id order. `saveOrganizationImplementationWithEvents` and
 * `resetAssessmentToInherited` take only a Control lock, which is compatible
 * with this order, so no two transactions can wait on each other, and mutual
 * dependencies (A depends on B, B on A) can't deadlock because a transaction
 * holds at most one Provider lock. What is serialised: all changes to one
 * Provider (its Assessments, Offerings, Onboarding, dependencies), and
 * everything that changes one Control's inheritance (Organization status,
 * Provider status, a reset), so concurrent edits see each other's result and
 * the events aren't doubled. What is not: edits of different Providers, and of
 * Controls no one inherits, which never wait for each other; and the optional
 * triggers of `recordProviderChange`, which take no lock (below).
 *
 * CONNECTIONS. Inside an interactive transaction every query must use `tx`: a
 * query on the global client needs a second connection, and with a small pool
 * (CI's is 3, serverless ones are small) transactions waiting on an advisory
 * lock hold every connection, so the one holding the lock can never get its
 * second and all wait until Prisma times out. Nothing here, and nothing the
 * callers run inside these transactions, may touch the global client; the test
 * run uses CI's pool size so a regression fails locally too.
 */

/** Generous: one Provider can have every System as a dependent (PRD scale target: 500). */
export const PROVIDER_TRANSACTION_TIMEOUT_MS = 30_000;

const EVENT_INSERT_CHUNK = 1000;

type Tx = Prisma.TransactionClient;

/** First lock of every transaction that changes a Provider (see LOCKS above). */
export async function lockProvider(tx: Pick<Tx, "$executeRaw">, providerId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${providerId}))`;
}

/** Control locks, in sorted id order (see LOCKS above). */
async function lockControls(tx: Pick<Tx, "$executeRaw">, controlIds: string[]) {
  for (const controlId of [...controlIds].sort()) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${controlId}))`;
  }
}

export type ProviderChangeScope = {
  providerId: string;
  /**
   * The Controls whose effective status the change can move. Default: every
   * Control the Provider offers (an Offering add or removal names its one Control).
   */
  controlIds?: string[];
  /**
   * The dependents to resolve. Default: every System that depends on the
   * Provider (declaring or removing a dependency names its one dependent, which
   * isn't, or is no longer, a dependent while the change runs).
   */
  dependentIds?: string[];
};

/** A Control with what applicability needs, as `controlAppliesToSystem` wants it. */
const CONTROL_SELECT = {
  id: true,
  code: true,
  applicability: true,
  minConfidentialityImpactLevel: true,
  minIntegrityImpactLevel: true,
  minAvailabilityImpactLevel: true,
  deploymentFacets: { select: { id: true } },
  mappings: { select: { requirement: { select: { framework: { select: { id: true, status: true, isBase: true } } } } } },
} satisfies Prisma.ControlSelect;

const SYSTEM_SELECT = {
  id: true,
  confidentialityImpactLevel: true,
  integrityImpactLevel: true,
  availabilityImpactLevel: true,
  deploymentFacets: { select: { id: true } },
  frameworkScopes: { select: { id: true } },
} satisfies Prisma.SystemSelect;

type ResolutionContext = {
  systems: Prisma.SystemGetPayload<{ select: typeof SYSTEM_SELECT }>[];
  controls: Prisma.ControlGetPayload<{ select: typeof CONTROL_SELECT }>[];
};

/** The effective status of every (dependent, Control) pair where the Control applies to the dependent, by `systemId|controlId`. */
async function resolveAll(tx: Tx, { systems, controls }: ResolutionContext): Promise<Map<string, EffectiveStatus>> {
  const systemIds = systems.map((system) => system.id);
  const controlIds = controls.map((control) => control.id);
  const [assessments, organizationStatuses, providerSources] = await Promise.all([
    tx.controlAssessment.findMany({
      where: { systemId: { in: systemIds }, controlId: { in: controlIds } },
      select: { systemId: true, controlId: true, status: true, assessedById: true },
    }),
    loadOrganizationStatuses(
      controls.filter((control) => control.applicability === "BOTH").map((control) => control.id),
      tx,
    ),
    loadProviderSources(systemIds, controlIds, tx),
  ]);
  const own = new Map(assessments.map((a) => [`${a.systemId}|${a.controlId}`, toOwnAssessment(a)]));

  const resolved = new Map<string, EffectiveStatus>();
  for (const system of systems) {
    for (const control of controls) {
      if (!controlAppliesToSystem(control, system)) continue;
      resolved.set(
        `${system.id}|${control.id}`,
        resolveEffectiveStatus(
          own.get(`${system.id}|${control.id}`) ?? null,
          inheritanceSourcesFor(control, organizationStatuses.get(control.id), providerSources.get(system.id)?.get(control.id)),
        ),
      );
    }
  }
  return resolved;
}

type Ids = { controlIds: string[]; dependentIds: string[] };

/** The Controls and dependents a change can move (`scope`'s, or the Provider's Offerings and dependents), or null when there is nothing to look at. */
async function resolveIds(db: Tx, scope: ProviderChangeScope): Promise<Ids | null> {
  const [controlIds, dependentIds] = await Promise.all([
    scope.controlIds ??
      db.controlOffering.findMany({ where: { providerId: scope.providerId }, select: { controlId: true } }).then((rows) => rows.map((r) => r.controlId)),
    scope.dependentIds ??
      db.providerDependency.findMany({ where: { providerId: scope.providerId }, select: { dependentId: true } }).then((rows) => rows.map((r) => r.dependentId)),
  ]);
  return controlIds.length === 0 || dependentIds.length === 0 ? null : { controlIds, dependentIds };
}

async function loadContext(db: Tx, { controlIds, dependentIds }: Ids): Promise<ResolutionContext> {
  const [systems, controls] = await Promise.all([
    db.system.findMany({ where: { id: { in: dependentIds } }, select: SYSTEM_SELECT }),
    db.control.findMany({ where: { id: { in: controlIds } }, select: CONTROL_SELECT }),
  ]);
  return { systems, controls };
}

/** Resolves before, runs `change`, resolves after and bulk-writes the events, all on `db`. */
async function recordAround<T>(db: Tx, context: ResolutionContext, change: () => Promise<T>): Promise<T> {
  const before = await resolveAll(db, context);
  const result = await change();
  const after = await resolveAll(db, context);

  const codeByControlId = new Map(context.controls.map((control) => [control.id, control.code]));
  const events: Prisma.ChangeEventCreateManyInput[] = [];
  for (const [key, effective] of after) {
    const previous = before.get(key);
    if (!previous) continue;
    const [systemId, controlId] = key.split("|");
    const detail = describeInheritedStatusChange(codeByControlId.get(controlId) ?? controlId, previous, effective);
    if (detail) events.push({ systemId, action: "ASSESSMENT_STATUS_CHANGED", detail, actorId: SYSTEM_ACTOR });
  }
  for (let i = 0; i < events.length; i += EVENT_INSERT_CHUNK) {
    await db.changeEvent.createMany({ data: events.slice(i, i + EVENT_INSERT_CHUNK) });
  }
  return result;
}

/**
 * Runs `change` (which must use `tx`) and writes one `"system"` ASSESSMENT_STATUS_CHANGED
 * event on each dependent of the Provider whose effective status for a Control
 * differs before and after it. Takes the Provider lock and then the Control locks
 * (see LOCKS in the module comment); call it as the first thing in the
 * transaction, or after having taken the Provider lock yourself. A change that
 * can't move anyone (no dependents, or no Controls to look at) just runs.
 * Everything runs on `tx`. Returns what `change` returns.
 */
export async function withProviderInheritanceEvents<T>(
  tx: Tx,
  scope: ProviderChangeScope,
  change: () => Promise<T>,
): Promise<T> {
  await lockProvider(tx, scope.providerId);
  const ids = await resolveIds(tx, scope);
  if (!ids) return change();
  await lockControls(tx, ids.controlIds);
  return recordAround(tx, await loadContext(tx, ids), change);
}

/**
 * Does any dependent read the Provider's own status of `controlId`? True when
 * the Provider has an Offering of it that can give credit (`CREDITED_OFFERING_TYPES`)
 * and at least one System depends on the Provider: one small indexed query.
 */
async function hasCreditedDependents(tx: Tx, providerId: string, controlId: string) {
  const count = await tx.controlOffering.count({
    where: { providerId, controlId, type: { in: CREDITED_OFFERING_TYPES }, provider: { dependents: { some: {} } } },
  });
  return count > 0;
}

/**
 * Records what a change to a System that is a Provider moved on the Systems
 * depending on it, for changes that run their own transactions (a
 * classification or Framework Scope change): resolves every
 * Control the Provider offers before, runs `change`, resolves after and writes
 * the `"system"` events. A System that is not a Provider just runs `change`.
 *
 * Unlike the other triggers this is NOT atomic with the change, and it is NOT
 * serialised: it holds no transaction and takes no lock, so nothing is held open
 * while `change` runs on other connections (that would starve a small pool, see
 * CONNECTIONS above). `change` commits on its own, then the events are written,
 * so a crash in between leaves the change without its events, and two such
 * changes on one Provider at once can each see the other's result and log an
 * event twice or not at all. The change is the one that matters and is never lost;
 * the product owner accepted this on 2026-10-02 (decision 3a on #124).
 */
export async function recordProviderChange<T>(system: { id: string; isProvider?: boolean }, change: () => Promise<T>): Promise<T> {
  if (!system.isProvider) return change();
  const ids = await resolveIds(prisma, { providerId: system.id });
  if (!ids) return change();
  return recordAround(prisma, await loadContext(prisma, ids), change);
}

/**
 * Runs `write` (a change to the System's own Control Assessment of
 * `controlId`) and, when the System is a Provider that has an Offering of that
 * Control with dependents, records what it moved on them (F-IN.7), in one
 * transaction under the Provider lock.
 *
 * Cheap for everything else: a System that is not a Provider costs nothing
 * (`write` runs against the shared client, outside any transaction, exactly as
 * before), and a Provider with no credited Offering of the Control or no
 * dependents costs the transaction, the lock and one small indexed query, and
 * writes nothing extra. `system.isProvider` comes from the System the route has
 * already loaded; a System marked as a Provider after that read can't have
 * dependents yet, and an Offering added to it afterwards records its own events
 * from the status it finds.
 *
 * `write` gets the client to use and whether it runs locked inside the
 * transaction: inside, it should re-read whatever it compares against (under the
 * lock, two concurrent edits see each other's result).
 */
export async function runProviderAssessmentWrite<T>(
  system: { id: string; isProvider: boolean },
  controlId: string,
  write: (db: Tx | typeof prisma, locked: boolean) => Promise<T>,
): Promise<T> {
  if (!system.isProvider) return write(prisma, false);
  return prisma.$transaction((tx) => runProviderAssessmentWriteIn(tx, system, controlId, (db) => write(db, true)), {
    timeout: PROVIDER_TRANSACTION_TIMEOUT_MS,
  });
}

/**
 * `runProviderAssessmentWrite` inside a transaction the caller already holds (an Internal Audit's
 * Nonconformity setting a System's Assessment back, #157): the same Provider lock, the same
 * credited-dependents pre-check and the same events on the dependents, all on `tx`. A System that
 * is not a Provider just runs `write(tx)`. Lock order: the Provider, then the Control (see LOCKS);
 * the caller may already hold other locks, but must not take any of these two in the other order.
 */
export async function runProviderAssessmentWriteIn<T>(
  tx: Tx,
  system: { id: string; isProvider: boolean },
  controlId: string,
  write: (db: Tx) => Promise<T>,
): Promise<T> {
  if (!system.isProvider) return write(tx);
  await lockProvider(tx, system.id);
  if (!(await hasCreditedDependents(tx, system.id, controlId))) return write(tx);
  return withProviderInheritanceEvents(tx, { providerId: system.id, controlIds: [controlId] }, () => write(tx));
}
