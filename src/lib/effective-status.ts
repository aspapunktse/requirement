// Pure effective-status rules (no Prisma), safe to import from client
// components. PRD 0001 F-IN.3-F-IN.6, F-OUT.2; issues #121 and #124; CONTEXT.md
// -> Control Inheritance.
//
// The effective status of a Control for one System is resolved live from the
// System's own Control Assessment and the inheritance sources that apply to it,
// and never stored or copied. Every reader that judges compliance or
// completeness (derived Requirement status, the Compliance Percentage, the
// submission check, the "needs assessment" count, the System page) goes through
// `resolveEffectiveStatus`. The DB loaders and the Change Event fan-outs are in
// `effective-status-data.ts`, `organization-inheritance.ts` and
// `provider-inheritance.ts`.
//
// The sources are the Organization Control Implementation (#121), a Full source
// for every System a Both Control applies to, and the Control Offerings of the
// Providers the System depends on (#124, F-IN.3), for a Per-System or a Both
// Control. A Provider source gives credit only while its Offering is Full, the
// Provider is Onboarded (F-IN.4), the Control still applies to the Provider and
// the Provider's OWN stored status is Fulfilled: never the Provider's effective
// status, so nothing is inherited through a chain. Shared Offerings are listed
// but give no credit until #125. With several sources the most favourable wins
// (OQ-2) and every one is listed. Callers pass the list in and read
// `status`/`source`/`sources` back.
//
// An Organizational Control is the other case (#122): it has no per-System
// Assessment at all, so nothing is inherited and nothing is overridden. Its
// status for a System simply *is* the Organization's implementation status, and
// `resolveImplementedByOrganization` says so with its own source kind.

import type { ControlApplicability, ControlAssessmentStatus, ControlOfferingType } from "@prisma/client";
import { CONTROL_ASSESSMENT_STATUS_LABEL } from "@/lib/requirement-status-rules";
import { CONTROL_OFFERING_TYPE_LABEL } from "@/lib/control-offering-rules";

/**
 * Which statuses of an inheritance source give credit to the System. Only
 * Fulfilled is inherited (product-owner decision on #121): a Waived, Not
 * Applicable, In Progress or Not Started source gives nothing, and the System's
 * own status stands.
 */
export const INHERITED_SOURCE_STATUSES: ControlAssessmentStatus[] = ["FULFILLED"];

/** Does a source with this status give credit to the Systems that inherit from it? */
export function sourceGivesCredit(status: ControlAssessmentStatus): boolean {
  return INHERITED_SOURCE_STATUSES.includes(status);
}

/**
 * Which Offering types give credit. Only Full does for now (#124); #125 adds
 * Shared here. Also what the Assessment routes' cheap pre-check filters on, so
 * the fan-out of a Provider's status change never runs for an Offering that
 * can't move a dependent.
 */
export const CREDITED_OFFERING_TYPES: ControlOfferingType[] = ["FULL"];

/** The Organization's implementation of a Control, inherited by every System a Both Control applies to. */
export type OrganizationSource = {
  kind: "ORGANIZATION";
  /** Full covers the Control entirely. */
  type: "FULL";
  /** The Organization's implementation status. */
  status: ControlAssessmentStatus;
};

/**
 * A Provider's Control Offering as a System that depends on the Provider sees
 * it (#124). Plain JSON: everything the rule and the wording need is on the
 * object, so the client can re-resolve after a save without the server.
 */
export type ProviderSource = {
  kind: "PROVIDER";
  /** Full covers the Control entirely; Shared leaves the customer responsibility to the dependent (credit is #125). */
  type: ControlOfferingType;
  /** The Provider's OWN stored Assessment status of the Control (Not Started with no row), never its effective status. */
  status: ControlAssessmentStatus;
  /** All a System that can't see the Provider is told about it: its name. */
  provider: { id: string; name: string };
  /** An Offering counts only while the Provider is Onboarded (F-IN.4). */
  providerOnboarded: boolean;
  /** The Control still applies to the Provider (an Offering is kept when it stops, and gives no credit). */
  appliesToProvider: boolean;
  /** What the dependent must still do itself; null for a Full Offering. */
  customerResponsibility: string | null;
};

