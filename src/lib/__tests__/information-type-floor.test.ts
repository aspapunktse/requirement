import { describe, expect, it } from "vitest";
import { floorCulprit, floorSettingTypes, informationTypeFloor, isBelowInformationTypes, meetsInformationTypeFloor } from "../information-type-floor";

const pay = { id: "pay", name: "Payroll", sensitivityLevel: 4 };
const hr = { id: "hr", name: "HR records", sensitivityLevel: 4 };
const code = { id: "code", name: "Source code", sensitivityLevel: 3 };

describe("the Information Type floor (ADR 0012)", () => {
  it("is the highest level among the types, and none without types", () => {
    expect(informationTypeFloor([])).toBeNull();
    expect(informationTypeFloor([code, pay])).toBe(4);
  });

  it("is met by a level at or above it, never by no level, and always without types", () => {
    expect(meetsInformationTypeFloor(3, [])).toBe(true);
    expect(meetsInformationTypeFloor(null, [])).toBe(true);
    expect(meetsInformationTypeFloor(4, [code, pay])).toBe(true);
    expect(meetsInformationTypeFloor(5, [code, pay])).toBe(true);
    expect(meetsInformationTypeFloor(3, [code, pay])).toBe(false);
    expect(meetsInformationTypeFloor(null, [code])).toBe(false);
  });

  it("flags 'below its Information Types' only for a declared level under the floor", () => {
    expect(isBelowInformationTypes(3, [pay])).toBe(true);
    expect(isBelowInformationTypes(4, [pay])).toBe(false);
    expect(isBelowInformationTypes(null, [pay])).toBe(false);
    expect(isBelowInformationTypes(1, [])).toBe(false);
  });

  it("names the types that set the floor by name, preferring the one ticked last", () => {
    expect(floorSettingTypes([code, pay, hr]).map((t) => t.name)).toEqual(["HR records", "Payroll"]);
    expect(floorCulprit([code, pay, hr])?.id).toBe("hr");
    expect(floorCulprit([code, pay, hr], "pay")?.id).toBe("pay");
    expect(floorCulprit([code, pay, hr], "code")?.id).toBe("hr");
    expect(floorCulprit([])).toBeNull();
  });
});
