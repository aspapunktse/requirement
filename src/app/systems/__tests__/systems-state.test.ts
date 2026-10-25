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
      sort: "prog" as const,
      dir: -1 as const,
      group: "unit" as const,
      page: 3,
      per: 25,
    };
    const query = serializeRegisterState(state);
    expect(parse(query)).toEqual(state);
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
