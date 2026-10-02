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
// Control. A Provider source's half is satisfied only while the Provider is
// Onboarded (F-IN.4), the Control still applies to the Provider and the
// Provider's OWN stored status is Fulfilled: never the Provider's effective
// status, so nothing is inherited through a chain. A Full Offering covers the
// Control with that alone. A Shared Offering (#125, F-IN.5 rule 3) is only the
// Provider's half: the System's own Assessment is the customer's half, and
// credit needs both. With several sources the most favourable wins (OQ-2) and
// every one is listed. Callers pass the list in and read
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
 * Which Offering types can give credit: Full alone, Shared together with the
 * dependent's own half (#125). Also what the Assessment routes' cheap pre-check
 * filters on, so the fan-out of a Provider's status change never runs for an
 * Offering that can't move a dependent.
 */
export const CREDITED_OFFERING_TYPES: ControlOfferingType[] = ["FULL", "SHARED"];

/**
 * The status a Control is effectively when the System has done its own half of a
 * Shared Offering (own Assessment Fulfilled), no Full source gives credit and no
 * Shared source's Provider half is satisfied (product-owner decision D1 on #125):
 * In Progress. Not Met, but it passes the submission check and stays out of the
 * owner's "needs assessment" task, which counts Not Started: the owner has
 * nothing left to do, the Provider has.
 */
export const PROVIDER_HALF_MISSING_STATUS: ControlAssessmentStatus = "IN_PROGRESS";

/** Which own statuses count as the System's half of a Shared Offering (the customer responsibility). */
const CUSTOMER_HALF_STATUSES: ControlAssessmentStatus[] = ["FULFILLED"];

/**
 * Is the System's own half of a Shared Offering done? Looks at the own status and
 * nothing else, so an Assessment nobody set but that is Fulfilled counts as much as a
 * person-set one (product-owner decision D3 on #125).
 * The one place that says it, for every Shared source of a Control.
 */
export function customerHalfIsDone(own: OwnAssessment): boolean {
  return own !== null && CUSTOMER_HALF_STATUSES.includes(own.status);
}

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
  /** Full covers the Control entirely; Shared covers only the Provider's half and leaves the customer responsibility to the dependent (#125). */
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

/**
 * A source as resolved for one System: whether it gives credit (see
 * `sourceNoCreditReason`) and, for a Shared source only, whether the System's own
 * half is done (`customerHalfIsDone`), so the page can say which half is missing.
 * A Full source and the Organization's carry no `customerHalfDone`.
 */
export type ResolvedSource = InheritanceSource & { givesCredit: boolean; customerHalfDone?: boolean };

/**
 * Why a Provider's half of an Offering is not satisfied, in the order it is judged:
 * - "PROVIDER_NOT_ONBOARDED": F-IN.4, shown as *pending: Provider not Onboarded*;
 * - "NO_LONGER_APPLIES": the Offering's Control stopped applying to the Provider;
 * - "NOT_FULFILLED": the source's own status isn't one that gives credit (the
 *   only reason an Organization source can have).
 */
export type SourceHalfMissing = "PROVIDER_NOT_ONBOARDED" | "NO_LONGER_APPLIES" | "NOT_FULFILLED";

/**
 * Why an inheritance source gives no credit to a System: its own half is missing
 * (`SourceHalfMissing`), or, for a Shared Offering whose half is satisfied, the
 * System's own half is ("CUSTOMER_HALF_MISSING", #125).
 */
export type SourceNoCreditReason = SourceHalfMissing | "CUSTOMER_HALF_MISSING";

/** Is this a Shared Offering of a Provider: credit needs the System's own half too (#125)? */
export function isSharedSource<T extends InheritanceSource>(source: T): source is T & ProviderSource & { type: "SHARED" } {
  return source.kind === "PROVIDER" && source.type === "SHARED";
}

/**
 * Why the source's own half is not satisfied, or null when it is: the Provider is
 * Onboarded, the Control still applies to it and its OWN status is Fulfilled (or,
 * for the Organization, its status is). A function of the source object alone.
 * When several reasons hold, the first in `SourceHalfMissing`'s order is returned.
 */
export function sourceHalfMissing(source: InheritanceSource): SourceHalfMissing | null {
  if (source.kind === "PROVIDER") {
    if (!source.providerOnboarded) return "PROVIDER_NOT_ONBOARDED";
    if (!source.appliesToProvider) return "NO_LONGER_APPLIES";
  }
  return sourceGivesCredit(source.status) ? null : "NOT_FULFILLED";
}

