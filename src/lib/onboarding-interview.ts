import type { ImpactLevel } from "@prisma/client";
import { controlAppliesToSystem } from "@/lib/control-applicability";

/**
 * The System onboarding interview's rules (#258), pure and Prisma-free so the page can
 * re-evaluate every answer in the browser, and the per-option effect numbers need no request.
 *
 * The data comes from one read (`onboarding-catalog.ts`): the Per-System and Both Control library
 * with what applicability needs, plus the inheritance sources a chosen Provider or the Organization
 * would give. Whether a Control applies is `controlAppliesToSystem`, the same pure rule the server
 * uses; who does the work follows how the System page resolves a new System's effective status
 * (`resolveEffectiveStatus` with no Assessment of its own): a Full source that gives credit is
 * Covered for you, else a Shared Offering of a chosen Provider makes it Shared, else you do it.
 */

export type OnboardingGroup = "YOU" | "SHARED" | "COVERED";

/** The order the groups are listed in, with their one-line intros. */
export const ONBOARDING_GROUPS: { group: OnboardingGroup; title: string; intro: string; empty: string }[] = [
  { group: "YOU", title: "You do this", intro: "You implement these and provide the evidence.", empty: "Nothing for you to do yet." },
  { group: "SHARED", title: "Shared", intro: "A company service does part; you do the rest.", empty: "Nothing shared yet." },
  {
    group: "COVERED",
    title: "Covered for you",
    intro: "Done for you. Nothing to provide.",
    empty: "Pick the company services the system relies on to see what they cover.",
  },
];

/** A Provider's Offering that counts for a dependent: the Provider is Onboarded and the Control still applies to it. */
export type OnboardingOffering = {
  providerId: string;
  type: "FULL" | "SHARED";
  /** What the dependent must still do itself; null for a Full Offering. */
  customerResponsibility: string | null;
  /** The Provider's own Assessment of the Control is Fulfilled (only read for a Full Offering). */
  fulfilled: boolean;
};

export type OnboardingControl = {
  id: string;
  code: string;
  title: string;
  applicability: "PER_SYSTEM" | "BOTH";
  deploymentFacetIds: string[];
  minConfidentialityImpactLevel: ImpactLevel | null;
  minIntegrityImpactLevel: ImpactLevel | null;
  minAvailabilityImpactLevel: ImpactLevel | null;
  /** The Published Frameworks (base included) one of whose Requirements the Control is mapped to. */
  frameworkIds: string[];
  /** A Both Control the Organization has implemented (Fulfilled): a Full source that gives credit. */
  organizationFulfilled: boolean;
  offerings: OnboardingOffering[];
};

export type OnboardingFacet = { id: string; name: string; description: string | null };

export type OnboardingFramework = {
  id: string;
  name: string;
  version: string;
  description: string | null;
  isBase: boolean;
  onboardingQuestion: string | null;
  onboardingHint: string | null;
};

/** All a System owner may learn about a Provider here: its name and whether it is Onboarded. */
export type OnboardingProvider = { id: string; name: string; onboarded: boolean };

export type OnboardingCatalog = {
  deploymentFacets: OnboardingFacet[];
  /** Published Frameworks only. */
  frameworks: OnboardingFramework[];
  providers: OnboardingProvider[];
  controls: OnboardingControl[];
};

export type OnboardingAnswers = {
  deploymentFacetIds: string[];
  confidentialityImpactLevel: ImpactLevel | null;
  integrityImpactLevel: ImpactLevel | null;
  availabilityImpactLevel: ImpactLevel | null;
  /** Declared Framework Scope (never the base Framework, which is always in). */
  frameworkScopeIds: string[];
  providerIds: string[];
};

export const EMPTY_ANSWERS: OnboardingAnswers = {
  deploymentFacetIds: [],
  confidentialityImpactLevel: null,
  integrityImpactLevel: null,
  availabilityImpactLevel: null,
  frameworkScopeIds: [],
  providerIds: [],
};

export type OnboardingRow = {
  control: OnboardingControl;
  group: OnboardingGroup;
  /** Covered: who covers it ("the Organization" or a Provider's name). */
  coveredBy: string | null;
  /** Shared: the Providers that share it and what is still left to the System. */
  sharedBy: { providerId: string; providerName: string; customerResponsibility: string | null }[];
};

export type OnboardingEvaluation = {
  rows: OnboardingRow[];
  counts: Record<OnboardingGroup, number> & { applicable: number; library: number };
};

