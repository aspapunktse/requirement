import type { ControlOfferingType, UserRole } from "@prisma/client";
import { isSystemOwnerOrAdmin } from "@/lib/system-permissions";

/**
 * Who may mark a System as a Provider and maintain its Control Offerings, what
 * an Offering must contain, and how a change reads in the Change Event log
 * (PRD 0001 F-IN.2, ADR 0008, #123). Pure and Prisma-free, so the routes, the
 * System page and the unit table share one definition. The data side is in
 * `control-offerings.ts`.
 */

type Actor = { id: string; role: UserRole };

/** The inheritance types, in the order the UI offers them. */
export const CONTROL_OFFERING_TYPES: ControlOfferingType[] = ["FULL", "SHARED"];

export const CONTROL_OFFERING_TYPE_LABEL: Record<ControlOfferingType, string> = {
  FULL: "Full",
  SHARED: "Shared",
};

/**
 * Who may mark or unmark a System as a Provider and add, change or remove its
 * Offerings: the System's owner (whatever their role) or an Admin, at any
 * lifecycle stage. A Compliance Manager is read-only, even if recorded as the
 * owner (`isSystemOwnerOrAdmin`, the one owner rule).
 */
export function canManageProvider(user: Actor, system: { ownerId: string }) {
  return isSystemOwnerOrAdmin(user, system);
}

/**
 * Why an Offering with this type and customer-responsibility text (the values
 * it would have after the change) is refused, or null if it is fine. A Shared
 * Offering says what the depending System must still do itself, so it needs a
 * non-empty text. Judged on the resulting values, so clearing the text of a
 * Shared Offering is refused too, and a Full Offering needs none.
 */
export function controlOfferingRefusal(
  type: ControlOfferingType,
  customerResponsibility: string | null | undefined,
): string | null {
  if (type === "SHARED" && !customerResponsibility?.trim()) {
    return "A Shared Control Offering needs a customer responsibility text";
  }
  return null;
}

/**
 * The customer-responsibility text an Offering of this type stores: the trimmed
 * text for Shared, null for Full (changing Shared to Full clears it) or when
 * blank.
 */
export function storedCustomerResponsibility(
  type: ControlOfferingType,
  customerResponsibility: string | null | undefined,
): string | null {
  if (type === "FULL") return null;
  return customerResponsibility?.trim() || null;
}

export type OfferingValues = { type: ControlOfferingType; customerResponsibility: string | null };

/**
 * The values an Offering has after a change: `current` (null for a new
 * Offering) with the fields present in `patch` applied, then normalised. A
 * field left out of `patch` keeps its current value, so changing a Shared
 * Offering's text alone leaves its type, and changing only the type to Shared
 * keeps the text it already has (and is refused if there is none).
 */
export function resultingOfferingValues(
  current: OfferingValues | null,
  patch: { type?: ControlOfferingType; customerResponsibility?: string | null },
): OfferingValues {
  const type = patch.type ?? current?.type ?? "FULL";
  const text = patch.customerResponsibility !== undefined ? patch.customerResponsibility : (current?.customerResponsibility ?? null);
  return { type, customerResponsibility: storedCustomerResponsibility(type, text) };
}

/** Do two sets of Offering values differ? */
export function offeringValuesDiffer(a: OfferingValues, b: OfferingValues) {
  return a.type !== b.type || a.customerResponsibility !== b.customerResponsibility;
}

/** Why a System with Offerings can't stop being a Provider (the 409 text). */
export const UNMARK_PROVIDER_REFUSAL = "Remove this Provider's Control Offerings before it stops being a Provider";

/** Why a System that isn't a Provider can't have Offerings (the 409 text). */
export const NOT_A_PROVIDER_REFUSAL = "Mark this System as a Provider before adding Control Offerings";

/** Change Event wording for marking or unmarking a System as a Provider. */
export function describeProviderMarked(isProvider: boolean) {
  return isProvider ? "Marked as a Provider" : "No longer a Provider";
}

/** Change Event wording: `Control Offering for A.8.24 added (Shared)`. */
export function describeOfferingAdded(controlCode: string, type: ControlOfferingType) {
  return `Control Offering for ${controlCode} added (${CONTROL_OFFERING_TYPE_LABEL[type]})`;
}

/**
 * Change Event wording for a change, or null when nothing changed:
 * `Control Offering for A.8.24 changed (Full → Shared)`, or, when only a Shared
 * Offering's text moved, `... changed (customer responsibility updated)`.
 */
export function describeOfferingChanged(controlCode: string, before: OfferingValues, after: OfferingValues) {
  if (!offeringValuesDiffer(before, after)) return null;
  const change =
    before.type !== after.type
      ? `${CONTROL_OFFERING_TYPE_LABEL[before.type]} → ${CONTROL_OFFERING_TYPE_LABEL[after.type]}`
      : "customer responsibility updated";
  return `Control Offering for ${controlCode} changed (${change})`;
}

/** Change Event wording: `Control Offering for A.8.24 removed (was Full)`. */
export function describeOfferingRemoved(controlCode: string, type: ControlOfferingType) {
  return `Control Offering for ${controlCode} removed (was ${CONTROL_OFFERING_TYPE_LABEL[type]})`;
}