/** One place a System can inherit a Control's status from. */
export type InheritanceSource = OrganizationSource | ProviderSource;

/** A source as resolved for one System: its own status, and whether it gives credit (see `sourceNoCreditReason`). */
export type ResolvedSource = InheritanceSource & { givesCredit: boolean };

/**
 * Why an inheritance source gives no credit, in the order it is judged:
 * - "PROVIDER_NOT_ONBOARDED": F-IN.4, shown as *pending: Provider not Onboarded*;
 * - "NO_LONGER_APPLIES": the Offering's Control stopped applying to the Provider;
 * - "SHARED": a Shared Offering gives no credit yet (#125);
 * - "NOT_FULFILLED": the source's own status isn't one that gives credit.
 */
export type SourceNoCreditReason = "PROVIDER_NOT_ONBOARDED" | "NO_LONGER_APPLIES" | "SHARED" | "NOT_FULFILLED";

/**
 * Why this source gives no credit, or null when it does. The one definition of
 * whether a source gives credit, a function of the source object alone (so the
 * client can run it too); `resolveEffectiveStatus` goes through it. When several
 * reasons hold, the first in `SourceNoCreditReason`'s order is returned.
 */
export function sourceNoCreditReason(source: InheritanceSource): SourceNoCreditReason | null {
  if (source.kind === "PROVIDER") {
    if (!source.providerOnboarded) return "PROVIDER_NOT_ONBOARDED";
    if (!source.appliesToProvider) return "NO_LONGER_APPLIES";
    if (!CREDITED_OFFERING_TYPES.includes(source.type)) return "SHARED";
  }
  return sourceGivesCredit(source.status) ? null : "NOT_FULFILLED";
}

/** Does this inheritance source give credit? */
export function inheritanceSourceGivesCredit(source: InheritanceSource): boolean {
  return sourceNoCreditReason(source) === null;
}

/** The source without anything resolved for a System, so one that went through JSON and back is clean again. */
function plainSource(source: InheritanceSource): InheritanceSource {
  if (source.kind === "ORGANIZATION") return { kind: "ORGANIZATION", type: source.type, status: source.status };
  return {
    kind: "PROVIDER",
    type: source.type,
    status: source.status,
    provider: { id: source.provider.id, name: source.provider.name },
    providerOnboarded: source.providerOnboarded,
    appliesToProvider: source.appliesToProvider,
    customerResponsibility: source.customerResponsibility,
  };
}

/** The System's own Control Assessment; null (no row) is an untouched Not Started one. */
export type OwnAssessment = {
  status: ControlAssessmentStatus;
  /** A person set it (`assessedById` is not null). A Capability's auto-fulfilment is not a person. */
  personSet: boolean;
} | null;

/**
 * What decided the effective status: the System's own Assessment, an inheritance
 * source, or (an Organizational Control, #122) the Organization implementing the
 * Control directly, with no per-System Assessment to fall back on.
 */
export type EffectiveSource = { kind: "SYSTEM" } | InheritanceSource | { kind: "ORGANIZATION_DIRECT" };

/** Is this source an inheritance source (not the System's own Assessment, nor the Organization's direct implementation)? */
export function isInheritanceSource(source: EffectiveSource): source is InheritanceSource {
  return source.kind !== "SYSTEM" && source.kind !== "ORGANIZATION_DIRECT";
}

export type EffectiveStatus = {
  status: ControlAssessmentStatus;
  /** Which one decided. */
  source: EffectiveSource;
  /** Every source that applies, whether or not it gave credit ("every source is shown"). */
  sources: ResolvedSource[];
  /** The System's own person-set Assessment overrides a source that would otherwise have made it Fulfilled. */
  overridesInherited: boolean;
};