/** Does the Control apply to a System with these answers? */
export function applies(catalog: OnboardingCatalog, control: OnboardingControl, answers: OnboardingAnswers): boolean {
  const publishedFrameworks = new Map(catalog.frameworks.map((framework) => [framework.id, framework]));
  return controlAppliesToSystem(
    {
      ...control,
      deploymentFacets: control.deploymentFacetIds.map((id) => ({ id })),
      mappings: control.frameworkIds.flatMap((id) => {
        const framework = publishedFrameworks.get(id);
        return framework ? [{ requirement: { framework: { id, status: "PUBLISHED", isBase: framework.isBase } } }] : [];
      }),
    },
    {
      deploymentFacets: answers.deploymentFacetIds.map((id) => ({ id })),
      frameworkScopes: answers.frameworkScopeIds.map((id) => ({ id })),
      confidentialityImpactLevel: answers.confidentialityImpactLevel,
      integrityImpactLevel: answers.integrityImpactLevel,
      availabilityImpactLevel: answers.availabilityImpactLevel,
    },
  );
}

/** The applicable Controls for these answers, each with who does the work, in Control code order. */
export function evaluateOnboarding(catalog: OnboardingCatalog, answers: OnboardingAnswers): OnboardingEvaluation {
  const chosen = new Set(answers.providerIds);
  const providerName = new Map(catalog.providers.map((provider) => [provider.id, provider.name]));
  const rows: OnboardingRow[] = [];

  for (const control of catalog.controls) {
    if (!applies(catalog, control, answers)) continue;
    const offerings = control.offerings.filter((offering) => chosen.has(offering.providerId));
    const nameOf = (id: string) => providerName.get(id) ?? "a Provider";
    // A Full source that gives credit decides first (the Organization's, then Providers by name), as `resolveEffectiveStatus` does.
    const fullProvider = offerings
      .filter((offering) => offering.type === "FULL" && offering.fulfilled)
      .sort((a, b) => nameOf(a.providerId).localeCompare(nameOf(b.providerId)))[0];
    if (control.applicability === "BOTH" && control.organizationFulfilled) {
      rows.push({ control, group: "COVERED", coveredBy: "the Organization", sharedBy: [] });
    } else if (fullProvider) {
      rows.push({ control, group: "COVERED", coveredBy: nameOf(fullProvider.providerId), sharedBy: [] });
    } else {
      const shared = offerings
        .filter((offering) => offering.type === "SHARED")
        .map((offering) => ({
          providerId: offering.providerId,
          providerName: nameOf(offering.providerId),
          customerResponsibility: offering.customerResponsibility,
        }))
        .sort((a, b) => a.providerName.localeCompare(b.providerName));
      rows.push(
        shared.length > 0
          ? { control, group: "SHARED", coveredBy: null, sharedBy: shared }
          : { control, group: "YOU", coveredBy: null, sharedBy: [] },
      );
    }
  }
  rows.sort((a, b) => (a.control.code < b.control.code ? -1 : a.control.code > b.control.code ? 1 : 0));

  const count = (group: OnboardingGroup) => rows.filter((row) => row.group === group).length;
  return {
    rows,
    counts: { YOU: count("YOU"), SHARED: count("SHARED"), COVERED: count("COVERED"), applicable: rows.length, library: catalog.controls.length },
  };
}

/** What changes between two evaluations: Controls that start to apply, stop applying, or change who does the work. */
export type OnboardingEffect = { added: number; removed: number; moved: number };

export function compareEvaluations(before: OnboardingEvaluation, after: OnboardingEvaluation): OnboardingEffect {
  const was = new Map(before.rows.map((row) => [row.control.id, row.group]));
  const is = new Map(after.rows.map((row) => [row.control.id, row.group]));
  let added = 0;
  let removed = 0;
  let moved = 0;
  for (const [id, group] of is) {
    if (!was.has(id)) added += 1;
    else if (was.get(id) !== group) moved += 1;
  }
  for (const id of was.keys()) if (!is.has(id)) removed += 1;
  return { added, removed, moved };
}

export function isNoEffect(effect: OnboardingEffect) {
  return effect.added === 0 && effect.removed === 0 && effect.moved === 0;
}

/** The answers with `id` switched on (or off) in a list-valued answer. */
export function toggled(list: string[], id: string, on: boolean): string[] {
  const without = list.filter((item) => item !== id);
  return on ? [...without, id] : without;
}

/** How many of the applicable Controls an Onboarded Provider offers, for the Relies on step. */
export function providerOfferCount(evaluation: OnboardingEvaluation, providerId: string): number {
  return evaluation.rows.filter((row) => row.control.offerings.some((offering) => offering.providerId === providerId)).length;
}
