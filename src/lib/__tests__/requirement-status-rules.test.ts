import { describe, expect, it } from "vitest";
import type { ControlAssessmentStatus } from "@prisma/client";
import {
  NO_MAPPED_CONTROLS_STATUS,
  addDerivedStatusCounts,
  compliancePercentage,
  countDerivedStatuses,
  deriveRequirementStatus,
  formatCompliancePercentage,
  isEffectivelyFulfilled,
  matchesDerivedStatusFilter,
  type MappedControlForDerivation,
} from "../requirement-status-rules";

const lenient = { strictComplianceRequired: false };
const strict = { strictComplianceRequired: true };

/** An applicable mapped Control with the given Assessment status (null = no Assessment row yet). */
const applicable = (
  status: ControlAssessmentStatus | null,
  coverage: "FULL" | "PARTIAL" = "FULL",
): MappedControlForDerivation => ({ coverage, applicable: true, status });
const notApplicable = (coverage: "FULL" | "PARTIAL" = "FULL"): MappedControlForDerivation => ({
  coverage,
  applicable: false,
  status: null,
});

function derive(
  mappings: MappedControlForDerivation[],
  options: { framework?: { strictComplianceRequired: boolean }; gapAcceptedAt?: Date | null } = {},
) {
  return deriveRequirementStatus({
    framework: options.framework ?? lenient,
    mappings,
    gapAcceptedAt: options.gapAcceptedAt ?? null,
  });
}

describe("isEffectivelyFulfilled", () => {
  it("counts Fulfilled always, Waived and Not Applicable unless the Framework is strict", () => {
    expect(isEffectivelyFulfilled("FULFILLED", lenient)).toBe(true);
    expect(isEffectivelyFulfilled("FULFILLED", strict)).toBe(true);
    expect(isEffectivelyFulfilled("WAIVED", lenient)).toBe(true);
    expect(isEffectivelyFulfilled("NOT_APPLICABLE", lenient)).toBe(true);
    expect(isEffectivelyFulfilled("WAIVED", strict)).toBe(false);
    expect(isEffectivelyFulfilled("NOT_APPLICABLE", strict)).toBe(false);
  });

  it("never counts Not Started or In Progress", () => {
    for (const framework of [lenient, strict]) {
      expect(isEffectivelyFulfilled("NOT_STARTED", framework)).toBe(false);
      expect(isEffectivelyFulfilled("IN_PROGRESS", framework)).toBe(false);
    }
  });
});

describe("deriveRequirementStatus: the issue's table", () => {
  it("Met: covered, and every applicable mapped Control is effectively Fulfilled", () => {
    expect(derive([applicable("FULFILLED")])).toEqual({ status: "MET", basis: "CONTROLS" });
    expect(derive([applicable("FULFILLED"), applicable("FULFILLED", "PARTIAL")]).status).toBe("MET");
  });

  it("Met: Waived and Not Applicable Assessments count as Fulfilled on a lenient Framework", () => {
    expect(derive([applicable("WAIVED"), applicable("NOT_APPLICABLE"), applicable("FULFILLED")]).status).toBe("MET");
  });

  it("Partially Met: some, but not all, applicable mapped Controls are effectively Fulfilled", () => {
    expect(derive([applicable("FULFILLED"), applicable("IN_PROGRESS")])).toEqual({
      status: "PARTIALLY_MET",
      basis: "CONTROLS",
    });
    expect(derive([applicable("FULFILLED"), applicable(null)]).status).toBe("PARTIALLY_MET");
    expect(derive([applicable("WAIVED"), applicable("NOT_STARTED")]).status).toBe("PARTIALLY_MET");
  });

  it("Not Met: none of the applicable mapped Controls is effectively Fulfilled", () => {
    expect(derive([applicable("NOT_STARTED")])).toEqual({ status: "NOT_MET", basis: "CONTROLS" });
    expect(derive([applicable("IN_PROGRESS"), applicable(null)]).status).toBe("NOT_MET");
  });

  it("Not Applicable (OQ-1): mappings exist but none of the mapped Controls applies to the System", () => {
    expect(derive([notApplicable()])).toEqual({ status: "NOT_APPLICABLE", basis: "NO_APPLICABLE_CONTROLS" });
    expect(derive([notApplicable(), notApplicable("PARTIAL")]).status).toBe("NOT_APPLICABLE");
  });

  it("only looks at the Controls that apply: a non-applicable one neither helps nor hurts", () => {
    expect(derive([applicable("FULFILLED"), notApplicable()]).status).toBe("MET");
    expect(derive([applicable("NOT_STARTED"), notApplicable()]).status).toBe("NOT_MET");
    // A stray status on a non-applicable Control is ignored.
    expect(derive([{ coverage: "FULL", applicable: false, status: "FULFILLED" }]).status).toBe("NOT_APPLICABLE");
  });
});

