import { describe, expect, it } from "vitest";
import { declaresBelow, whereCounts, whereGroupOf } from "../information-type-where";

const type = { id: "t", name: "Customer data", sensitivityLevel: 3 };

describe("where an Information Type may go (#305)", () => {
  it("groups a System that does not declare the type by its level: equal counts as may hold, one below does not", () => {
    expect(whereGroupOf(3, { sensitivityLevel: 4, declares: false })).toBe("hold");
    expect(whereGroupOf(3, { sensitivityLevel: 3, declares: false })).toBe("hold");
    expect(whereGroupOf(3, { sensitivityLevel: 2, declares: false })).toBe("below");
  });

  it("never lets a System with no level hold anything", () => {
    expect(whereGroupOf(1, { sensitivityLevel: null, declares: false })).toBe("below");
  });

  it("puts every declaring System in the declared group, whatever its level", () => {
    for (const level of [null, 1, 2, 3, 5]) expect(whereGroupOf(3, { sensitivityLevel: level, declares: true })).toBe("declared");
  });

  it("marks a declaring System below the type's level, and not one at or above it or with no level", () => {
    expect(declaresBelow(type, 2)).toBe(true);
    expect(declaresBelow(type, 3)).toBe(false);
    expect(declaresBelow(type, 5)).toBe(false);
    expect(declaresBelow(type, null)).toBe(false);
  });

  it("counts each group, the declaring Systems below the level, and every System at or above it", () => {
    const systems = [
      { sensitivityLevel: 5, typeIds: [] }, // may hold
      { sensitivityLevel: 3, typeIds: [] }, // may hold (equal)
      { sensitivityLevel: 2, typeIds: [] }, // below
      { sensitivityLevel: null, typeIds: [] }, // below, no level
      { sensitivityLevel: 4, typeIds: ["t"] }, // declared, at or above
      { sensitivityLevel: 2, typeIds: ["t", "x"] }, // declared, below
      { sensitivityLevel: null, typeIds: ["t"] }, // declared, no level
      { sensitivityLevel: 1, typeIds: ["x"] }, // declares another type only: below
    ];
    expect(whereCounts(type, systems)).toEqual({ declared: 3, hold: 2, below: 3, declaredBelow: 1, atOrAbove: 3 });
  });

  it("counts nothing for no Systems", () => {
    expect(whereCounts(type, [])).toEqual({ declared: 0, hold: 0, below: 0, declaredBelow: 0, atOrAbove: 0 });
  });
});
