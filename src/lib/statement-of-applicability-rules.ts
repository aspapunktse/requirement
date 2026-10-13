import type { ControlApplicability, ControlAssessmentStatus } from "@prisma/client";
import {
  controlAppliesToSystem,
  type ControlImpactThresholds,
  type SystemClassification,
} from "@/lib/control-applicability";
import {
  inheritanceSourcesFor,
  resolveEffectiveStatus,
  type OwnAssessment,
  type ProviderSource,
} from "@/lib/effective-status";
import { frameworkLabel } from "@/lib/framework-label";
import { CONTROL_ASSESSMENT_STATUS_LABEL } from "@/lib/requirement-status-rules";

/**
 * The Statement of Applicability (PRD 0001 F-OUT.4, #145): one row per Control
 * of the Control Library, derived live and never stored. Pure and Prisma-free
 * (safe to import from client components); the bulk loader is in
 * `statement-of-applicability.ts`.
 *
 * - **Included** = the Control applies to the Organization or to at least one
 *   System (any System status, Draft Systems included); excluded otherwise.
 *   Declaring a System a Control applies to makes it included, with no stored state.
 * - **Inclusion justification** is generated from the Control's mappings into
 *   Published Frameworks. A Draft Framework's mapping never appears in it for
 *   anyone, and never makes a Control included.
 * - **Exclusion justification** is authored by a Compliance Manager or an Admin
 *   (#150) and stored on the Control. It is the row's reason only while the Control
 *   is excluded; for an included Control the row carries null (the stored text is
 *   kept, and shown again if the Control is excluded again). An excluded Control
 *   without one is flagged "justification missing".
 * - **Implementation status**: an Organizational Control shows the Organization
 *   Control Implementation's status; a Per-System Control a rollup of its
 *   effective status across the Systems it applies to; a Both Control both.
 *   An excluded Control has none.
 */

/**
 * When does a Control apply to the Organization? The product owner decided on
 * 2026-10-13 (comment on #145) to keep `true`: an Organizational or Both Control
 * applies to the Organization only if it is mapped to at least one Requirement of
 * a Published Framework, the same condition that lets a Control apply to Systems.
 * Set to `false` for the alternative: every Organizational and Both Control
 * always applies to the Organization, mapped or not. This is the one place to switch.
 */
export const ORGANIZATIONAL_CONTROL_NEEDS_PUBLISHED_MAPPING = true;

export type SoaMapping = {
  requirement: {
    code: string;
    framework: { id: string; name: string; version: string; status: string; isBase: boolean };
  };
};

export type SoaControl = ControlImpactThresholds & {
  id: string;
  code: string;
  title: string;
  applicability: ControlApplicability;
  deploymentFacets: { id: string }[];
  mappings: SoaMapping[];
  /** The stored exclusion justification (#150); null when none. */
  soaExclusionJustification: string | null;
};

export type SoaSystem = SystemClassification & { id: string };

const STATUSES = Object.keys(CONTROL_ASSESSMENT_STATUS_LABEL) as ControlAssessmentStatus[];

/** How many Systems the Control applies to, and how many of them are in each effective status. */
export type SystemRollup = {
  total: number;
  counts: Record<ControlAssessmentStatus, number>;
};

export type StatementOfApplicabilityRow = {
  controlId: string;
  code: string;
  title: string;
  applicability: ControlApplicability;
  included: boolean;
  appliesToOrganization: boolean;
  /** How many Systems (of any status) the Control applies to. */
  appliesToSystemCount: number;
  /** Generated; empty for an excluded Control. */
  inclusionJustification: string;
  /** The authored text of an excluded Control; null for an included Control (its stored text is kept, not shown) and when none is stored. */
  exclusionJustification: string | null;
  /** An excluded Control without an exclusion justification. */
  justificationMissing: boolean;
  /** The Organization Control Implementation's status (Organizational and Both, included only). */
  organizationStatus: ControlAssessmentStatus | null;
  /** The effective-status rollup (Per-System and Both, included only). */
  systemRollup: SystemRollup | null;
};

const collator = new Intl.Collator("en", { numeric: true });

/** Does the Control apply to the Organization? See `ORGANIZATIONAL_CONTROL_NEEDS_PUBLISHED_MAPPING`. */
export function controlAppliesToOrganization(control: Pick<SoaControl, "applicability" | "mappings">): boolean {
  if (control.applicability === "PER_SYSTEM") return false;
  if (!ORGANIZATIONAL_CONTROL_NEEDS_PUBLISHED_MAPPING) return true;
  return control.mappings.some((mapping) => mapping.requirement.framework.status === "PUBLISHED");
}

/**
 * "ISO/IEC 27001:2022 A.8.24, A.8.25; Other Law:1 3 kap. 2 §": the Requirements of
 * Published Frameworks the Control maps to, one entry per Framework (by label), its
 * Requirement codes after the label (numeric order, each once). Empty when there are none.
 */