describe("deriveRequirementStatus: strictComplianceRequired", () => {
  it("Waived / Not Applicable no longer count as fulfilled", () => {
    expect(derive([applicable("WAIVED")], { framework: strict }).status).toBe("NOT_MET");
    expect(derive([applicable("NOT_APPLICABLE")], { framework: strict }).status).toBe("NOT_MET");
    expect(derive([applicable("FULFILLED"), applicable("WAIVED")], { framework: strict }).status).toBe("PARTIALLY_MET");
  });

  it("Fulfilled still gives Met", () => {
    expect(derive([applicable("FULFILLED"), applicable("FULFILLED")], { framework: strict }).status).toBe("MET");
  });

  it("the same mappings are Met on a lenient Framework", () => {
    const mappings = [applicable("FULFILLED"), applicable("WAIVED")];
    expect(derive(mappings, { framework: lenient }).status).toBe("MET");
    expect(derive(mappings, { framework: strict }).status).toBe("PARTIALLY_MET");
  });
});

describe("deriveRequirementStatus: coverage", () => {
  it("Partially Met, never Met: all applicable Controls Fulfilled but the Requirement is only Partially covered", () => {
    expect(derive([applicable("FULFILLED", "PARTIAL")])).toEqual({
      status: "PARTIALLY_MET",
      basis: "PARTIAL_COVERAGE",
    });
    expect(derive([applicable("FULFILLED", "PARTIAL"), applicable("FULFILLED", "PARTIAL")]).status).toBe(
      "PARTIALLY_MET",
    );
  });

  it("a Partial mapping being unfulfilled still gives Not Met / Partially Met by the Controls, not the coverage", () => {
    expect(derive([applicable("NOT_STARTED", "PARTIAL")]).status).toBe("NOT_MET");
    expect(derive([applicable("FULFILLED", "PARTIAL"), applicable("NOT_STARTED", "PARTIAL")]).status).toBe(
      "PARTIALLY_MET",
    );
  });

  it("conservative: a Full mapping that doesn't apply to the System doesn't make it covered there", () => {
    const status = derive([applicable("FULFILLED", "PARTIAL"), notApplicable("FULL")]);
    expect(status).toEqual({ status: "PARTIALLY_MET", basis: "PARTIAL_COVERAGE" });
  });

  it("an applicable Full mapping alongside a Partial one is covered", () => {
    expect(derive([applicable("FULFILLED", "FULL"), applicable("FULFILLED", "PARTIAL")]).status).toBe("MET");
  });
});

describe("deriveRequirementStatus: accepted gap", () => {
  const acceptedAt = new Date("2026-09-29T10:00:00Z");

  it("all applicable Controls Fulfilled but the Requirement is an accepted gap: Partially Met, never Met", () => {
    expect(derive([applicable("FULFILLED", "PARTIAL")], { gapAcceptedAt: acceptedAt })).toEqual({
      status: "PARTIALLY_MET",
      basis: "ACCEPTED_GAP",
    });
  });

  it("an accepted gap still follows the Controls when they are not all Fulfilled", () => {
    expect(derive([applicable("NOT_STARTED", "PARTIAL")], { gapAcceptedAt: acceptedAt }).status).toBe("NOT_MET");
    expect(
      derive([applicable("FULFILLED", "PARTIAL"), applicable("IN_PROGRESS", "PARTIAL")], { gapAcceptedAt: acceptedAt })
        .status,
    ).toBe("PARTIALLY_MET");
  });

  it("an accepted gap whose mapped Controls don't apply is Not Applicable", () => {
    expect(derive([notApplicable("PARTIAL")], { gapAcceptedAt: acceptedAt }).status).toBe("NOT_APPLICABLE");
  });

  it("a stale acceptance on a Requirement that has a Full mapping is ignored (it is covered, not a gap)", () => {
    expect(derive([applicable("FULFILLED", "FULL")], { gapAcceptedAt: acceptedAt })).toEqual({
      status: "MET",
      basis: "CONTROLS",
    });
  });
});

