import type { ImpactLevel } from "@prisma/client";
import { controlAppliesToSystem } from "@/lib/control-applicability";
import { canBeSuggested, declinesToLeaveOut, suggestionsFor, type Suggestion, type SuggestingType } from "@/lib/framework-suggestions";

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
  minSensitivityLevel: number | null;
  minIntegrityImpactLevel: ImpactLevel | null;
  minAvailabilityImpactLevel: ImpactLevel | null;
  /** The Published Frameworks (base included) one of whose Requirements the Control is mapped to. */
  frameworkIds: string[];
  /** A Both Control the Organization has implemented (Fulfilled): a Full source that gives credit. */
  organizationFulfilled: boolean;
  offerings: OnboardingOffering[];
};

/** `requiresVendorDetails`: a System declaring it must give its vendor name and service URL (#357). */
export type OnboardingFacet = { id: string; name: string; description: string | null; requiresVendorDetails: boolean };

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

export type OnboardingInformationType = {
  id: string;
  name: string;
  description: string | null;
  sensitivityLevel: number;
  /** The Published, non-base Frameworks the type suggests (ADR 0013); a Draft one suggests nothing, so it is not here. */
  suggestedFrameworkIds: string[];
};

export type OnboardingCatalog = {
  /** The five Sensitivity Levels in order (ADR 0011), for the Sensitivity step. */
  sensitivityLevels: { level: number; label: string; description: string }[];
  /** The Information Types a System can declare (#304, ADR 0012), highest level first: each sets a floor for the level. */
  informationTypes: OnboardingInformationType[];
  deploymentFacets: OnboardingFacet[];
  /** Published Frameworks only. */
  frameworks: OnboardingFramework[];
  providers: OnboardingProvider[];
  controls: OnboardingControl[];
};

export type OnboardingAnswers = {
  deploymentFacetIds: string[];
  sensitivityLevel: number | null;
  /** The Information Types the System handles; the level can't be below the highest of them. */
  informationTypeIds: string[];
  integrityImpactLevel: ImpactLevel | null;
  availabilityImpactLevel: ImpactLevel | null;
  /** Declared Framework Scope (never the base Framework, which is always in). */
  frameworkScopeIds: string[];
  /** The Frameworks an Information Type suggests that the owner answered No to (ADR 0013); recorded when the System is created. */
  declinedFrameworkIds: string[];
  providerIds: string[];
};

export const EMPTY_ANSWERS: OnboardingAnswers = {
  deploymentFacetIds: [],
  sensitivityLevel: null,
  informationTypeIds: [],
  integrityImpactLevel: null,
  availabilityImpactLevel: null,
  frameworkScopeIds: [],
  declinedFrameworkIds: [],
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

/**
 * The Frameworks the declared Information Types suggest (ADR 0013), in every state: in scope (answered Yes), left out
 * (answered No) or open (not answered; the System is created flagged). The interview asks these instead of the
 * Framework's own onboarding question (#258), so the owner is not asked twice.
 */
export function interviewSuggestions(catalog: OnboardingCatalog, answers: OnboardingAnswers): Suggestion[] {
  const frameworks = new Map(catalog.frameworks.map((framework) => [framework.id, framework]));
  const declared: SuggestingType[] = answers.informationTypeIds.flatMap((id) => {
    const type = catalog.informationTypes.find((candidate) => candidate.id === id);
    if (!type) return [];
    return [
      {
        id: type.id,
        name: type.name,
        suggestedFrameworks: type.suggestedFrameworkIds.flatMap((frameworkId) => {
          const framework = frameworks.get(frameworkId);
          return framework ? [{ id: framework.id, name: framework.name, version: framework.version, status: "PUBLISHED" as const, isBase: framework.isBase }] : [];
        }),
      },
    ];
  });
  const declines = answers.declinedFrameworkIds.flatMap((frameworkId) => declinesToLeaveOut(declared, frameworkId));
  return suggestionsFor(declared, answers.frameworkScopeIds, declines);
}

/** The Framework ids to send as declined: the answered No that are still suggested by a declared type and not in scope. */
export function declinedToSend(catalog: OnboardingCatalog, answers: OnboardingAnswers): string[] {
  const left = new Set(interviewSuggestions(catalog, answers).filter((suggestion) => suggestion.state === "left-out").map((suggestion) => suggestion.framework.id));
  return answers.declinedFrameworkIds.filter((id) => left.has(id) && !answers.frameworkScopeIds.includes(id));
}

/** Is this Framework one a suggestion covers, so the interview does not ask its own question (nor list it among the others)? */
export function isSuggested(suggestions: readonly Suggestion[], frameworkId: string): boolean {
  return suggestions.some((suggestion) => suggestion.framework.id === frameworkId && canBeSuggested(suggestion.framework));
}

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
      sensitivityLevel: answers.sensitivityLevel,
      integrityImpactLevel: answers.integrityImpactLevel,
      availabilityImpactLevel: answers.availabilityImpactLevel,
    },
  );
}

/** Control codes in natural order: A.5.3 before A.5.29. */
const CODE_COLLATOR = new Intl.Collator("en", { numeric: true });

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
  rows.sort((a, b) => CODE_COLLATOR.compare(a.control.code, b.control.code));

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