export function inclusionJustification(mappings: SoaMapping[]): string {
  const codesByFramework = new Map<string, Set<string>>();
  for (const { requirement } of mappings) {
    if (requirement.framework.status !== "PUBLISHED") continue;
    const label = frameworkLabel(requirement.framework);
    const codes = codesByFramework.get(label) ?? new Set<string>();
    codes.add(requirement.code);
    codesByFramework.set(label, codes);
  }
  return [...codesByFramework.entries()]
    .sort(([a], [b]) => collator.compare(a, b))
    .map(([label, codes]) => `${label} ${[...codes].sort((a, b) => collator.compare(a, b)).join(", ")}`)
    .join("; ");
}

function emptyRollup(): SystemRollup {
  return {
    total: 0,
    counts: Object.fromEntries(STATUSES.map((status) => [status, 0])) as Record<ControlAssessmentStatus, number>,
  };
}

export type StatementInputs = {
  controls: SoaControl[];
  systems: SoaSystem[];
  /** The Organization's recorded status by Control id; a Control with no row reads as Not Started. */
  organizationStatusByControlId: ReadonlyMap<string, ControlAssessmentStatus>;
  /** Each System's own Assessment by System id, then Control id. */
  ownAssessmentsBySystemId: ReadonlyMap<string, ReadonlyMap<string, NonNullable<OwnAssessment>>>;
  /** Each System's Provider sources by System id, then Control id (`loadProviderSources`). */
  providerSourcesBySystemId: ReadonlyMap<string, ReadonlyMap<string, ProviderSource[]>>;
};

/** The Statement of Applicability rows, one per Control exactly once, ordered by code. */
export function deriveStatementOfApplicability(inputs: StatementInputs): StatementOfApplicabilityRow[] {
  const { systems, organizationStatusByControlId } = inputs;
  return [...inputs.controls]
    .sort((a, b) => collator.compare(a.code, b.code) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((control) => {
      const organizationStatus = organizationStatusByControlId.get(control.id);
      const appliesToOrganization = controlAppliesToOrganization(control);

      const rollup = emptyRollup();
      for (const system of systems) {
        if (!controlAppliesToSystem(control, system)) continue;
        const effective = resolveEffectiveStatus(
          inputs.ownAssessmentsBySystemId.get(system.id)?.get(control.id) ?? null,
          inheritanceSourcesFor(control, organizationStatus, inputs.providerSourcesBySystemId.get(system.id)?.get(control.id)),
        );
        rollup.total += 1;
        rollup.counts[effective.status] += 1;
      }

      const included = appliesToOrganization || rollup.total > 0;
      // Shown only while excluded; an included Control's stored text is kept but not presented as its reason.
      const exclusionJustification = included ? null : (control.soaExclusionJustification?.trim() || null);
      return {
        controlId: control.id,
        code: control.code,
        title: control.title,
        applicability: control.applicability,
        included,
        appliesToOrganization,
        appliesToSystemCount: rollup.total,
        inclusionJustification: included ? inclusionJustification(control.mappings) : "",
        exclusionJustification,
        justificationMissing: !included && !exclusionJustification?.trim(),
        organizationStatus: included && control.applicability !== "PER_SYSTEM" ? (organizationStatus ?? "NOT_STARTED") : null,
        systemRollup: included && control.applicability !== "ORGANIZATIONAL" ? rollup : null,
      };
    });
}

export type InclusionFilter = "ALL" | "INCLUDED" | "EXCLUDED";

/** The counts the filter shows. */
export function countByInclusion(rows: Pick<StatementOfApplicabilityRow, "included">[]) {
  const included = rows.filter((row) => row.included).length;
  return { all: rows.length, included, excluded: rows.length - included };
}

/** The longest exclusion justification the route accepts. */
export const EXCLUSION_JUSTIFICATION_MAX_LENGTH = 2000;

/** Trimmed; blank or null is "cleared" (null). */
export function normalizeExclusionJustification(text: string | null | undefined): string | null {
  const trimmed = text?.trim();
  return trimmed ? trimmed : null;
}

/**
 * Product-owner decision (2026-10-13, comment on #150): an exclusion justification
 * can't be added or changed while the Control is included, only cleared; a kept one
 * stays and is shown again if the Control is excluded again. This is the one place
 * the rule lives. Returns the refusal message, or null when the write is allowed.
 */
export function exclusionJustificationWriteRefusal(included: boolean, newText: string | null): string | null {
  if (included && newText !== null) {
    return "This Control is included, so it needs no exclusion justification; one can only be written while it is excluded";
  }
  return null;
}

/** How many excluded Controls have no exclusion justification. */
export function countJustificationsMissing(rows: Pick<StatementOfApplicabilityRow, "justificationMissing">[]) {
  return rows.filter((row) => row.justificationMissing).length;
}

/** "2 Fulfilled, 1 In Progress" for a rollup; "No Systems" when none. Zero counts are left out. */
export function describeRollup(rollup: SystemRollup): string {
  if (rollup.total === 0) return "No Systems";
  return STATUSES.filter((status) => rollup.counts[status] > 0)
    .map((status) => `${rollup.counts[status]} ${CONTROL_ASSESSMENT_STATUS_LABEL[status]}`)
    .join(", ");
}