/**
 * Why this source gives no credit, or null when it does. The one definition of
 * whether a source gives credit, and `resolveEffectiveStatus` goes through it. A
 * Full source or the Organization needs only its own half (`sourceHalfMissing`);
 * a Shared Offering also needs the System's own half, which is why it takes
 * `customerHalfDone` (`customerHalfIsDone` of the System's own Assessment; it
 * defaults to not done, the conservative answer, and is ignored for the others).
 * The Provider's half is reported first when both are missing.
 */
export function sourceNoCreditReason(source: InheritanceSource, customerHalfDone = false): SourceNoCreditReason | null {
  return sourceHalfMissing(source) ?? (isSharedSource(source) && !customerHalfDone ? "CUSTOMER_HALF_MISSING" : null);
}

/** Does this inheritance source give credit (a Shared one: given that the System's own half is done or not)? */
export function inheritanceSourceGivesCredit(source: InheritanceSource, customerHalfDone = false): boolean {
  return sourceNoCreditReason(source, customerHalfDone) === null;
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
  /** A person set it (`assessedById` is not null). */
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
 * The effective status of one Control for one System (F-IN.5). A pure function
 * of the System's own Assessment and the sources, so the client can re-run it
 * after a save. First match wins:
 *
 * | own Assessment                         | sources                                      | effective                          |
 * | -------------------------------------- | -------------------------------------------- | ---------------------------------- |
 * | person-set, not Fulfilled              | any                                          | own status (Waived, Not Applicable, In Progress, Not Started) |
 * | not person-set                         | a Full source gives credit                   | Fulfilled, inherited from it       |
 * | not Fulfilled (untouched, no row)      | none gives credit, Shared or not             | own status: the customer's half is not done |
 * | Fulfilled (person-set or not)            | no Shared source, or a Full source gives credit | Fulfilled, System-specific      |
 * | Fulfilled                              | a Shared source's Provider half is satisfied | Fulfilled, inherited from it (Shared) |
 * | Fulfilled                              | Shared source(s), none satisfied, no Full credit | In Progress (D1, `PROVIDER_HALF_MISSING_STATUS`) |
 *
 * A Full source (the Organization, or a Full Offering) gives credit by itself: it
 * is Fulfilled, and for a Provider also Onboarded and still applying
 * (`sourceHalfMissing`). A Shared Offering is the Provider's half only: the
 * System's own Assessment is the customer's half (`customerHalfIsDone`, which
 * looks at the status and not at who set it), so a Shared source gives credit
 * only while its Provider half is satisfied and the own status is Fulfilled
 * (`sourceNoCreditReason`). A person-set Waived or Not Applicable therefore wins
 * outright, and a person-set In Progress or Not Started still overrides a Full
 * source that gave credit (`overridesInherited`, which a Shared source never
 * sets: there the own status is the customer's half, not an override). With
 * several sources the most favourable wins (OQ-2): one that gives credit is
 * enough. Several giving credit: the first Full one, else the first Shared one,
 * in list order (`inheritanceSourcesFor` orders them), is the one reported as
 * deciding, since a Full source doesn't depend on the System's own half.
 */
export function resolveEffectiveStatus(own: OwnAssessment, sources: readonly InheritanceSource[]): EffectiveStatus {
  const ownStatus = own?.status ?? "NOT_STARTED";
  const customerHalfDone = customerHalfIsDone(own);
  const resolved: ResolvedSource[] = sources.map((source) => {
    const resolvedSource: ResolvedSource = {
      ...plainSource(source),
      givesCredit: inheritanceSourceGivesCredit(source, customerHalfDone),
    };
    if (isSharedSource(source)) resolvedSource.customerHalfDone = customerHalfDone;
    return resolvedSource;
  });
  const fullCredit = resolved.find((source) => !isSharedSource(source) && source.givesCredit);
  const sharedCredit = resolved.find((source) => isSharedSource(source) && source.givesCredit);
  const decided = (status: ControlAssessmentStatus, source: EffectiveSource, overridesInherited = false): EffectiveStatus => ({
    status,
    source,
    sources: resolved,
    overridesInherited,
  });

  if (own?.personSet && ownStatus !== "FULFILLED") return decided(ownStatus, { kind: "SYSTEM" }, fullCredit !== undefined);
  if (!own?.personSet && fullCredit) return decided("FULFILLED", plainSource(fullCredit));
  if (ownStatus !== "FULFILLED") return decided(ownStatus, { kind: "SYSTEM" });

  // The System's own half is done (Fulfilled).
  if (fullCredit || !resolved.some(isSharedSource)) return decided("FULFILLED", { kind: "SYSTEM" });
  if (sharedCredit) return decided("FULFILLED", plainSource(sharedCredit));
  return decided(PROVIDER_HALF_MISSING_STATUS, { kind: "SYSTEM" });
}

/**
 * The Shared sources a Control is waiting on: those that give no credit while the
 * System's own half is done and so hold the Control at In Progress (D1,
 * `PROVIDER_HALF_MISSING_STATUS`). Empty when the Control isn't held back. A
 * function of the resolved effective status alone (`resolveEffectiveStatus` can't
 * produce this status from a System-specific Fulfilled any other way).
 */
export function awaitedProviderHalves(
  effective: Pick<EffectiveStatus, "status" | "source"> & { sources: readonly ResolvedSource[] },
): ResolvedSource[] {
  if (effective.source.kind !== "SYSTEM" || effective.status !== PROVIDER_HALF_MISSING_STATUS) return [];
  const shared = effective.sources.filter(isSharedSource);
  if (shared.length === 0 || !shared.every((source) => source.customerHalfDone === true)) return [];
  return shared.filter((source) => !source.givesCredit);
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

/** `sourceName`, plus ` (Shared)` for a Shared Offering, so an event or a note says it was only a half. Full and the Organization are named as before. */
function sourceNameWithType(source: InheritanceSource): string {
  return isSharedSource(source) ? `${sourceName(source)} (${CONTROL_OFFERING_TYPE_LABEL.SHARED})` : sourceName(source);
}

/**
 * "System-specific", "Inherited from Organization", "Inherited from Provider
 * Landing Zone: Full" or "Inherited from Provider Landing Zone: Shared": the
 * source wording of the System page (F-OUT.2).
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

/** What a Shared Offering needs to give credit, as every page that lists one words it. */
export const SHARED_OFFERING_CREDIT_TEXT =
  "A Shared Offering gives credit only while the Provider's own status is Fulfilled and this System's own Assessment is Fulfilled too.";

/** The reasons a Full source or the Organization gives no credit, as the System page words them (inside parentheses). */
const NO_CREDIT_REASON_TEXT: Record<SourceHalfMissing, string> = {
  NOT_FULFILLED: "gives no credit",
  PROVIDER_NOT_ONBOARDED: PROVIDER_PENDING_TEXT,
  NO_LONGER_APPLIES: "this Control no longer applies to the Provider, gives no credit",
};

/** The same reasons for a Shared Offering, whose Provider half is what is missing. */
const SHARED_PROVIDER_HALF_TEXT: Record<SourceHalfMissing, string> = {
  NOT_FULFILLED: "the Provider's half is missing: the Provider has not Fulfilled it",
  PROVIDER_NOT_ONBOARDED: `the Provider's half is missing, ${PROVIDER_PENDING_TEXT}`,
  NO_LONGER_APPLIES: "the Provider's half is missing: this Control no longer applies to the Provider",
};

const SHARED_CUSTOMER_HALF_TEXT = "this System's own half is not Fulfilled";

/**
 * One line per source with its own status and, when it gives no credit, why:
 * "Organization: Waived (gives no credit)", `Provider "Landing Zone" (Full):
 * Fulfilled`, `Provider "Landing Zone" (Full): Fulfilled (pending: Provider not
 * Onboarded)`. A Shared Offering says which half is missing, the Provider's
 * (and why) and/or this System's own, and carries its customer-responsibility
 * text: `Provider "Landing Zone" (Shared): In Progress (the Provider's half is
 * missing: the Provider has not Fulfilled it; customer responsibility: ...)`.
 */
export function effectiveSourceDetails(effective: Pick<EffectiveStatus, "sources">): string[] {
  return effective.sources.map((source) => {
    const label = CONTROL_ASSESSMENT_STATUS_LABEL[source.status];
    if (source.kind === "ORGANIZATION") {
      const reason = sourceHalfMissing(source);
      return `Organization: ${label}${reason ? ` (${NO_CREDIT_REASON_TEXT[reason]})` : ""}`;
    }
    const notes: string[] = [];
    if (isSharedSource(source)) {
      const providerHalf = sourceHalfMissing(source);
      if (providerHalf) notes.push(SHARED_PROVIDER_HALF_TEXT[providerHalf]);
      if (source.customerHalfDone === false) notes.push(SHARED_CUSTOMER_HALF_TEXT);
      if (source.customerResponsibility) notes.push(`customer responsibility: ${source.customerResponsibility}`);
    } else {
      const reason = sourceHalfMissing(source);
      if (reason) notes.push(NO_CREDIT_REASON_TEXT[reason]);
    }
    return `Provider "${source.provider.name}" (${CONTROL_OFFERING_TYPE_LABEL[source.type]}): ${label}${
      notes.length > 0 ? ` (${notes.join("; ")})` : ""
    }`;
  });
}

/** Said when the System's own person-set Assessment overrides a Fulfilled Full source (never a Shared one); null otherwise. */
export function effectiveOverrideNote(
  effective: Pick<EffectiveStatus, "overridesInherited" | "status" | "sources">,
): string | null {
  if (!effective.overridesInherited) return null;
  const credited = effective.sources.find((source) => source.givesCredit && !isSharedSource(source));
  return `This System's own Assessment (${CONTROL_ASSESSMENT_STATUS_LABEL[effective.status]}) overrides ${
    credited ? sourceName(credited) : "the inherited"
  }'s Fulfilled status.`;
}

/** `waiting for Provider "A" or Provider "B" to provide their half`: who a held-back Control waits for (D1). */
function waitingFor(awaited: readonly ResolvedSource[]): string {
  return `waiting for ${awaited.map(sourceName).join(" or ")} to provide ${awaited.length === 1 ? "its" : "their"} half`;
}

/**
 * Said when a Control is held at In Progress because the System's own half of a
 * Shared Offering is done and the Provider's isn't (D1, `awaitedProviderHalves`);
 * null otherwise.
 */
export function effectiveAwaitingNote(effective: Pick<EffectiveStatus, "status" | "source" | "sources">): string | null {
  const awaited = awaitedProviderHalves(effective);
  if (awaited.length === 0) return null;
  return `This System's own half is Fulfilled, but it is ${waitingFor(awaited)}, so the Control is ${CONTROL_ASSESSMENT_STATUS_LABEL[effective.status]}.`;
}

/** The note the System page adds below a Control's sources: the override or the wait, whichever applies. */
export function effectiveNote(
  effective: Pick<EffectiveStatus, "overridesInherited" | "status" | "source" | "sources">,
): string | null {
  return effectiveOverrideNote(effective) ?? effectiveAwaitingNote(effective);
}

/** What the Change Event wording needs of an effective status: `sources` only to name who a held-back Control waits for. */
type EffectiveSummary = Pick<EffectiveStatus, "status" | "source"> & { sources?: readonly ResolvedSource[] };

/**
 * "now Fulfilled, inherited from the Organization" / `now Fulfilled, inherited
 * from Provider "Landing Zone"` / `now Fulfilled, inherited from Provider
 * "Landing Zone" (Shared)` / `now In Progress: waiting for Provider "Landing
 * Zone" to provide its half` / "now Not Started": what a Control is
 * effectively after something happened to it, for the Change Event of a reset
 * to inherited (#129) and of the System's own edit (#125). Uses the same wording
 * as `describeInheritedStatusChange`.
 */
export function describeEffectiveStatusNow(effective: EffectiveSummary): string {
  const label = CONTROL_ASSESSMENT_STATUS_LABEL[effective.status];
  const awaited = awaitedProviderHalves({ ...effective, sources: effective.sources ?? [] });
  if (awaited.length > 0) return `now ${label}: ${waitingFor(awaited)}`;
  if (isInheritanceSource(effective.source)) {
    return `now ${label}, inherited from ${sourceNameWithType(effective.source)}`;
  }
  return `now ${label}`;
}

/**
 * What to add to the Change Event of the System's own status edit (#125): what the
 * Control effectively is, when that isn't just the status that was stored: the
 * stored Fulfilled held at In Progress by a Provider that hasn't done its half,
 * or made Fulfilled through a Shared source. Null when the stored status says it
 * all. The one place the wording lives; it reuses `describeEffectiveStatusNow`.
 */
export function describeOwnEditEffect(storedStatus: ControlAssessmentStatus, effective: EffectiveSummary): string | null {
  if (effective.status === storedStatus && !isInheritanceSource(effective.source)) return null;
  return describeEffectiveStatusNow(effective);
}

/**
 * Why a System's own Assessment can't be reset to inherited (#129), in the
 * order the rules are checked:
 * - "NOT_APPLICABLE": the Control no longer applies to the System, so its row
 *   is stale (removing it is #109's business, not a reset);
 * - "NO_SOURCE": the Control has no Full inheritance source for this System (the
 *   Organization or a Full Offering): a Per-System Control of a System that
 *   depends on no Provider offering it, or one only a Shared Offering covers.
 *   There is nothing to go back to;
 * - "NOT_PERSON_SET": there is no row, or nobody set it (`assessedById` is
 *   null, which includes an untouched row and one a migration left Fulfilled), so
 *   it already follows its sources.
 */
export type ResetToInheritedRefusal = "NOT_APPLICABLE" | "NO_SOURCE" | "NOT_PERSON_SET";

/**
 * Can the System's own Assessment of a Control be reset to inherited (F-IN.5,
 * #129)? Null when it can, else the reason. Allowed whatever the sources'
 * current statuses are (a source that gives no credit just leaves the Control
 * Not Started), so it is the *existence* of a Full source that matters, never
 * its status or whether it gives credit: a pending Full Provider source (#124)
 * makes a reset possible too, because the Control would follow it as soon as it
 * gives credit. A Shared source doesn't count (product-owner decision D2 on
 * #125): the System's own Assessment is the customer's half of it, so there is
 * nothing to go back to and a reset would only clear the owner's half. The
 * source list comes from `inheritanceSourcesFor`. Who may do it is a separate
 * rule (`isSystemOwnerOrAdmin`); the route and the UI both run this one.
 */
export function resetToInheritedRefusal(input: {
  /** The Control applies to the System (it is not a stale row). */
  applies: boolean;
  sources: readonly InheritanceSource[];
  own: OwnAssessment;
}): ResetToInheritedRefusal | null {
  if (!input.applies) return "NOT_APPLICABLE";
  if (!input.sources.some((source) => !isSharedSource(source))) return "NO_SOURCE";
  if (!input.own?.personSet) return "NOT_PERSON_SET";
  return null;
}

const RESET_REFUSAL_MESSAGE: Record<ResetToInheritedRefusal, string> = {
  NOT_APPLICABLE: "This Control no longer applies to this System; remove its stale Assessment instead",
  NO_SOURCE:
    "This Control has no inheritance source for this System to go back to (the Organization or a Full Provider Offering; a Shared Offering covers only the Provider's half), so there is nothing to reset it to",
  NOT_PERSON_SET: "This Assessment was not set by a person, so it already follows the Control's inheritance sources",
};

/** The 409 message for a refused reset. */
export function resetToInheritedRefusalMessage(refusal: ResetToInheritedRefusal): string {
  return RESET_REFUSAL_MESSAGE[refusal];
}

/**
 * The Change Event detail (F-IN.7) for a Control whose effective status moved
 * because a source changed, or null when it didn't: `A.8.24 is now Fulfilled,
 * inherited from Provider "Landing Zone"`, `A.8.24 is now Fulfilled, inherited
 * from Provider "Landing Zone" (Shared)`, `A.8.24 is now In Progress: waiting for
 * Provider "Landing Zone" to provide its half` (the System's own half is done
 * and the Provider's isn't, D1) or `A.8.24 is no longer inherited from Provider
 * "Landing Zone" (now Not Started)`. The one place the wording lives. `sources`
 * is needed only to name who a held-back Control waits for.
 */
export function describeInheritedStatusChange(controlCode: string, before: EffectiveSummary, after: EffectiveSummary): string | null {
  if (before.status === after.status) return null;
  const afterLabel = CONTROL_ASSESSMENT_STATUS_LABEL[after.status];
  const awaited = awaitedProviderHalves({ ...after, sources: after.sources ?? [] });
  if (awaited.length > 0) return `${controlCode} is now ${afterLabel}: ${waitingFor(awaited)}`;
  if (isInheritanceSource(after.source)) {
    return `${controlCode} is now ${afterLabel}, inherited from ${sourceNameWithType(after.source)}`;
  }
  if (isInheritanceSource(before.source)) {
    return `${controlCode} is no longer inherited from ${sourceNameWithType(before.source)} (now ${afterLabel})`;
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
