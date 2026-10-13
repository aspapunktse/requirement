import type { OnboardingStatus } from "@prisma/client";
import { isFrameworkInEffectiveScope } from "@/lib/requirement-status";

/**
 * Selecting an Internal Audit's Systems by filter (PRD 0001 F-IA.1, #153). Pure and
 * Prisma-free, so the route, the form and the unit tests share one definition.
 *
 * A filter has four optional criteria: a Framework (Framework Scope), a Deployment Facet, a
 * Business Unit and an onboarding status. They combine with AND, and a criterion that isn't
 * set matches every System, so an empty filter matches every System. Each criterion is one
 * value for now; a set of values (OR within a criterion, AND across) would change only
 * `matchesSystemFilter`. The filter is never stored: applying it adds the matching Systems
 * to the draft, and the audit keeps the Systems.
 */

export type SystemFilter = {
  frameworkId?: string;
  deploymentFacetId?: string;
  businessUnitId?: string;
  status?: OnboardingStatus;
};

/** The Framework a filter names, resolved: whether it is the base Framework and whether it is Published. */
export type FilterFramework = { id: string; status: string; isBase: boolean };

/** What the filter needs to know about a System. */
export type FilterableSystem = {
  status: OnboardingStatus;
  deploymentFacets: { id: string }[];
  businessUnits: { id: string }[];
  /** The Frameworks the System declared (not the base, which is in scope whether or not it is declared). */
  frameworkScopes: { id: string }[];
};

export const ONBOARDING_STATUS_LABEL: Record<OnboardingStatus, string> = {
  DRAFT: "Draft",
  IN_REVIEW: "In Review",
  APPROVED: "Approved",
  REJECTED: "Rejected",
  ONBOARDED: "Onboarded",
};

/** The onboarding statuses in lifecycle order, for the filter's select. */
export const ONBOARDING_STATUSES: OnboardingStatus[] = ["DRAFT", "IN_REVIEW", "APPROVED", "REJECTED", "ONBOARDED"];

export function isOnboardingStatus(value: string): value is OnboardingStatus {
  return (ONBOARDING_STATUSES as string[]).includes(value);
}

/** True when no criterion is set: such a filter matches every System. */
export function isEmptyFilter(filter: SystemFilter): boolean {
  return !filter.frameworkId && !filter.deploymentFacetId && !filter.businessUnitId && !filter.status;
}

/**
 * Does `system` match `filter`? `framework` is the resolved Framework of `filter.frameworkId`
 * (required when that is set). A Framework matches when it is in the System's effective Framework
 * Scope (`isFrameworkInEffectiveScope`: Published, and either the base Framework, which every
 * System has, or declared by the System). A Draft Framework is never in scope, so it matches nothing.
 */
export function matchesSystemFilter(
  filter: SystemFilter,
  system: FilterableSystem,
  framework?: FilterFramework | null,
): boolean {
  if (filter.frameworkId) {
    if (!framework || framework.id !== filter.frameworkId) return false;
    if (!isFrameworkInEffectiveScope(framework, system.frameworkScopes)) return false;
  }
  if (filter.deploymentFacetId && !system.deploymentFacets.some((facet) => facet.id === filter.deploymentFacetId)) return false;
  if (filter.businessUnitId && !system.businessUnits.some((unit) => unit.id === filter.businessUnitId)) return false;
  if (filter.status && system.status !== filter.status) return false;
  return true;
}
