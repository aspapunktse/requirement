import { describe, expect, it } from "vitest";
import {
  compareEvaluations,
  EMPTY_ANSWERS,
  evaluateOnboarding,
  type OnboardingAnswers,
  type OnboardingCatalog,
  type OnboardingControl,
} from "../onboarding-interview";

const control = (code: string, patch: Partial<OnboardingControl> = {}): OnboardingControl => ({
  id: code,
  code,
  title: `Title ${code}`,
  applicability: "PER_SYSTEM",
  deploymentFacetIds: [],
  minConfidentialityImpactLevel: null,
  minIntegrityImpactLevel: null,
  minAvailabilityImpactLevel: null,
  frameworkIds: ["base"],
  organizationFulfilled: false,
  offerings: [],
  ...patch,
});

const catalog: OnboardingCatalog = {
  deploymentFacets: [],
  frameworks: [
    { id: "base", name: "Base", version: "1", description: null, isBase: true, onboardingQuestion: null, onboardingHint: null },
    { id: "gdpr", name: "GDPR", version: "1", description: null, isBase: false, onboardingQuestion: "Personal data?", onboardingHint: null },
  ],
  providers: [
    { id: "p1", name: "Landing Zone", onboarded: true },
    { id: "p2", name: "SOC", onboarded: true },
  ],
  controls: [
    control("A-1"),
    control("A-2", { frameworkIds: ["gdpr"] }),
    control("A-3", { minConfidentialityImpactLevel: "HIGH" }),
    control("A-4", { applicability: "BOTH", organizationFulfilled: true }),
    control("A-5", { offerings: [{ providerId: "p1", type: "FULL", customerResponsibility: null, fulfilled: true }] }),
    control("A-6", { offerings: [{ providerId: "p1", type: "FULL", customerResponsibility: null, fulfilled: false }] }),
    control("A-7", {
      offerings: [
        { providerId: "p2", type: "SHARED", customerResponsibility: "Review the list", fulfilled: false },
        { providerId: "p1", type: "SHARED", customerResponsibility: "Rotate keys", fulfilled: false },
      ],
    }),
    control("A-8", { frameworkIds: [] }),
  ],
};

const groupOf = (answers: OnboardingAnswers) =>
  Object.fromEntries(evaluateOnboarding(catalog, answers).rows.map((row) => [row.control.code, row.group]));

describe("evaluateOnboarding", () => {
  it("applies the real rules: base Framework, Framework Scope, Impact Level thresholds, no Published mapping", () => {
    expect(Object.keys(groupOf(EMPTY_ANSWERS))).toEqual(["A-1", "A-4", "A-5", "A-6", "A-7"]);
    expect(Object.keys(groupOf({ ...EMPTY_ANSWERS, frameworkScopeIds: ["gdpr"] }))).toContain("A-2");
    expect(Object.keys(groupOf({ ...EMPTY_ANSWERS, confidentialityImpactLevel: "CRITICAL" }))).toContain("A-3");
    expect(Object.keys(groupOf({ ...EMPTY_ANSWERS, confidentialityImpactLevel: "MODERATE" }))).not.toContain("A-3");
    // Never a Control that maps to no Published Framework, and the library counts every Control.
    expect(evaluateOnboarding(catalog, EMPTY_ANSWERS).counts).toMatchObject({ library: 8, applicable: 5 });
  });

  it("covers a Both Control the Organization fulfilled, whatever the Providers", () => {
    expect(groupOf(EMPTY_ANSWERS)["A-4"]).toBe("COVERED");
    const row = evaluateOnboarding(catalog, EMPTY_ANSWERS).rows.find((r) => r.control.code === "A-4")!;
    expect(row.coveredBy).toBe("the Organization");
  });

  it("groups by chosen Providers: a Fulfilled Full Offering covers, a Shared one shares, anything else is yours", () => {
    expect(groupOf(EMPTY_ANSWERS)).toMatchObject({ "A-1": "YOU", "A-5": "YOU", "A-6": "YOU", "A-7": "YOU" });
    const chosen = evaluateOnboarding(catalog, { ...EMPTY_ANSWERS, providerIds: ["p1", "p2"] });
    expect(Object.fromEntries(chosen.rows.map((r) => [r.control.code, r.group]))).toMatchObject({
      "A-5": "COVERED",
      "A-6": "YOU",
      "A-7": "SHARED",
    });
    expect(chosen.rows.find((r) => r.control.code === "A-5")!.coveredBy).toBe("Landing Zone");
    expect(chosen.rows.find((r) => r.control.code === "A-7")!.sharedBy.map((s) => [s.providerName, s.customerResponsibility])).toEqual([
      ["Landing Zone", "Rotate keys"],
      ["SOC", "Review the list"],
    ]);
    expect(chosen.counts).toMatchObject({ YOU: 2, SHARED: 1, COVERED: 2 });
  });

  it("compares two evaluations as added, removed and moved", () => {
    const before = evaluateOnboarding(catalog, EMPTY_ANSWERS);
    expect(compareEvaluations(before, evaluateOnboarding(catalog, { ...EMPTY_ANSWERS, providerIds: ["p1"] }))).toEqual({ added: 0, removed: 0, moved: 2 });
    expect(compareEvaluations(before, evaluateOnboarding(catalog, { ...EMPTY_ANSWERS, frameworkScopeIds: ["gdpr"], confidentialityImpactLevel: "HIGH" }))).toEqual({
      added: 2,
      removed: 0,
      moved: 0,
    });
  });
});
