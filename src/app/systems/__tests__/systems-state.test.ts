import { describe, expect, it } from "vitest";
import { DEFAULT_STATE, parseRegisterState, serializeRegisterState } from "../systems-state";

const parse = (query: string, role: "SYSTEM_OWNER" | "ADMIN" = "SYSTEM_OWNER") => parseRegisterState(new URLSearchParams(query), { id: "u-me", role });

describe("the list's state in the URL", () => {
  it("is the default for an empty query, and the default writes nothing", () => {
    expect(parse("")).toEqual(DEFAULT_STATE);
    expect(serializeRegisterState(DEFAULT_STATE)).toBe("");
  });

  it("round-trips every part of the state", () => {
    const state = {
      view: "attention" as const,
      status: "IN_REVIEW" as const,
      q: "jira & co",
      owners: ["u-1", "u-2"],
      units: ["b-1"],
      facets: ["f-1"],
      impact: ["HIGH" as const, "NONE" as const],
      sens: ["2" as const, "none" as const],
      it: ["t-1", "t-2"],
      sort: "prog" as const,
      dir: -1 as const,
      group: "unit" as const,
      page: 3,
      per: 25,
    };
    const query = serializeRegisterState(state);
    expect(parse(query)).toEqual(state);
  });

  it("keeps only valid Sensitivity filter values, and writes the levels and none as repeated sens params", () => {
    expect(parse("sens=1&sens=5&sens=none&sens=6&sens=0&sens=x&sens=1").sens).toEqual(["1", "5", "none"]);
    expect(serializeRegisterState({ ...DEFAULT_STATE, sens: ["3", "none"] })).toBe("sens=3&sens=none");
    expect(parse("sort=sens").sort).toBe("sens");
  });

  it("writes the Information Type filter as repeated it params, and drops an id that is not in the catalogue", () => {
    expect(serializeRegisterState({ ...DEFAULT_STATE, it: ["t-1", "t-2"] })).toBe("it=t-1&it=t-2");
    expect(parse("it=t-1&it=t-1&it=&it=t-2").it).toEqual(["t-1", "t-2"]);
    const known = new Set(["t-1"]);
    expect(parseRegisterState(new URLSearchParams("it=t-1&it=gone"), { id: "u-me", role: "ADMIN" }, known).it).toEqual(["t-1"]);
  });

  it("reads the Below its Information Types card as a view", () => {
    expect(parse("view=below").view).toBe("below");
    expect(serializeRegisterState({ ...DEFAULT_STATE, view: "below" })).toBe("view=below");
  });

  it("falls back to the default for anything it does not recognise", () => {
    expect(parse("view=nope&status=PAUSED&sort=secret&group=x&page=-2&per=7&impact=HUGE&dir=sideways")).toEqual(DEFAULT_STATE);
    expect(parse("page=abc").page).toBe(1);
    expect(parse("owners=&owners=u-1&owners=u-1").owners).toEqual(["u-1"]);
  });

  it("keeps Home's deep link ?status=<OnboardingStatus> working", () => {
    expect(parse("status=ONBOARDED").status).toBe("ONBOARDED");
  });

  it("?owner=me selects Owned by me for a System Owner, whose own view it is", () => {
    const state = parse("owner=me");
    expect(state.view).toBe("mine");
    expect(state.owners).toEqual([]);
  });

  it("?owner=me filters by the user as Owner for every other role", () => {
    const state = parse("owner=me", "ADMIN");
    expect(state.view).toBe("all");
    expect(state.owners).toEqual(["u-me"]);
    expect(parse("owner=me&owners=u-me", "ADMIN").owners).toEqual(["u-me"]);
  });

  it("does not take any other value of owner as a user id", () => {
    expect(parse("owner=u-other", "ADMIN").owners).toEqual([]);
  });
});
