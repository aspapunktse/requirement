import { describe, expect, it } from "vitest";
import { buildLineages, type LineageNode } from "../framework-lineage";

function node(id: string, version: string, supersedesId: string | null, status: "DRAFT" | "PUBLISHED" = "PUBLISHED", name = "FW"): LineageNode {
  return { id, name, version, status, supersedesId };
}

/** Each path as "v1 > v2*" with * on the current member, Drafts as "v (D)". */
function render(paths: ReturnType<typeof buildLineages> extends Map<string, infer P> ? P | undefined : never) {
  return paths?.map((path) => path.map((m) => `${m.version}${m.status === "DRAFT" ? "(D)" : ""}${m.current ? "*" : ""}`).join(">"));
}

describe("buildLineages", () => {
  it("gives a lone Framework no lineage", () => {
    expect(buildLineages([node("a", "1", null)], true).size).toBe(0);
  });

  it("shows two versions oldest first", () => {
    const lineages = buildLineages([node("b", "2", "a"), node("a", "1", null)], false);
    expect(render(lineages.get("a"))).toEqual(["1*>2"]);
    expect(render(lineages.get("b"))).toEqual(["1>2*"]);
  });

  it("shows three versions in order, the same chain from each member", () => {
    const all = [node("c", "3", "b"), node("a", "1", null), node("b", "2", "a")];
    const lineages = buildLineages(all, false);
    expect(render(lineages.get("a"))).toEqual(["1*>2>3"]);
    expect(render(lineages.get("b"))).toEqual(["1>2*>3"]);
    expect(render(lineages.get("c"))).toEqual(["1>2>3*"]);
  });

  it("closes the chain over a Draft for a user who can't see Drafts, and leaks nothing of it", () => {
    const all = [node("a", "1", null), node("b", "SECRET", "a", "DRAFT"), node("c", "3", "b")];
    const lineages = buildLineages(all, false);
    expect(render(lineages.get("a"))).toEqual(["1*>3"]);
    expect(render(lineages.get("c"))).toEqual(["1>3*"]);
    expect(lineages.has("b")).toBe(false);
    expect(JSON.stringify([...lineages])).not.toContain("SECRET");
  });

  it("closes over two Drafts in a row", () => {
    const all = [node("a", "1", null), node("b", "2", "a", "DRAFT"), node("c", "3", "b", "DRAFT"), node("d", "4", "c")];
    expect(render(buildLineages(all, false).get("d"))).toEqual(["1>4*"]);
  });

  it("drops a Draft at the end of a chain, and a chain left with one version", () => {
    const all = [node("a", "1", null), node("b", "2", "a", "DRAFT")];
    expect(buildLineages(all, false).size).toBe(0);
    const three = [...all, node("c", "0", null), node("d", "0.5", "c"), node("e", "9", "d", "DRAFT")];
    expect(render(buildLineages(three, false).get("c"))).toEqual(["0*>0.5"]);
  });

  it("shows Drafts, marked, to a user who can see them", () => {
    const all = [node("a", "1", null), node("b", "2", "a", "DRAFT"), node("c", "3", "b")];
    const lineages = buildLineages(all, true);
    expect(render(lineages.get("a"))).toEqual(["1*>2(D)>3"]);
    expect(render(lineages.get("b"))).toEqual(["1>2(D)*>3"]);
  });

  it("keeps a Draft root's later versions for a user who can't see it, starting at the first visible one", () => {
    const all = [node("a", "1", null, "DRAFT"), node("b", "2", "a"), node("c", "3", "b")];
    expect(render(buildLineages(all, false).get("c"))).toEqual(["2>3*"]);
  });

  it("renders every branch of a fork, ordered by name then version", () => {
    const all = [node("a", "1", null), node("z", "2b", "a"), node("y", "2a", "a"), node("x", "3", "y")];
    const lineages = buildLineages(all, true);
    expect(render(lineages.get("a"))).toEqual(["1*>2a>3", "1*>2b"]);
    expect(render(lineages.get("z"))).toEqual(["1>2a>3", "1>2b*"]);
  });

  it("keeps separate families apart", () => {
    const all = [node("a", "1", null, "PUBLISHED", "A"), node("b", "2", "a", "PUBLISHED", "A"), node("x", "1", null, "PUBLISHED", "X")];
    const lineages = buildLineages(all, true);
    expect(lineages.has("x")).toBe(false);
    expect(lineages.get("a")?.[0].map((m) => m.id)).toEqual(["a", "b"]);
  });

  it("survives a loop in bad data without hanging", () => {
    const all = [node("a", "1", "b"), node("b", "2", "a")];
    expect(() => buildLineages(all, true)).not.toThrow();
  });
});
