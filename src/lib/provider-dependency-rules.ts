import type { ControlAssessmentStatus, ControlOfferingType, UserRole } from "@prisma/client";
import { isSystemOwnerOrAdmin } from "@/lib/system-permissions";
import { inheritanceSourceGivesCredit, type ProviderSource } from "@/lib/effective-status";

/**
 * Who may declare or remove a System's dependencies on Providers, what is
 * refused, how it reads in the Change Event log (PRD 0001 F-IN.3, ADR 0008,
 * #124), and what the dependent's page may say about a Provider. Pure and
 * Prisma-free, so the routes, the System page and the unit table share one
 * definition. The data side is `provider-dependencies.ts`.
 */

type Actor = { id: string; role: UserRole };

/**
 * Who may declare or remove a dependency: the dependent System's owner
 * (whatever their role) or an Admin, at any lifecycle stage of either System. A
 * Compliance Manager is read-only, even if recorded as the owner
 * (`isSystemOwnerOrAdmin`, the one owner rule). Declaring a dependency widens or
 * narrows what the System inherits, like Framework Scope does what applies.
 */
export function canManageProviderDependencies(user: Actor, system: { ownerId: string }) {
  return isSystemOwnerOrAdmin(user, system);
}

/** Why a System can't depend on itself (the 409 text). */
export const SELF_DEPENDENCY_REFUSAL = "A System can't depend on itself";

/** Why a System can only depend on a Provider (the 409 text). */
export const NOT_A_PROVIDER_DEPENDENCY_REFUSAL = "A System can only depend on a System that is marked as a Provider";

/** The 409 text for a dependency that is already declared. */
export const ALREADY_DEPENDS_REFUSAL = "This System already depends on that Provider";

/** The 404 text for a Provider that doesn't exist or that the caller may not learn exists. */
export const PROVIDER_NOT_FOUND = "Provider not found";

/** Change Event wording (a `CLASSIFICATION_CHANGED` event on the dependent, like Framework Scope). */
export function describeDependencyAdded(providerName: string) {
  return `Provider dependency on "${providerName}" added`;
}

export function describeDependencyRemoved(providerName: string) {
  return `Provider dependency on "${providerName}" removed`;
}

/**
 * One Offering of a declared Provider that matches one of the dependent's
 * applicable Controls: all a viewer who can't see the Provider as a System may
 * learn about it (its Offerings and its own status for each offered Control).
 * `appliesToProvider` says whether the Control still applies to the Provider
 * (an Offering is kept when it stops, and gives no credit).
 */
export type DependencyOffering = {
  control: { id: string; code: string; title: string };
  type: ControlOfferingType;
  customerResponsibility: string | null;
  /** The Provider's OWN stored status of the Control (Not Started with no row). */
  providerStatus: ControlAssessmentStatus;
  appliesToProvider: boolean;
};

/**
 * A declared Provider as the dependent's page shows it. Only its name, whether it
 * is Onboarded, its Offerings and its own statuses are told to everyone who can
 * see the dependent; nothing else about the Provider (no owner, classification,
 * description, evidence or notes). `canSee` is whether *this viewer* can open it
 * as a System: its name links to `/systems/<id>` only then.
 */
export type ProviderDependencyRow = {
  providerId: string;
  name: string;
  onboarded: boolean;
  canSee: boolean;
  offerings: DependencyOffering[];
};

/** A Provider the System could depend on, for the picker: its id, name and whether it is Onboarded (pending if not). */
export type ProviderChoice = { id: string; name: string; onboarded: boolean };

/** A System that depends on a Provider, as the Provider's owner or an Admin sees it: its name, a link only if they can see it. */
export type DependentRow = { id: string; name: string; canSee: boolean };

/** The inheritance source an Offering row of a declared Provider stands for. */
export function dependencyOfferingSource(row: Pick<ProviderDependencyRow, "providerId" | "name" | "onboarded">, offering: DependencyOffering): ProviderSource {
  return {
    kind: "PROVIDER",
    type: offering.type,
    status: offering.providerStatus,
    provider: { id: row.providerId, name: row.name },
    providerOnboarded: row.onboarded,
    appliesToProvider: offering.appliesToProvider,
    customerResponsibility: offering.customerResponsibility,
  };
}

/**
 * The Full Offerings of the Provider that give the dependent credit right now, so
 * removing the dependency stops them being inherited. A Shared Offering is not
 * here (`sharedOfferingsInPlay`): it gives credit only together with the
 * dependent's own Assessment, which this row doesn't carry.
 */
export function creditedOfferings(row: ProviderDependencyRow): DependencyOffering[] {
  return row.offerings.filter(
    (offering) => offering.type === "FULL" && inheritanceSourceGivesCredit(dependencyOfferingSource(row, offering)),
  );
}

/**
 * The Shared Offerings that count at all right now (#125): the Provider is
 * Onboarded and the Control still applies to it. Removing the dependency ends
 * their part in the Control's status either way: a Control this System has
 * Fulfilled itself stops depending on the Provider's half.
 */
export function sharedOfferingsInPlay(row: ProviderDependencyRow): DependencyOffering[] {
  return row.offerings.filter((offering) => offering.type === "SHARED" && row.onboarded && offering.appliesToProvider);
}

/**
 * The confirmation shown before removing a dependency: says which Controls stop
 * being inherited from the Provider (the Full ones it gives credit for right
 * now) and which Shared Offerings stop counting. Another source (the
 * Organization, another Provider) may still give them credit, and the System's
 * own person-set Assessment is never touched.
 */
export function describeDependencyRemovalConfirmation(row: ProviderDependencyRow): string {
  const credited = creditedOfferings(row);
  const shared = sharedOfferingsInPlay(row);
  const head = `Remove the dependency on Provider "${row.name}"?`;
  if (credited.length === 0 && shared.length === 0) {
    return `${head} It gives this System no credit right now, so no Control's status changes.`;
  }
  const parts = [head];
  if (credited.length > 0) {
    parts.push(
      `These Controls stop being inherited from it: ${credited
        .map((offering) => offering.control.code)
        .join(", ")} (unless another source still gives them credit).`,
    );
  }
  if (shared.length > 0) {
    parts.push(
      `Its Shared Offerings (${shared
        .map((offering) => offering.control.code)
        .join(", ")}) stop counting: those Controls are then judged by this System's own Assessment alone.`,
    );
  }
  parts.push("Nothing is changed on this System's own Assessments.");
  return parts.join(" ");
}
