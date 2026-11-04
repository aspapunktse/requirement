/**
 * The Frameworks an Information Type suggests (#300, ADR 0013), pure and Prisma-free so the server (the System page,
 * the Systems list, the System routes, the onboarding create) and the browser (the Profile tab, the interview) apply
 * one rule. The server is the authority; the browser uses this only to show what the server will accept.
 *
 * The rule, in one place:
 * - a **suggestion** is a Framework that a type the System declares suggests, when the Framework is Published and
 *   not the base Framework (which is always in scope). A Draft Framework linked to a type suggests nothing yet;
 * - a suggestion is **in scope** when the Framework is in the System's Framework Scope, **left out** when it is not
 *   and the owner has declined it for every declared type that suggests it, and **open** otherwise;
 * - a System with an open suggestion **has Suggested Frameworks to review** (flagged for its owner). The flag never
 *   blocks a submit, and nothing here changes a Framework Scope.
 *
 * Declines are kept per type, so a type another curator links later (or a second declared type that suggests the
 * same Framework) re-opens the suggestion: the owner decided about the type they were shown.
 */

export type SuggestedFramework = { id: string; name: string; version: string; status: "DRAFT" | "PUBLISHED"; isBase: boolean };

/** An Information Type a System declares, with the Frameworks it suggests (Draft and base ones included, filtered here). */
export type SuggestingType = { id: string; name: string; suggestedFrameworks: readonly SuggestedFramework[] };

/** The owner's decision to leave `frameworkId` out for the declared type `informationTypeId`. */
export type SuggestionDecline = { informationTypeId: string; frameworkId: string };

export type SuggestionState = "open" | "left-out" | "in-scope";

export type Suggestion = {
  framework: SuggestedFramework;
  /** The declared types that suggest it, by name. */
  types: { id: string; name: string }[];
  /** The subset of `types` the owner has not left out. */
  undecidedTypeIds: string[];
  state: SuggestionState;
};

const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);

/** Does this Framework suggest anything at all: Published and not the base Framework? */
export function canBeSuggested(framework: Pick<SuggestedFramework, "status" | "isBase">): boolean {
  return framework.status === "PUBLISHED" && !framework.isBase;
}

/**
 * Every suggestion for a System that declares `declared`, whatever its state, one per Framework, by Framework name.
 * `scopeIds` are the Frameworks in the System's Framework Scope; `declines` are its recorded decisions (a decline
 * for a type the System no longer declares is ignored).
 */
export function suggestionsFor(
  declared: readonly SuggestingType[],
  scopeIds: ReadonlySet<string> | readonly string[],
  declines: readonly SuggestionDecline[],
): Suggestion[] {
  const inScope = new Set(scopeIds);
  const declinedPairs = new Set(declines.map((decline) => `${decline.informationTypeId}|${decline.frameworkId}`));
  const byFramework = new Map<string, { framework: SuggestedFramework; types: { id: string; name: string }[] }>();
  for (const type of declared) {
    for (const framework of type.suggestedFrameworks) {
      if (!canBeSuggested(framework)) continue;
      const entry = byFramework.get(framework.id) ?? { framework, types: [] };
      entry.types.push({ id: type.id, name: type.name });
      byFramework.set(framework.id, entry);
    }
  }
  return [...byFramework.values()]
    .map(({ framework, types }): Suggestion => {
      const undecidedTypeIds = types.filter((type) => !declinedPairs.has(`${type.id}|${framework.id}`)).map((type) => type.id);
      const state: SuggestionState = inScope.has(framework.id) ? "in-scope" : undecidedTypeIds.length > 0 ? "open" : "left-out";
      return { framework, types: types.sort(byName), undecidedTypeIds, state };
    })
    .sort((a, b) => a.framework.name.localeCompare(b.framework.name) || a.framework.version.localeCompare(b.framework.version));
}

/** The suggestions that are still to be decided. */
export function openSuggestions(
  declared: readonly SuggestingType[],
  scopeIds: ReadonlySet<string> | readonly string[],
  declines: readonly SuggestionDecline[],
): Suggestion[] {
  return suggestionsFor(declared, scopeIds, declines).filter((suggestion) => suggestion.state === "open");
}

/** Is the System flagged: does it have at least one open suggestion? */
export function hasSuggestedFrameworksToReview(
  declared: readonly SuggestingType[],
  scopeIds: ReadonlySet<string> | readonly string[],
  declines: readonly SuggestionDecline[],
): boolean {
  return openSuggestions(declared, scopeIds, declines).length > 0;
}

/**
 * The declines to record to leave `frameworkId` out: one per declared type that suggests it. Empty when no declared
 * type suggests it (nothing to leave out, so the caller refuses or does nothing).
 */
export function declinesToLeaveOut(declared: readonly SuggestingType[], frameworkId: string): SuggestionDecline[] {
  return declared
    .filter((type) => type.suggestedFrameworks.some((framework) => framework.id === frameworkId && canBeSuggested(framework)))
    .map((type) => ({ informationTypeId: type.id, frameworkId }));
}

/** "Customer personal data", "Payroll and Source code", "A, B and C": names joined for a sentence. */
export function joinNames(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** The sentence that offers a suggestion: "Customer personal data usually falls under GDPR." */
export function suggestionSentence(suggestion: Pick<Suggestion, "types"> & { framework: { name: string } }): string {
  const names = suggestion.types.map((type) => type.name);
  return `${joinNames(names)} ${names.length === 1 ? "usually falls" : "usually fall"} under ${suggestion.framework.name}.`;
}