/**
 * The effective status of one Control for one System (F-IN.5, as far as this
 * issue goes):
 *
 * 1. A person-set own Assessment wins, whatever it says.
 * 2. Otherwise a source that gives credit (`sourceNoCreditReason`: a Fulfilled
 *    Organization implementation or a Full, Fulfilled Offering of an Onboarded
 *    Provider) makes it Fulfilled.
 * 3. Otherwise the System's own status (Not Started when there is no row).
 *
 * With several sources the most favourable wins (OQ-2). Only Fulfilled gives
 * credit, so that is "any source gives credit"; the first such source in list
 * order is the one reported as deciding (`inheritanceSourcesFor` orders them).
 */
export function resolveEffectiveStatus(own: OwnAssessment, sources: readonly InheritanceSource[]): EffectiveStatus {
  const resolved: ResolvedSource[] = sources.map((source) => ({
    ...plainSource(source),
    givesCredit: inheritanceSourceGivesCredit(source),
  }));
  const ownStatus = own?.status ?? "NOT_STARTED";
  const credited = sources.find(inheritanceSourceGivesCredit);

  if (own?.personSet) {
    return {
      status: ownStatus,
      source: { kind: "SYSTEM" },
      sources: resolved,
      overridesInherited: credited !== undefined && ownStatus !== "FULFILLED",
    };
  }
  if (credited) {
    return { status: "FULFILLED", source: plainSource(credited), sources: resolved, overridesInherited: false };
  }
  return { status: ownStatus, source: { kind: "SYSTEM" }, sources: resolved, overridesInherited: false };
}

/**
 * The effective status of an Organizational Control for a System (#122): the
 * Organization Control Implementation's status, Not Started while it has no
 * recorded implementation (the missing-row rule of #120). The Control has no
 * per-System Assessment, so there is no own status to resolve and nothing is
 * inherited over anything; the status is returned as it is, and the caller
 * judges it like any Assessment status (`isEffectivelyFulfilled`: Waived and
 * Not Applicable count, except on a strict Framework). This is deliberately not
 * the Both rule of `resolveEffectiveStatus`, where only a Fulfilled source gives credit.
 */
export function resolveImplementedByOrganization(organizationStatus: ControlAssessmentStatus | undefined): EffectiveStatus {
  return {
    status: organizationStatus ?? "NOT_STARTED",
    source: { kind: "ORGANIZATION_DIRECT" },
    sources: [],
    overridesInherited: false,
  };
}