describe("deriveRequirementStatus: no mapped Controls at all (the flagged default)", () => {
  it("is Not Met by default (NO_MAPPED_CONTROLS_STATUS), so an unmapped Framework can't look compliant", () => {
    expect(NO_MAPPED_CONTROLS_STATUS).toBe("NOT_MET");
    expect(derive([])).toEqual({ status: "NOT_MET", basis: "NO_MAPPED_CONTROLS" });
  });

  it("is Not Met for an accepted gap with zero mappings too", () => {
    expect(derive([], { gapAcceptedAt: new Date() })).toEqual({ status: "NOT_MET", basis: "NO_MAPPED_CONTROLS" });
  });

  it("is distinct from mappings that exist but don't apply, which stay Not Applicable", () => {
    expect(derive([]).status).not.toBe(derive([notApplicable()]).status);
  });
});

describe("status counts and filter", () => {
  it("counts every status, with the Compliance Percentage denominator excluding Not Applicable", () => {
    const counts = countDerivedStatuses(["MET", "MET", "PARTIALLY_MET", "NOT_MET", "NOT_APPLICABLE", "NOT_APPLICABLE"]);
    expect(counts).toEqual({ MET: 2, PARTIALLY_MET: 1, NOT_MET: 1, NOT_APPLICABLE: 2, total: 6, applicable: 4 });
  });

  it("pools counts across Systems", () => {
    const a = countDerivedStatuses(["MET", "NOT_MET"]);
    const b = countDerivedStatuses(["MET", "NOT_APPLICABLE"]);
    expect(addDerivedStatusCounts(a, b)).toEqual({
      MET: 2,
      PARTIALLY_MET: 0,
      NOT_MET: 1,
      NOT_APPLICABLE: 1,
      total: 4,
      applicable: 3,
    });
  });

  it("filters by status, ALL matching everything", () => {
    expect(matchesDerivedStatusFilter("MET", "ALL")).toBe(true);
    expect(matchesDerivedStatusFilter("MET", "MET")).toBe(true);
    expect(matchesDerivedStatusFilter("NOT_MET", "MET")).toBe(false);
  });
});

describe("compliancePercentage: Met ÷ applicable (#90)", () => {
  it("is Met over applicable Requirements, to one decimal place", () => {
    expect(compliancePercentage(countDerivedStatuses(["MET", "NOT_MET", "NOT_MET"]))).toBe(33.3);
    expect(compliancePercentage(countDerivedStatuses(["MET", "MET", "NOT_MET"]))).toBe(66.7);
    expect(compliancePercentage(countDerivedStatuses(["MET", "MET"]))).toBe(100);
  });

  it("leaves Not Applicable out of the denominator", () => {
    const counts = countDerivedStatuses(["MET", "NOT_MET", "NOT_APPLICABLE", "NOT_APPLICABLE", "NOT_APPLICABLE"]);
    expect(compliancePercentage(counts)).toBe(50);
  });

  it("counts Partially Met as not Met: it is in the denominator but not the numerator", () => {
    expect(compliancePercentage(countDerivedStatuses(["MET", "PARTIALLY_MET"]))).toBe(50);
    expect(compliancePercentage(countDerivedStatuses(["PARTIALLY_MET", "PARTIALLY_MET"]))).toBe(0);
  });

  it("is null when nothing is applicable, not 0 or 100", () => {
    expect(compliancePercentage(countDerivedStatuses([]))).toBeNull();
    expect(compliancePercentage(countDerivedStatuses(["NOT_APPLICABLE", "NOT_APPLICABLE"]))).toBeNull();
  });

  it("pools: a System with more applicable Requirements weighs more than an average of percentages would give it", () => {
    const small = countDerivedStatuses(["MET", "MET"]); // 100% of 2
    const large = countDerivedStatuses(["MET", "NOT_MET", "NOT_MET", "NOT_MET", "NOT_MET", "NOT_APPLICABLE"]); // 20% of 5
    const pooled = addDerivedStatusCounts(small, large);
    expect(pooled.MET).toBe(3);
    expect(pooled.applicable).toBe(7);
    expect(compliancePercentage(pooled)).toBe(42.9); // 3/7, not the (100 + 20) / 2 = 60 of an average
  });

  it("pooling ignores a System with nothing applicable, which has a null percentage of its own", () => {
    const none = countDerivedStatuses(["NOT_APPLICABLE"]);
    const some = countDerivedStatuses(["MET", "NOT_MET"]);
    expect(compliancePercentage(none)).toBeNull();
    expect(compliancePercentage(addDerivedStatusCounts(none, some))).toBe(50);
  });

  it("formats a percentage, or an em dash for null", () => {
    expect(formatCompliancePercentage(66.7)).toBe("66.7%");
    expect(formatCompliancePercentage(0)).toBe("0%");
    expect(formatCompliancePercentage(null)).toBe("—");
  });
});
