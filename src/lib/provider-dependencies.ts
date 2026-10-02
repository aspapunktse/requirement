import type { UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { logChangeEvent } from "@/lib/change-events";
import { getApplicableControls, type SystemClassification } from "@/lib/control-assessments";
import { loadProviderSources } from "@/lib/effective-status-data";
import { lockProvider, PROVIDER_TRANSACTION_TIMEOUT_MS, withProviderInheritanceEvents } from "@/lib/provider-inheritance";
import { visibleSystemsWhere } from "@/lib/system-visibility";
import {
  ALREADY_DEPENDS_REFUSAL,
  describeDependencyAdded,
  describeDependencyRemoved,
  NOT_A_PROVIDER_DEPENDENCY_REFUSAL,
  PROVIDER_NOT_FOUND,
  SELF_DEPENDENCY_REFUSAL,
  type DependentRow,
  type ProviderChoice,
  type ProviderDependencyRow,
} from "@/lib/provider-dependency-rules";

/**
 * A System's dependencies on Providers (PRD 0001 F-IN.3, ADR 0008, #124): the
 * data side. The rules (who may, what is refused, the Change Event wording) are
 * pure and live in `provider-dependency-rules.ts`. A dependency makes the System
 * inherit the Provider's Full Offerings live (`loadProviderSources`); nothing is
 * copied to it. Declaring and removing one records what it moved on the
 * dependent (`provider-inheritance.ts`), in the same transaction, under the
 * Provider's lock (so an unmark can't race a declare).
 *
 * What a viewer may learn about a Provider they can't see as a System: its name,
 * whether it is Onboarded, its Offerings and its own status for each. Every
 * function here returns only that (`ProviderDependencyRow`, `ProviderChoice`,
 * `DependentRow`).
 */

type Viewer = { id: string; role: UserRole };

/** Which of `ids` the viewer may open as a System. */
async function visibleSystemIds(viewer: Viewer, ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const rows = await prisma.system.findMany({
    where: { id: { in: ids }, ...(await visibleSystemsWhere(viewer)) },
    select: { id: true },
  });
  return new Set(rows.map((row) => row.id));
}

/** Code-unit order, like the source list (`inheritanceSourcesFor`): by name, then id. */
function byNameThenId(a: { name: string; id: string }, b: { name: string; id: string }) {
  return (a.name < b.name ? -1 : a.name > b.name ? 1 : 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/**
 * The Providers `system` depends on, each with its name, whether it is
 * Onboarded, whether `viewer` can open it, and its Offerings that match one of
 * the System's applicable Controls (with the Provider's own status of each).
 * By name. A few queries however many Providers or Offerings: the dependencies,
 * the System's applicable Controls, the Provider sources, the visible Providers.
 */
export async function listProviderDependencies(
  system: SystemClassification & { id: string },
  viewer: Viewer,
): Promise<ProviderDependencyRow[]> {
  const dependencies = await prisma.providerDependency.findMany({
    where: { dependentId: system.id },
    select: { provider: { select: { id: true, name: true, status: true } } },
  });
  if (dependencies.length === 0) return [];
  const providers = dependencies.map((dependency) => dependency.provider).sort(byNameThenId);

  const applicable = await getApplicableControls(system);
  const [sources, visible] = await Promise.all([
    loadProviderSources([system.id], applicable.map((control) => control.id)),
    visibleSystemIds(viewer, providers.map((provider) => provider.id)),
  ]);
  const sourcesByControlId = sources.get(system.id);

  return providers.map((provider) => ({
    providerId: provider.id,
    name: provider.name,
    onboarded: provider.status === "ONBOARDED",
    canSee: visible.has(provider.id),
    offerings: applicable.flatMap((control) =>
      (sourcesByControlId?.get(control.id) ?? [])
        .filter((source) => source.provider.id === provider.id)
        .map((source) => ({
          control: { id: control.id, code: control.code, title: control.title },
          type: source.type,
          customerResponsibility: source.customerResponsibility,
          providerStatus: source.status,
          appliesToProvider: source.appliesToProvider,
        })),
    ),
  }));
}

/** Every System marked as a Provider, for the picker: id, name and whether it is Onboarded. By name. Not filtered by visibility: any owner may pick any Provider. */
export async function listProviderChoices(): Promise<ProviderChoice[]> {
  const providers = await prisma.system.findMany({
    where: { isProvider: true },
    select: { id: true, name: true, status: true },
  });
  return providers.sort(byNameThenId).map((provider) => ({ id: provider.id, name: provider.name, onboarded: provider.status === "ONBOARDED" }));
}

/** The Systems that depend on the Provider: name only, `canSee` says whether `viewer` may open it. By name. */
export async function listDependents(providerId: string, viewer: Viewer): Promise<DependentRow[]> {
  const dependencies = await prisma.providerDependency.findMany({
    where: { providerId },
    select: { dependent: { select: { id: true, name: true } } },
  });
  const dependents = dependencies.map((dependency) => dependency.dependent).sort(byNameThenId);
  const visible = await visibleSystemIds(viewer, dependents.map((dependent) => dependent.id));
  return dependents.map((dependent) => ({ id: dependent.id, name: dependent.name, canSee: visible.has(dependent.id) }));
}

export type DependencyResult<T> = { ok: true; value: T } | { ok: false; status: 404 | 409; error: string };

/**
 * Declares that `dependent` depends on the Provider `providerId`. Checks, in
 * order: not itself (409; the caller sees the dependent, so nothing leaks); the
 * Provider exists (404); it is a System marked as a Provider (409, but 404 when
 * the caller can't see the System either, so a non-Provider System's existence
 * doesn't leak to someone who may not see it); not already declared (409). Then,
 * in one transaction under the Provider's lock: re-checks that it is a Provider,
 * writes the dependency and one `CLASSIFICATION_CHANGED` event by the acting
 * User (`Provider dependency on "<name>" added`), and records what it moved on
 * the dependent (`"system"` events, F-IN.7). Authorisation is the caller's job.
 */
export async function declareProviderDependency(
  dependent: { id: string },
  providerId: string,
  actor: Viewer,
): Promise<DependencyResult<null>> {
  if (providerId === dependent.id) return { ok: false, status: 409, error: SELF_DEPENDENCY_REFUSAL };

  const provider = await prisma.system.findUnique({ where: { id: providerId }, select: { id: true, isProvider: true } });
  if (!provider) return { ok: false, status: 404, error: PROVIDER_NOT_FOUND };
  if (!provider.isProvider) {
    // A System that is not a Provider and that the caller can't see looks exactly like one that doesn't exist.
    if (!(await visibleSystemIds(actor, [provider.id])).has(provider.id)) {
      return { ok: false, status: 404, error: PROVIDER_NOT_FOUND };
    }
    return { ok: false, status: 409, error: NOT_A_PROVIDER_DEPENDENCY_REFUSAL };
  }

  return prisma.$transaction(
    async (tx): Promise<DependencyResult<null>> => {
      await lockProvider(tx, providerId);
      // Under the lock: an unmark that got there first has won.
      const current = await tx.system.findUnique({ where: { id: providerId }, select: { name: true, isProvider: true } });
      if (!current) return { ok: false, status: 404, error: PROVIDER_NOT_FOUND };
      if (!current.isProvider) return { ok: false, status: 409, error: NOT_A_PROVIDER_DEPENDENCY_REFUSAL };
      if (await tx.providerDependency.findUnique({ where: { dependentId_providerId: { dependentId: dependent.id, providerId } }, select: { id: true } })) {
        return { ok: false, status: 409, error: ALREADY_DEPENDS_REFUSAL };
      }

      await withProviderInheritanceEvents(tx, { providerId, dependentIds: [dependent.id] }, async () => {
        await tx.providerDependency.create({ data: { dependentId: dependent.id, providerId } });
        await logChangeEvent(dependent.id, "CLASSIFICATION_CHANGED", describeDependencyAdded(current.name), actor.id, tx);
      });
      return { ok: true, value: null };
    },
    { timeout: PROVIDER_TRANSACTION_TIMEOUT_MS },
  );
}

/**
 * Removes `dependent`'s dependency on `providerId` (404 when it isn't declared),
 * with one `CLASSIFICATION_CHANGED` event by the acting User and the `"system"`
 * events for whatever it moved, in one transaction under the Provider's lock.
 * The dependent's own Assessments are never touched. Authorisation is the caller's job.
 */
export async function removeProviderDependency(
  dependent: { id: string },
  providerId: string,
  actorId: string,
): Promise<DependencyResult<null>> {
  return prisma.$transaction(
    async (tx): Promise<DependencyResult<null>> => {
      await lockProvider(tx, providerId);
      const dependency = await tx.providerDependency.findUnique({
        where: { dependentId_providerId: { dependentId: dependent.id, providerId } },
        select: { id: true, provider: { select: { name: true } } },
      });
      if (!dependency) return { ok: false, status: 404, error: "This System doesn't depend on that Provider" };

      await withProviderInheritanceEvents(tx, { providerId, dependentIds: [dependent.id] }, async () => {
        await tx.providerDependency.delete({ where: { id: dependency.id } });
        await logChangeEvent(dependent.id, "CLASSIFICATION_CHANGED", describeDependencyRemoved(dependency.provider.name), actorId, tx);
      });
      return { ok: true, value: null };
    },
    { timeout: PROVIDER_TRANSACTION_TIMEOUT_MS },
  );
}

/** One declared Provider in the row shape of `listProviderDependencies`, or null when `system` doesn't depend on it. */
export async function getProviderDependencyRow(
  system: SystemClassification & { id: string },
  viewer: Viewer,
  providerId: string,
): Promise<ProviderDependencyRow | null> {
  const rows = await listProviderDependencies(system, viewer);
  return rows.find((row) => row.providerId === providerId) ?? null;
}
