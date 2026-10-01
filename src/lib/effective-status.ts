// Pure effective-status rules (no Prisma), safe to import from client
// components. PRD 0001 F-IN.5, F-IN.6, F-OUT.2; issue #121; CONTEXT.md ->
// Control Inheritance.
//
// The effective status of a Control for one System is resolved live from the
// System's own Control Assessment and the inheritance sources that apply to it,
// and never stored or copied. Every reader that judges compliance or
// completeness (derived Requirement status, the Compliance Percentage, the
// submission check, the "needs assessment" count, the System page) goes through
// `resolveEffectiveStatus`. The DB loaders and the Change Event fan-out are in
// `effective-status-data.ts` and `organization-inheritance.ts`.
//
// Today the only source is the Organization Control Implementation (#121), a
// Full source for every System a Both Control applies to. Providers (#124) and
// Shared sources (#125) plug in as more `InheritanceSource` kinds and a longer
// `sources` list; callers pass the list in and read `status`/`source`/`sources`
// back, so they don't change.

import type { ControlApplicability, ControlAssessmentStatus } from "@prisma/client";
import { CONTROL_ASSESSMENT_STATUS_LABEL } from "@/lib/requirement-status-rules";

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

/** One place a System can inherit a Control's status from. */
export type InheritanceSource = {
  /** Where it comes from. #124 adds "PROVIDER". */
  kind: "ORGANIZATION";
  /** Full covers the Control entirely. #125 adds "SHARED". */
  type: "FULL";
  /** The source's own status (the Organization's implementation status). */
  status: ControlAssessmentStatus;
};

/** A source as resolved for one System: its own status, and whether that status gives credit. */
export type ResolvedSource = InheritanceSource & { givesCredit: boolean };

/** The System's own Control Assessment; null (no row) is an untouched Not Started one. */
export type OwnAssessment = {
  status: ControlAssessmentStatus;
  /** A person set it (`assessedById` is not null). A Capability's auto-fulfilment is not a person. */
  personSet: boolean;
} | null;

/** What decided the effective status: the System's own Assessment, or an inheritance source. */
export type EffectiveSource = { kind: "SYSTEM" } | InheritanceSource;

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
 * 2. Otherwise a Full source whose status gives credit (Fulfilled) makes it Fulfilled.
 * 3. Otherwise the System's own status (Not Started when there is no row).
 */
export function resolveEffectiveStatus(own: OwnAssessment, sources: InheritanceSource[]): EffectiveStatus {
  const resolved: ResolvedSource[] = sources.map((source) => ({ ...source, givesCredit: sourceGivesCredit(source.status) }));
  const ownStatus = own?.status ?? "NOT_STARTED";
  const credited = resolved.find((source) => source.givesCredit);

  if (own?.personSet) {
    return {
      status: ownStatus,
      source: { kind: "SYSTEM" },
      sources: resolved,
      overridesInherited: credited !== undefined && ownStatus !== "FULFILLED",
    };
  }
  if (credited) {
    return {
      status: "FULFILLED",
      source: { kind: credited.kind, type: credited.type, status: credited.status },
      sources: resolved,
      overridesInherited: false,
    };
  }
  return { status: ownStatus, source: { kind: "SYSTEM" }, sources: resolved, overridesInherited: false };
}

/**
 * The inheritance sources of a Control, given what the Organization recorded for
 * it. Only a Both Control is inherited (F-IN.6): it always has an Organization
 * source, Not Started while it has no recorded implementation (the missing-row
 * rule of #120). A Per-System Control has no source, and an Organizational one
 * isn't assessed per System yet (#122).
 */
export function inheritanceSourcesFor(
  control: { applicability: ControlApplicability },
  organizationStatus: ControlAssessmentStatus | undefined,
): InheritanceSource[] {
  if (control.applicability !== "BOTH") return [];
  return [{ kind: "ORGANIZATION", type: "FULL", status: organizationStatus ?? "NOT_STARTED" }];
}

const SOURCE_KIND_LABEL: Record<InheritanceSource["kind"], string> = {
  ORGANIZATION: "Organization",
};

/** "System-specific" or "Inherited from Organization": the source wording of the System page (F-OUT.2). */
export function effectiveSourceLabel(effective: Pick<EffectiveStatus, "source">): string {
  return effective.source.kind === "SYSTEM"
    ? "System-specific"
    : `Inherited from ${SOURCE_KIND_LABEL[effective.source.kind]}`;
}

/** One line per source with its own status, e.g. "Organization: Waived (gives no credit)". */
export function effectiveSourceDetails(effective: Pick<EffectiveStatus, "sources">): string[] {
  return effective.sources.map((source) => {
    const label = CONTROL_ASSESSMENT_STATUS_LABEL[source.status];
    return `${SOURCE_KIND_LABEL[source.kind]}: ${label}${source.givesCredit ? "" : " (gives no credit)"}`;
  });
}

/** Said when the System's own person-set Assessment overrides a Fulfilled source; null otherwise. */
export function effectiveOverrideNote(
  effective: Pick<EffectiveStatus, "overridesInherited" | "status" | "sources">,
): string | null {
  if (!effective.overridesInherited) return null;
  const credited = effective.sources.find((source) => source.givesCredit);
  return `This System's own Assessment (${CONTROL_ASSESSMENT_STATUS_LABEL[effective.status]}) overrides the ${
    credited ? SOURCE_KIND_LABEL[credited.kind] : "inherited"
  }'s Fulfilled status.`;
}

/**
 * The Change Event detail (F-IN.7) for a Control whose effective status moved
 * because a source changed, or null when it didn't. The one place the wording
 * lives.
 */
export function describeInheritedStatusChange(
  controlCode: string,
  before: Pick<EffectiveStatus, "status" | "source">,
  after: Pick<EffectiveStatus, "status" | "source">,
): string | null {
  if (before.status === after.status) return null;
  const afterLabel = CONTROL_ASSESSMENT_STATUS_LABEL[after.status];
  if (after.source.kind !== "SYSTEM") {
    return `${controlCode} is now ${afterLabel}, inherited from the ${SOURCE_KIND_LABEL[after.source.kind]}`;
  }
  if (before.source.kind !== "SYSTEM") {
    return `${controlCode} is no longer inherited from the ${SOURCE_KIND_LABEL[before.source.kind]} (now ${afterLabel})`;
  }
  return `${controlCode} is now ${afterLabel}`;
}
