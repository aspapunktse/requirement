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
 * (PRD 0001 F-IN.7, F-CE.2; issue #124).
 *
 * Nothing is copied to a dependent, so there is nothing to update on one: its
 * effective status is derived live and already reflects the change. What this
 * adds is the record. Around each change that can move a dependent's effective
 * status, `withProviderInheritanceEvents` resolves every affected (dependent,
 * Control) pair before and after, and writes one `"system"`-actor
 * ASSESSMENT_STATUS_CHANGED event on each dependent whose effective status for a
 * Control actually moved: none on the others (a person-set Assessment, a
 * Control the dependent doesn't take, another source that already gave credit).
 * The events are written in the same transaction as the change, in bulk
 * (`createMany`), so a dependent never shows a changed status without its event
 * or the other way round. It mirrors `organization-inheritance.ts`; the
 * Organization's fan-out resolves each System's Provider sources too, so it
 * never logs "now Fulfilled" on a System a Provider already made Fulfilled.
 *
 * Triggers (each is one small call):
 * - the Provider's own Assessment status changes: the edit, answer and reset
 *   routes (`runProviderAssessmentWrite`), Capability auto-fulfilment;
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
 * Controls no one inherits, which never wait for each other.
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

/**
 * Runs `change` (which must use `tx`) and writes one `"system"` ASSESSMENT_STATUS_CHANGED
 * event on each dependent of the Provider whose effective status for a Control
 * differs before and after it. Takes the Provider lock and then the Control locks
 * (see LOCKS in the module comment); call it as the first thing in the
 * transaction, or after having taken the Provider lock yourself. A change that
 * can't move anyone (no dependents, or no Controls to look at) just runs.
 * Returns what `change` returns.
 */
export async function withProviderInheritanceEvents<T>(
  tx: Tx,
  scope: ProviderChangeScope,
  change: () => Promise<T>,
): Promise<T> {
  await lockProvider(tx, scope.providerId);
  const [controlIds, dependentIds] = await Promise.all([
    scope.controlIds ??
      tx.controlOffering.findMany({ where: { providerId: scope.providerId }, select: { controlId: true } }).then((rows) => rows.map((r) => r.controlId)),
    scope.dependentIds ??
      tx.providerDependency.findMany({ where: { providerId: scope.providerId }, select: { dependentId: true } }).then((rows) => rows.map((r) => r.dependentId)),
  ]);
  if (controlIds.length === 0 || dependentIds.length === 0) return change();

  await lockControls(tx, controlIds);
  const [systems, controls] = await Promise.all([
    tx.system.findMany({ where: { id: { in: dependentIds } }, select: SYSTEM_SELECT }),
    tx.control.findMany({ where: { id: { in: controlIds } }, select: CONTROL_SELECT }),
  ]);
  const context: ResolutionContext = { systems, controls };

  const before = await resolveAll(tx, context);
  const result = await change();
  const after = await resolveAll(tx, context);

  const codeByControlId = new Map(controls.map((control) => [control.id, control.code]));
  const events: Prisma.ChangeEventCreateManyInput[] = [];
  for (const [key, effective] of after) {
    const previous = before.get(key);
    if (!previous) continue;
    const [systemId, controlId] = key.split("|");
    const detail = describeInheritedStatusChange(codeByControlId.get(controlId) ?? controlId, previous, effective);
    if (detail) events.push({ systemId, action: "ASSESSMENT_STATUS_CHANGED", detail, actorId: SYSTEM_ACTOR });
  }
  for (let i = 0; i < events.length; i += EVENT_INSERT_CHUNK) {
    await tx.changeEvent.createMany({ data: events.slice(i, i + EVENT_INSERT_CHUNK) });
  }
  return result;
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
 * depending on it, for changes that run their own transactions (Capability
 * declare and remove, a classification or Framework Scope change): runs `change`
 * under the Provider lock and writes the `"system"` events after it, resolving
 * every Control the Provider offers before and after. A System that is not a
 * Provider just runs `change`.
 *
 * Unlike the other triggers this is NOT atomic with the change: `change` commits
 * on its own connection, then the events are written, so a crash in between
 * leaves the change without its events. The change is the one that matters and
 * is never lost; they are the reason these triggers are optional in #124.
 */
export async function recordProviderChange<T>(system: { id: string; isProvider?: boolean }, change: () => Promise<T>): Promise<T> {
  if (!system.isProvider) return change();
  return prisma.$transaction((tx) => withProviderInheritanceEvents(tx, { providerId: system.id }, change), {
    timeout: PROVIDER_TRANSACTION_TIMEOUT_MS,
  });
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
  return prisma.$transaction(
    async (tx) => {
      await lockProvider(tx, system.id);
      if (!(await hasCreditedDependents(tx, system.id, controlId))) return write(tx, true);
      return withProviderInheritanceEvents(tx, { providerId: system.id, controlIds: [controlId] }, () => write(tx, true));
    },
    { timeout: PROVIDER_TRANSACTION_TIMEOUT_MS },
  );
}
