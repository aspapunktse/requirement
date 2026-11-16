import { describe, expect, it } from "vitest";
import type { ControlAssessmentStatus } from "@prisma/client";
import {
  classificationDifferences,
  computeComparisonScore,
  formatComparisonScore,
  orderCandidates,
  type ComparisonClassification,
  type ComparisonControl,
} from "../comparison-score";
import { inheritanceSourcesFor, resolveEffectiveStatus, type OwnAssessment, type ProviderSource } from "../effective-status";

let next = 0;
function control(status: ControlAssessmentStatus, mandatory = false): ComparisonControl {
  next += 1;
  return { controlId: `c${next}`, code: `TST-${String(next).padStart(3, "0")}`, title: `Control ${next}`, mandatory, status };
}
const many = (count: number, status: ControlAssessmentStatus) => Array.from({ length: count }, () => control(status));

describe("computeComparisonScore", () => {
  it("counts a Fulfilled Control as fulfilled", () => {
    const result = computeComparisonScore([control("FULFILLED"), control("IN_PROGRESS")]);
    expect(result).toMatchObject({ firstRoundCount: 2, countedCount: 2, fulfilledCount: 1, score: 0.5 });
  });

  it.each(["WAIVED", "IN_PROGRESS", "NOT_STARTED"] as const)("counts %s but not as fulfilled", (status) => {
    const result = computeComparisonScore([control("FULFILLED"), control(status)]);
    expect(result).toMatchObject({ countedCount: 2, fulfilledCount: 1, score: 0.5 });
  });

  it("leaves a Not Applicable Control out of both numbers", () => {
    const result = computeComparisonScore([control("FULFILLED"), control("NOT_APPLICABLE")]);
    expect(result).toMatchObject({ firstRoundCount: 2, countedCount: 1, fulfilledCount: 1, score: 1 });
  });

  it("is null when nothing is counted: no first-round Control, or all Not Applicable", () => {
    expect(computeComparisonScore([])).toMatchObject({ firstRoundCount: 0, countedCount: 0, score: null, complete: false });
    const allNotApplicable = computeComparisonScore(many(3, "NOT_APPLICABLE"));
    expect(allNotApplicable).toMatchObject({ firstRoundCount: 3, countedCount: 0, fulfilledCount: 0, score: null, answeredCount: 3, complete: true });
    expect(formatComparisonScore(allNotApplicable.score)).toBe("—");
  });

  it("treats every status other than Not Started as answered", () => {
    const result = computeComparisonScore([
      control("FULFILLED"),
      control("WAIVED"),
      control("NOT_APPLICABLE"),
      control("IN_PROGRESS"),
      control("NOT_STARTED"),
    ]);
    expect(result.answeredCount).toBe(4);
    expect(result.complete).toBe(false);
    expect(computeComparisonScore([control("FULFILLED"), control("IN_PROGRESS")]).complete).toBe(true);
  });

  it("counts mandatory Controls that count and are not fulfilled", () => {
    const result = computeComparisonScore([
      control("FULFILLED", true),
      control("WAIVED", true),
      control("IN_PROGRESS", true),
      control("NOT_STARTED", true),
      control("NOT_APPLICABLE", true),
      control("NOT_STARTED", false),
    ]);
    expect(result.mandatoryNotFulfilledCount).toBe(3);
  });

  it("lists the Controls in code order with their status", () => {
    const b = { ...control("FULFILLED"), code: "SEC-010" };
    const a = { ...control("WAIVED"), code: "SEC-002" };
    expect(computeComparisonScore([b, a]).controls.map((c) => [c.code, c.status])).toEqual([
      ["SEC-002", "WAIVED"],
      ["SEC-010", "FULFILLED"],
    ]);
  });

  it("does not change its input", () => {
    const input = [control("FULFILLED"), control("NOT_STARTED")];
    const copy = [...input];
    computeComparisonScore(input);
    expect(input).toEqual(copy);
  });

  it("works the example of docs/how-it-works/comparison.md: 9 of 13, 69%, 12 of 14 answered, incomplete", () => {
    const result = computeComparisonScore([
      ...many(9, "FULFILLED"),
      control("NOT_APPLICABLE"),
      control("WAIVED"),
      control("IN_PROGRESS"),
      ...many(2, "NOT_STARTED"),
    ]);
    expect(result).toMatchObject({
      firstRoundCount: 14,
      countedCount: 13,
      fulfilledCount: 9,
      answeredCount: 12,
      complete: false,
    });
    expect(result.score).toBeCloseTo(9 / 13, 10);
    expect(formatComparisonScore(result.score)).toBe("69%");
  });

  describe("with the real effective-status rule", () => {
    const full: ProviderSource = {
      kind: "PROVIDER",
      type: "FULL",
      status: "FULFILLED",
      provider: { id: "p1", name: "Provider" },
      providerOnboarded: true,
      appliesToProvider: true,
      customerResponsibility: null,
    };
    const shared: ProviderSource = { ...full, type: "SHARED", customerResponsibility: "Configure it" };
    const effective = (own: OwnAssessment, control: { applicability: "PER_SYSTEM" | "BOTH" }, org?: ControlAssessmentStatus, providers: ProviderSource[] = []) =>
      resolveEffectiveStatus(own, inheritanceSourcesFor(control, org, providers)).status;

    it("counts a Control inherited from the Organization, or from a Full Provider Offering, as fulfilled", () => {
      const statuses = [
        effective(null, { applicability: "BOTH" }, "FULFILLED"),
        effective(null, { applicability: "PER_SYSTEM" }, undefined, [full]),
        effective(null, { applicability: "PER_SYSTEM" }),
      ];
      expect(statuses).toEqual(["FULFILLED", "FULFILLED", "NOT_STARTED"]);
      const result = computeComparisonScore(statuses.map((status) => control(status)));
      expect(result).toMatchObject({ fulfilledCount: 2, countedCount: 3, answeredCount: 2 });
    });

    it("counts a Shared Offering as fulfilled only with the System's own half done", () => {
      const withOwnHalf = effective({ status: "FULFILLED", personSet: true }, { applicability: "PER_SYSTEM" }, undefined, [shared]);
      const withoutOwnHalf = effective(null, { applicability: "PER_SYSTEM" }, undefined, [shared]);
      const providerNotOnboarded = effective({ status: "FULFILLED", personSet: true }, { applicability: "PER_SYSTEM" }, undefined, [
        { ...shared, providerOnboarded: false },
      ]);
      expect([withOwnHalf, withoutOwnHalf, providerNotOnboarded]).toEqual(["FULFILLED", "NOT_STARTED", "IN_PROGRESS"]);
      expect(computeComparisonScore([withOwnHalf, withoutOwnHalf, providerNotOnboarded].map((s) => control(s))).fulfilledCount).toBe(1);
    });

    it("lets a person-set Waived or Not Applicable win over a Full source", () => {
      expect(effective({ status: "WAIVED", personSet: true }, { applicability: "BOTH" }, "FULFILLED")).toBe("WAIVED");
      expect(effective({ status: "NOT_APPLICABLE", personSet: true }, { applicability: "BOTH" }, "FULFILLED")).toBe("NOT_APPLICABLE");
    });
  });
});

