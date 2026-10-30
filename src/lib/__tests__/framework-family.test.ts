import { describe, expect, it } from "vitest";
import { isPartialOnlyGap } from "../coverage-state";
import { BASE_GROUP, OTHER_GROUP, compareFrameworksDefault, frameworkFamily, latestChange } from "../framework-family";

describe("frameworkFamily (#266, decision 1a)", () => {
  it("puts a name ending ' Level <n>' in the family before it, with its level", () => {
    expect(frameworkFamily({ name: "CMMC Level 2", isBase: false })).toEqual({ group: "CMMC", family: "CMMC", level: 2 });
    expect(frameworkFamily({ name: "DEF STAN 05-138 Level 3", isBase: false })).toEqual({ group: "DEF STAN 05-138", family: "DEF STAN 05-138", level: 3 });
    expect(frameworkFamily({ name: "  CMMC   Level 10  ", isBase: false })).toMatchObject({ family: "CMMC", level: 10 });
  });

  it("keeps the base Framework in its own group, whatever it is called", () => {
    expect(frameworkFamily({ name: "ISO/IEC 27001", isBase: true })).toEqual({ group: BASE_GROUP, family: null, level: null });
    expect(frameworkFamily({ name: "Base Level 1", isBase: true })).toMatchObject({ group: BASE_GROUP, family: null });
  });

  it("leaves every other name in 'Other Frameworks'", () => {
    for (const name of ["NIS2", "Level 3", "CMMC Level", "CMMC Level two", "CMMC Level 2 draft", "Levels 2", "Dual Level 1 Plan"]) {
      expect(frameworkFamily({ name, isBase: false })).toEqual({ group: OTHER_GROUP, family: null, level: null });
    }
  });
});

describe("compareFrameworksDefault", () => {
  const f = (name: string, isBase = false, version = "1") => ({ name, version, isBase, ...frameworkFamily({ name, isBase }) });
  const order = (list: ReturnType<typeof f>[]) => [...list].sort(compareFrameworksDefault).map((x) => `${x.name}:${x.version}`);

  it("puts the base first, then families and other Frameworks by name, a family by level (numerically)", () => {
    expect(
      order([f("NIS2"), f("CMMC Level 10"), f("CMMC Level 2"), f("ISO/IEC 27001", true), f("Alpha"), f("CMMC Level 1")]),
    ).toEqual(["ISO/IEC 27001:1", "Alpha:1", "CMMC Level 1:1", "CMMC Level 2:1", "CMMC Level 10:1", "NIS2:1"]);
  });

  it("orders versions of one name numerically", () => {
    expect(order([f("NIS2", false, "10"), f("NIS2", false, "2")])).toEqual(["NIS2:2", "NIS2:10"]);
  });
});

describe("latestChange (#266, decision 2a)", () => {
  const d = (iso: string) => new Date(iso);

  it("is the creation date when nothing under the Framework changed since", () => {
    expect(latestChange(d("2024-01-01"), [])).toEqual(d("2024-01-01"));
    expect(latestChange(d("2024-01-01"), [null, d("2023-01-01")])).toEqual(d("2024-01-01"));
  });

  it("is the latest of the creation date and every Requirement and Control Mapping change", () => {
    expect(latestChange(d("2024-01-01"), [d("2024-03-01"), d("2024-02-01"), null])).toEqual(d("2024-03-01"));
  });
});

describe("isPartialOnlyGap", () => {
  it("is an open gap with mappings, all Partial", () => {
    expect(isPartialOnlyGap({ mappings: [{ coverage: "PARTIAL" }], gapAcceptedAt: null })).toBe(true);
    expect(isPartialOnlyGap({ mappings: [], gapAcceptedAt: null })).toBe(false);
    expect(isPartialOnlyGap({ mappings: [{ coverage: "PARTIAL" }, { coverage: "FULL" }], gapAcceptedAt: null })).toBe(false);
    expect(isPartialOnlyGap({ mappings: [{ coverage: "PARTIAL" }], gapAcceptedAt: new Date() })).toBe(false);
  });
});
