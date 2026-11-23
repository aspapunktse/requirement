import type { Prisma } from "@prisma/client";

/**
 * A System's *effective* Framework Scope (#419, ADR 0016, CONTEXT.md "Framework Scope"): the Frameworks it declares, plus the
 * Frameworks of every Compliance Boundary it is in. The base Framework is always in scope on top of that and is never listed
 * here (see `isFrameworkInEffectiveScope`). Every reader of a System's scope reads this, not the declared rows alone.
 *
 * Prisma-free apart from types, so any loader can import it without a cycle. Two ways in:
 * - A loader that selects a System spreads `EFFECTIVE_SCOPE_SELECT` where it used to select `frameworkScopes`, then maps the
 *   rows through `withEffectiveScope`. The result keeps the `frameworkScopes: { id }[]` shape that `SystemClassification`,
 *   `getApplicableControls` and every caller already take, now holding the *effective* ids, so none of them changes shape.
 * - A query that filters Systems uses `systemsWithFrameworkInScope`, which matches a declared row or a Boundary's Framework.
 */

/** Spread into a System `select` or `include` in place of `frameworkScopes: { select: { id: true } }`. */
export const EFFECTIVE_SCOPE_SELECT = {
  frameworkScopes: { select: { id: true } },
  // A retired Compliance Boundary brings no Framework into scope (#424).
  boundaryMemberships: { where: { boundary: { retiredAt: null } }, select: { boundary: { select: { frameworks: { select: { frameworkId: true } } } } } },
} satisfies Prisma.SystemSelect;

type ScopeRows = {
  frameworkScopes: { id: string }[];
  boundaryMemberships: { boundary: { frameworks: { frameworkId: string }[] } }[];
};

/** The ids of the Frameworks in the System's effective scope (declared or Boundary-derived), sorted, without duplicates. */
export function effectiveScopeIds(system: ScopeRows): string[] {
  const ids = new Set(system.frameworkScopes.map((framework) => framework.id));
  for (const membership of system.boundaryMemberships) {
    for (const { frameworkId } of membership.boundary.frameworks) ids.add(frameworkId);
  }
  return [...ids].sort();
}

/**
 * The same System with `frameworkScopes` holding the effective scope's ids and `boundaryMemberships` dropped, so it can be
 * passed anywhere a `SystemClassification` is wanted.
 */
export function withEffectiveScope<T extends ScopeRows>(system: T): Omit<T, "boundaryMemberships" | "frameworkScopes"> & { frameworkScopes: { id: string }[] } {
  const { boundaryMemberships, frameworkScopes, ...rest } = system;
  void boundaryMemberships;
  void frameworkScopes;
  return { ...rest, frameworkScopes: effectiveScopeIds(system).map((id) => ({ id })) };
}

/**
 * Systems that have a Framework matching `framework` in their effective scope (a declared row, or a Framework of a Boundary
 * they are in). It does not add the base Framework: whoever asks about the base Framework does not need a filter, because
 * every System has it. Compose it in `where` as is, or in an `AND`/`OR`.
 */
export function systemsWithFrameworkInScope(framework: Prisma.FrameworkWhereInput): Prisma.SystemWhereInput {
  return {
    OR: [
      { frameworkScopes: { some: framework } },
      { boundaryMemberships: { some: { boundary: { retiredAt: null, frameworks: { some: { framework } } } } } },
    ],
  };
}

/**
 * The Frameworks in `systemId`'s effective scope, from the Framework side: declared on the System, or held by a Boundary it is
 * in. Like `systemsWithFrameworkInScope`, without the always-in-scope base Framework.
 */
export function frameworksInScopeOfSystem(systemId: string): Prisma.FrameworkWhereInput {
  return {
    OR: [
      { scopedSystems: { some: { id: systemId } } },
      { boundaries: { some: { boundary: { retiredAt: null, systems: { some: { systemId } } } } } },
    ],
  };
}

/** `withEffectiveScope` for the result of a `findUnique` or `findFirst`, which is null when there is no such System. */
export function withEffectiveScopeOrNull<T extends ScopeRows>(system: T | null) {
  return system === null ? null : withEffectiveScope(system);
}