describe("formatComparisonScore", () => {
  it("rounds to a whole percent and shows a dash for null", () => {
    expect(formatComparisonScore(9 / 13)).toBe("69%");
    expect(formatComparisonScore(1)).toBe("100%");
    expect(formatComparisonScore(0)).toBe("0%");
    expect(formatComparisonScore(null)).toBe("—");
  });
});

describe("orderCandidates", () => {
  const candidate = (name: string, complete: boolean, score: number | null, mandatoryNotFulfilledCount = 0) => ({
    name,
    complete,
    score,
    mandatoryNotFulfilledCount,
  });
  const names = (list: { name: string }[]) => list.map((c) => c.name);

  it("puts complete Candidates before incomplete ones, whatever the score", () => {
    expect(names(orderCandidates([candidate("A", false, 0.9), candidate("B", true, 0.1)]))).toEqual(["B", "A"]);
  });

  it("orders by score descending within a group, with a null score last", () => {
    const ordered = orderCandidates([
      candidate("Null", true, null),
      candidate("Low", true, 0.2),
      candidate("High", true, 0.8),
      candidate("Zero", true, 0),
    ]);
    expect(names(ordered)).toEqual(["High", "Low", "Zero", "Null"]);
  });

  it("puts fewer mandatory Controls not fulfilled first on equal scores", () => {
    expect(names(orderCandidates([candidate("A", true, 0.5, 2), candidate("B", true, 0.5, 0), candidate("C", true, 0.5, 1)]))).toEqual([
      "B",
      "C",
      "A",
    ]);
  });

  it("breaks the last tie by name, case-insensitively, and keeps input order for equal names", () => {
    expect(names(orderCandidates([candidate("beta", true, 0.5), candidate("Alpha", true, 0.5), candidate("alpha 2", true, 0.5)]))).toEqual([
      "Alpha",
      "alpha 2",
      "beta",
    ]);
    const first = { ...candidate("Same", true, 0.5), id: 1 };
    const second = { ...candidate("same", true, 0.5), id: 2 };
    expect(orderCandidates([first, second]).map((c) => c.id)).toEqual([1, 2]);
    expect(orderCandidates([second, first]).map((c) => c.id)).toEqual([2, 1]);
  });

  it("returns a new array and handles none", () => {
    const input = [candidate("B", true, 0.1), candidate("A", true, 0.9)];
    expect(orderCandidates(input)).not.toBe(input);
    expect(names(input)).toEqual(["B", "A"]);
    expect(orderCandidates([])).toEqual([]);
  });
});