/** Code-unit order (not locale order), so the source list is the same on every server and in every test. */
function compareCodeUnits(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * The inheritance sources of a Control, given what the Organization recorded for
 * it and the Offerings of the Providers the System depends on (`providerSources`,
 * from `loadProviderSources`). In a deterministic order: the Organization first,
 * then Providers by name (code-unit order) and then id.
 * - A Both Control always has an Organization source (F-IN.6), Not Started while
 *   it has no recorded implementation (the missing-row rule of #120).
 * - A Per-System or a Both Control has a source for every Provider Offering of it.
 * - An Organizational Control has none: it is implemented by the Organization
 *   directly, not inherited (`resolveImplementedByOrganization`).
 */
export function inheritanceSourcesFor(
  control: { applicability: ControlApplicability },
  organizationStatus: ControlAssessmentStatus | undefined,
  providerSources: readonly ProviderSource[] = [],
): InheritanceSource[] {
  if (control.applicability === "ORGANIZATIONAL") return [];
  const sources: InheritanceSource[] = [];
  if (control.applicability === "BOTH") {
    sources.push({ kind: "ORGANIZATION", type: "FULL", status: organizationStatus ?? "NOT_STARTED" });
  }
  const providers = [...providerSources].sort(
    (a, b) => compareCodeUnits(a.provider.name, b.provider.name) || compareCodeUnits(a.provider.id, b.provider.id),
  );
  return [...sources, ...providers];
}

/** "the Organization" or `Provider "Landing Zone"`: how a source is named inside a sentence. */
function sourceName(source: InheritanceSource): string {
  return source.kind === "ORGANIZATION" ? "the Organization" : `Provider "${source.provider.name}"`;
}

/**
 * "System-specific", "Inherited from Organization" or "Inherited from Provider
 * Landing Zone: Full": the source wording of the System page (F-OUT.2).
 */
export function effectiveSourceLabel(effective: Pick<EffectiveStatus, "source">): string {
  const { source } = effective;
  if (source.kind === "SYSTEM") return "System-specific";
  if (source.kind === "ORGANIZATION_DIRECT") return "Implemented by the Organization";
  if (source.kind === "PROVIDER") {
    return `Inherited from Provider ${source.provider.name}: ${CONTROL_OFFERING_TYPE_LABEL[source.type]}`;
  }
  return "Inherited from Organization";
}

/** How a Provider that isn't Onboarded yet is shown, wherever it is (F-IN.4). */
export const PROVIDER_PENDING_TEXT = "pending: Provider not Onboarded";

/** The reasons a source gives no credit, as the System page words them (inside parentheses). */
const NO_CREDIT_REASON_TEXT: Record<SourceNoCreditReason, string> = {
  NOT_FULFILLED: "gives no credit",
  PROVIDER_NOT_ONBOARDED: PROVIDER_PENDING_TEXT,
  NO_LONGER_APPLIES: "this Control no longer applies to the Provider, gives no credit",
  SHARED: "a Shared Offering gives no credit yet",
};

/**
 * One line per source with its own status and, when it gives no credit, why:
 * "Organization: Waived (gives no credit)", `Provider "Landing Zone" (Full):
 * Fulfilled`, `Provider "Landing Zone" (Full): Fulfilled (pending: Provider not
 * Onboarded)`. A Shared Offering also carries its customer-responsibility text.
 */
export function effectiveSourceDetails(effective: Pick<EffectiveStatus, "sources">): string[] {
  return effective.sources.map((source) => {
    const label = CONTROL_ASSESSMENT_STATUS_LABEL[source.status];
    const reason = sourceNoCreditReason(source);
    if (source.kind === "ORGANIZATION") {
      return `Organization: ${label}${reason ? ` (${NO_CREDIT_REASON_TEXT[reason]})` : ""}`;
    }
    const notes = reason ? [NO_CREDIT_REASON_TEXT[reason]] : [];
    if (source.type === "SHARED" && source.customerResponsibility) {
      notes.push(`customer responsibility: ${source.customerResponsibility}`);
    }
    return `Provider "${source.provider.name}" (${CONTROL_OFFERING_TYPE_LABEL[source.type]}): ${label}${
      notes.length > 0 ? ` (${notes.join("; ")})` : ""
    }`;
  });
}

/** Said when the System's own person-set Assessment overrides a Fulfilled source; null otherwise. */
export function effectiveOverrideNote(
  effective: Pick<EffectiveStatus, "overridesInherited" | "status" | "sources">,
): string | null {
  if (!effective.overridesInherited) return null;
  const credited = effective.sources.find((source) => source.givesCredit);
  return `This System's own Assessment (${CONTROL_ASSESSMENT_STATUS_LABEL[effective.status]}) overrides ${
    credited ? sourceName(credited) : "the inherited"
  }'s Fulfilled status.`;
}

/**
 * "now Fulfilled, inherited from the Organization" / `now Fulfilled, inherited
 * from Provider "Landing Zone"` / "now Not Started": what a Control is
 * effectively after something happened to it, for the Change Event of a reset
 * to inherited (#129). Uses the same wording as `describeInheritedStatusChange`.
 */
export function describeEffectiveStatusNow(effective: Pick<EffectiveStatus, "status" | "source">): string {
  const label = CONTROL_ASSESSMENT_STATUS_LABEL[effective.status];
  if (isInheritanceSource(effective.source)) {
    return `now ${label}, inherited from ${sourceName(effective.source)}`;
  }
  return `now ${label}`;
}

/**
 * Why a System's own Assessment can't be reset to inherited (#129), in the
 * order the rules are checked:
 * - "NOT_APPLICABLE": the Control no longer applies to the System, so its row
 *   is stale (removing it is #109's business, not a reset);
 * - "NO_SOURCE": the Control has no inheritance source for this System (a
 *   Per-System Control of a System that depends on no Provider offering it), so
 *   there is nothing to go back to;
 * - "NOT_PERSON_SET": there is no row, or nobody set it (`assessedById` is
 *   null, which includes an untouched row and one a Capability fulfilled), so
 *   it already follows its sources.
 */
export type ResetToInheritedRefusal = "NOT_APPLICABLE" | "NO_SOURCE" | "NOT_PERSON_SET";

/**
 * Can the System's own Assessment of a Control be reset to inherited (F-IN.5,
 * #129)? Null when it can, else the reason. Allowed whatever the sources'
 * current statuses are (a source that gives no credit just leaves the Control
 * Not Started), so it is the *existence* of a source that matters, never its
 * status or whether it gives credit: a pending or Shared Provider source (#124)
 * makes a reset possible too, because the Control would follow it as soon as it
 * gives credit. The source list comes from `inheritanceSourcesFor`. Who may do
 * it is a separate rule (`isSystemOwnerOrAdmin`); the route and the UI both run
 * this one.
 */
export function resetToInheritedRefusal(input: {
  /** The Control applies to the System (it is not a stale row). */
  applies: boolean;
  sources: readonly InheritanceSource[];
  own: OwnAssessment;
}): ResetToInheritedRefusal | null {
  if (!input.applies) return "NOT_APPLICABLE";
  if (input.sources.length === 0) return "NO_SOURCE";
  if (!input.own?.personSet) return "NOT_PERSON_SET";
  return null;
}

const RESET_REFUSAL_MESSAGE: Record<ResetToInheritedRefusal, string> = {
  NOT_APPLICABLE: "This Control no longer applies to this System; remove its stale Assessment instead",
  NO_SOURCE: "This Control has no inheritance source for this System, so there is nothing to reset it to",
  NOT_PERSON_SET: "This Assessment was not set by a person, so it already follows the Control's inheritance sources",
};

/** The 409 message for a refused reset. */
export function resetToInheritedRefusalMessage(refusal: ResetToInheritedRefusal): string {
  return RESET_REFUSAL_MESSAGE[refusal];
}

/**
 * The Change Event detail (F-IN.7) for a Control whose effective status moved
 * because a source changed, or null when it didn't: `A.8.24 is now Fulfilled,
 * inherited from Provider "Landing Zone"` or `A.8.24 is no longer inherited from
 * Provider "Landing Zone" (now Not Started)`. The one place the wording lives.
 */
export function describeInheritedStatusChange(
  controlCode: string,
  before: Pick<EffectiveStatus, "status" | "source">,
  after: Pick<EffectiveStatus, "status" | "source">,
): string | null {
  if (before.status === after.status) return null;
  const afterLabel = CONTROL_ASSESSMENT_STATUS_LABEL[after.status];
  if (isInheritanceSource(after.source)) {
    return `${controlCode} is now ${afterLabel}, inherited from ${sourceName(after.source)}`;
  }
  if (isInheritanceSource(before.source)) {
    return `${controlCode} is no longer inherited from ${sourceName(before.source)} (now ${afterLabel})`;
  }
  return `${controlCode} is now ${afterLabel}`;
}

/**
 * The System-less Change Event detail (F-CE.1, F-CE.2; #122) for a change of an
 * Organizational Control's implementation status, or null when the status
 * didn't change (a description-only or no-op edit writes no event). The one
 * place the wording lives.
 */
export function describeOrganizationImplementationChange(
  controlCode: string,
  before: ControlAssessmentStatus,
  after: ControlAssessmentStatus,
): string | null {
  if (before === after) return null;
  return `${controlCode} Organization Control Implementation changed from ${CONTROL_ASSESSMENT_STATUS_LABEL[before]} to ${CONTROL_ASSESSMENT_STATUS_LABEL[after]}`;
}
