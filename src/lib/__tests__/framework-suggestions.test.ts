import { describe, expect, it } from "vitest";
import {
  declinesToLeaveOut,
  hasSuggestedFrameworksToReview,
  joinNames,
  openSuggestions,
  suggestionSentence,
  suggestionsFor,
  type SuggestedFramework,
  type SuggestingType,
} from "@/lib/framework-suggestions";

const fw = (id: string, over: Partial<SuggestedFramework> = {}): SuggestedFramework => ({ id, name: id.toUpperCase(), version: "1", status: "PUBLISHED", isBase: false, ...over });
const type = (id: string, ...frameworks: SuggestedFramework[]): SuggestingType => ({ id, name: `Type ${id}`, suggestedFrameworks: frameworks });

describe("suggestionsFor (ADR 0013)", () => {
  it("offers each Published, non-base Framework a declared type suggests, once, naming every type", () => {
    const list = suggestionsFor([type("a", fw("gdpr")), type("b", fw("gdpr"), fw("nis"))], [], []);
    expect(list.map((s) => [s.framework.id, s.types.map((t) => t.id), s.state])).toEqual([
      ["gdpr", ["a", "b"], "open"],
      ["nis", ["b"], "open"],
    ]);
  });

  it("ignores a Draft Framework and the base Framework", () => {
    const list = suggestionsFor([type("a", fw("d", { status: "DRAFT" }), fw("base", { isBase: true }), fw("ok"))], [], []);
    expect(list.map((s) => s.framework.id)).toEqual(["ok"]);
  });

  it("is in scope when the Framework is in the scope, whatever was declined", () => {
    const list = suggestionsFor([type("a", fw("gdpr"))], ["gdpr"], [{ informationTypeId: "a", frameworkId: "gdpr" }]);
    expect(list[0].state).toBe("in-scope");
    expect(openSuggestions([type("a", fw("gdpr"))], new Set(["gdpr"]), [])).toEqual([]);
  });

  it("is left out only when every declared type that suggests it was declined", () => {
    const declared = [type("a", fw("gdpr")), type("b", fw("gdpr"))];
    expect(suggestionsFor(declared, [], [{ informationTypeId: "a", frameworkId: "gdpr" }])[0].state).toBe("open");
    const both = [
      { informationTypeId: "a", frameworkId: "gdpr" },
      { informationTypeId: "b", frameworkId: "gdpr" },
    ];
    expect(suggestionsFor(declared, [], both)[0].state).toBe("left-out");
  });

  it("ignores a decision for a type the System does not declare or another Framework", () => {
    const declared = [type("a", fw("gdpr"))];
    expect(suggestionsFor(declared, [], [{ informationTypeId: "z", frameworkId: "gdpr" }])[0].state).toBe("open");
    expect(suggestionsFor(declared, [], [{ informationTypeId: "a", frameworkId: "other" }])[0].state).toBe("open");
  });

  it("flags a System only while a suggestion is open; no types, no flag", () => {
    expect(hasSuggestedFrameworksToReview([], [], [])).toBe(false);
    expect(hasSuggestedFrameworksToReview([type("a", fw("gdpr"))], [], [])).toBe(true);
    expect(hasSuggestedFrameworksToReview([type("a", fw("gdpr"))], ["gdpr"], [])).toBe(false);
    expect(hasSuggestedFrameworksToReview([type("a", fw("gdpr"))], [], [{ informationTypeId: "a", frameworkId: "gdpr" }])).toBe(false);
    expect(hasSuggestedFrameworksToReview([type("a")], [], [])).toBe(false);
  });
});

describe("declinesToLeaveOut and the sentences", () => {
  it("has one decline per declared type that suggests the Framework, none when nothing does", () => {
    const declared = [type("a", fw("gdpr")), type("b", fw("nis")), type("c", fw("gdpr"))];
    expect(declinesToLeaveOut(declared, "gdpr")).toEqual([
      { informationTypeId: "a", frameworkId: "gdpr" },
      { informationTypeId: "c", frameworkId: "gdpr" },
    ]);
    expect(declinesToLeaveOut(declared, "zzz")).toEqual([]);
    expect(declinesToLeaveOut([type("a", fw("d", { status: "DRAFT" }))], "d")).toEqual([]);
  });

  it("joins names and words the suggestion", () => {
    expect(joinNames([])).toBe("");
    expect(joinNames(["A"])).toBe("A");
    expect(joinNames(["A", "B", "C"])).toBe("A, B and C");
    const [one] = suggestionsFor([type("a", fw("gdpr"))], [], []);
    expect(suggestionSentence(one)).toBe("Type a usually falls under GDPR.");
    const [two] = suggestionsFor([type("a", fw("gdpr")), type("b", fw("gdpr"))], [], []);
    expect(suggestionSentence(two)).toBe("Type a and Type b usually fall under GDPR.");
  });
});
