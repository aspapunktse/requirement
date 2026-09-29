import { describe, expect, it } from "vitest";
import {
  deriveCoverageState,
  isCovered,
  matchesCoverageFilter,
  summarizeCoverage,
  type CoverageState,
} from "../coverage-state";

const FULL = { coverage: "FULL" as const };
const PARTIAL = { coverage: "PARTIAL" as const };
const ACCEPTED = new Date("2026-09-29T10:00:00Z");

describe("isCovered", () => {
  it("is covered iff at least one mapping is Full", () => {
    expect(isCovered([FULL])).toBe(true);
    expect(isCovered([PARTIAL, FULL])).toBe(true);
    expect(isCovered([PARTIAL])).toBe(false);
    expect(isCovered([])).toBe(false);
  });

  it("never adds Partial mappings up to Full", () => {
    expect(isCovered([PARTIAL, PARTIAL, PARTIAL])).toBe(false);
  });
});

describe("deriveCoverageState", () => {
  it("is COVERED with a Full mapping", () => {
    expect(deriveCoverageState({ mappings: [FULL], gapAcceptedAt: null })).toBe("COVERED");
  });

  it("is a GAP with no mappings or only Partial ones", () => {
    expect(deriveCoverageState({ mappings: [], gapAcceptedAt: null })).toBe("GAP");
    expect(deriveCoverageState({ mappings: [PARTIAL, PARTIAL], gapAcceptedAt: null })).toBe("GAP");
  });

  it("is an ACCEPTED_GAP when a gap has been accepted", () => {
    expect(deriveCoverageState({ mappings: [], gapAcceptedAt: ACCEPTED })).toBe("ACCEPTED_GAP");
    expect(deriveCoverageState({ mappings: [PARTIAL], gapAcceptedAt: ACCEPTED.toISOString() })).toBe("ACCEPTED_GAP");
  });

  it("ignores an acceptance on a covered Requirement", () => {
    expect(deriveCoverageState({ mappings: [FULL], gapAcceptedAt: ACCEPTED })).toBe("COVERED");
  });
});

describe("summarizeCoverage", () => {
  it("counts total = covered + open gaps + accepted", () => {
    const states: CoverageState[] = ["COVERED", "COVERED", "GAP", "ACCEPTED_GAP", "GAP", "COVERED"];
    expect(summarizeCoverage(states)).toEqual({ total: 6, covered: 3, gaps: 2, accepted: 1 });
  });

  it("is all zeros for no Requirements", () => {
    expect(summarizeCoverage([])).toEqual({ total: 0, covered: 0, gaps: 0, accepted: 0 });
  });
});

describe("matchesCoverageFilter", () => {
  it("'gaps only' is exactly the open gaps; 'accepted' is the accepted ones; 'all' is everything", () => {
    const states: CoverageState[] = ["COVERED", "GAP", "ACCEPTED_GAP"];
    expect(states.filter((s) => matchesCoverageFilter(s, "ALL"))).toEqual(states);
    expect(states.filter((s) => matchesCoverageFilter(s, "GAPS"))).toEqual(["GAP"]);
    expect(states.filter((s) => matchesCoverageFilter(s, "ACCEPTED"))).toEqual(["ACCEPTED_GAP"]);
  });
});