describe("classificationDifferences", () => {
  const base: ComparisonClassification = {
    deploymentFacetIds: ["saas", "eu"],
    sensitivityLevel: 3,
    integrityImpactLevel: "MODERATE",
    availabilityImpactLevel: "HIGH",
    frameworkScopeIds: ["base", "gdpr"],
  };

  it("says nothing differs for fewer than two Systems or identical ones", () => {
    expect(classificationDifferences([])).toEqual([]);
    expect(classificationDifferences([base])).toEqual([]);
    expect(classificationDifferences([base, { ...base }])).toEqual([]);
  });

  it("compares facets and Framework Scope as sets, ignoring order", () => {
    expect(classificationDifferences([base, { ...base, deploymentFacetIds: ["eu", "saas"], frameworkScopeIds: ["gdpr", "base"] }])).toEqual([]);
    expect(classificationDifferences([base, { ...base, deploymentFacetIds: ["saas"] }])).toEqual(["deploymentFacets"]);
    expect(classificationDifferences([base, { ...base, deploymentFacetIds: ["saas", "eu", "onprem"] }])).toEqual(["deploymentFacets"]);
    expect(classificationDifferences([base, { ...base, frameworkScopeIds: ["base"] }])).toEqual(["frameworkScope"]);
  });

  it.each([
    ["sensitivityLevel", { sensitivityLevel: 4 }],
    ["integrityImpactLevel", { integrityImpactLevel: "HIGH" }],
    ["availabilityImpactLevel", { availabilityImpactLevel: null }],
  ] as const)("reports a difference in %s", (dimension, change) => {
    expect(classificationDifferences([base, { ...base, ...change }])).toEqual([dimension]);
  });

  it("finds a difference between any two of several Systems and lists dimensions in a fixed order", () => {
    const result = classificationDifferences([
      base,
      { ...base },
      { ...base, frameworkScopeIds: ["base"], sensitivityLevel: null, deploymentFacetIds: [] },
    ]);
    expect(result).toEqual(["deploymentFacets", "sensitivityLevel", "frameworkScope"]);
  });
});
