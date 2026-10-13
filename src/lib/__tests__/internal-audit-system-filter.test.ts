import { describe, expect, it } from "vitest";
import {
  isEmptyFilter,
  isOnboardingStatus,
  matchesSystemFilter,
  type FilterableSystem,
  type FilterFramework,
} from "../internal-audit-system-filter";

const base: FilterFramework = { id: "base", status: "PUBLISHED", isBase: true };
const nis2: FilterFramework = { id: "nis2", status: "PUBLISHED", isBase: false };
const draft: FilterFramework = { id: "draft", status: "DRAFT", isBase: false };

function system(overrides: Partial<FilterableSystem> = {}): FilterableSystem {
  return { status: "DRAFT", deploymentFacets: [], businessUnits: [], frameworkScopes: [], ...overrides };
}

const cloudNis2Finance = system({
  status: "ONBOARDED",
  deploymentFacets: [{ id: "cloud" }],
  businessUnits: [{ id: "finance" }],
  frameworkScopes: [{ id: "nis2" }],
});

describe("matchesSystemFilter (#153)", () => {
  it("matches every System when nothing is set", () => {
    expect(isEmptyFilter({})).toBe(true);
    expect(matchesSystemFilter({}, system())).toBe(true);
    expect(matchesSystemFilter({}, cloudNis2Finance)).toBe(true);
  });

  it("filters by Framework Scope alone: declared, or the base for everyone", () => {
    expect(matchesSystemFilter({ frameworkId: "nis2" }, cloudNis2Finance, nis2)).toBe(true);
    expect(matchesSystemFilter({ frameworkId: "nis2" }, system(), nis2)).toBe(false);
    expect(matchesSystemFilter({ frameworkId: "base" }, system(), base)).toBe(true);
    expect(matchesSystemFilter({ frameworkId: "base" }, cloudNis2Finance, base)).toBe(true);
  });

  it("matches nothing for a Draft Framework, even one the System declared", () => {
    const declaredDraft = system({ frameworkScopes: [{ id: "draft" }] });
    expect(matchesSystemFilter({ frameworkId: "draft" }, declaredDraft, draft)).toBe(false);
  });

  it("matches nothing for a Framework that wasn't resolved", () => {
    expect(matchesSystemFilter({ frameworkId: "nis2" }, cloudNis2Finance, null)).toBe(false);
    expect(matchesSystemFilter({ frameworkId: "nis2" }, cloudNis2Finance, base)).toBe(false);
  });

  it("filters by Deployment Facet alone", () => {
    expect(matchesSystemFilter({ deploymentFacetId: "cloud" }, cloudNis2Finance)).toBe(true);
    expect(matchesSystemFilter({ deploymentFacetId: "onprem" }, cloudNis2Finance)).toBe(false);
    expect(matchesSystemFilter({ deploymentFacetId: "cloud" }, system())).toBe(false);
  });

  it("filters by Business Unit alone", () => {
    expect(matchesSystemFilter({ businessUnitId: "finance" }, cloudNis2Finance)).toBe(true);
    expect(matchesSystemFilter({ businessUnitId: "hr" }, cloudNis2Finance)).toBe(false);
  });

  it("filters by onboarding status alone", () => {
    expect(matchesSystemFilter({ status: "ONBOARDED" }, cloudNis2Finance)).toBe(true);
    expect(matchesSystemFilter({ status: "IN_REVIEW" }, cloudNis2Finance)).toBe(false);
  });

  it("combines all four criteria with AND", () => {
    const filter = { frameworkId: "nis2", deploymentFacetId: "cloud", businessUnitId: "finance", status: "ONBOARDED" as const };
    expect(matchesSystemFilter(filter, cloudNis2Finance, nis2)).toBe(true);
    // Missing any one criterion fails the whole filter.
    expect(matchesSystemFilter(filter, { ...cloudNis2Finance, frameworkScopes: [] }, nis2)).toBe(false);
    expect(matchesSystemFilter(filter, { ...cloudNis2Finance, deploymentFacets: [] }, nis2)).toBe(false);
    expect(matchesSystemFilter(filter, { ...cloudNis2Finance, businessUnits: [] }, nis2)).toBe(false);
    expect(matchesSystemFilter(filter, { ...cloudNis2Finance, status: "IN_REVIEW" }, nis2)).toBe(false);
    expect(isEmptyFilter(filter)).toBe(false);
  });

  it("matches nothing when no System satisfies the combination", () => {
    const systems = [cloudNis2Finance, system({ status: "ONBOARDED" }), system({ deploymentFacets: [{ id: "cloud" }] })];
    const filter = { deploymentFacetId: "cloud", status: "DRAFT" as const, businessUnitId: "finance" };
    expect(systems.filter((s) => matchesSystemFilter(filter, s))).toEqual([]);
  });

  it("recognises onboarding status values", () => {
    expect(isOnboardingStatus("IN_REVIEW")).toBe(true);
    expect(isOnboardingStatus("Onboarded")).toBe(false);
  });
});
