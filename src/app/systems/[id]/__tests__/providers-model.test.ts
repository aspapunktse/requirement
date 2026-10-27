import { describe, expect, it } from "vitest";
import type { ProviderDependencyRow } from "@/lib/provider-dependency-rules";
import { flowNodesOf, providerCardOf } from "../providers-model";

const offering = (code: string, type: "FULL" | "SHARED", appliesToProvider = true) => ({
  control: { id: `id-${code}`, code, title: `Title ${code}` },
  type,
  customerResponsibility: type === "SHARED" ? "Customer half" : null,
  providerStatus: "FULFILLED" as const,
  appliesToProvider,
});

const dependency = (name: string, onboarded: boolean, offerings: ProviderDependencyRow["offerings"]): ProviderDependencyRow => ({
  providerId: `p-${name}`,
  name,
  onboarded,
  canSee: true,
  offerings,
});

describe("providerCardOf", () => {
  it("counts Full and Shared Offerings and lists the Control codes in code order", () => {
    const card = providerCardOf(dependency("LZ", true, [offering("A.8.24", "SHARED"), offering("A.5.15", "FULL"), offering("A.5.9", "FULL"), offering("A.7.8", "FULL", false)]));
    expect(card.full).toBe(3);
    expect(card.shared).toBe(1);
    expect(card.controls.map((control) => control.code)).toEqual(["A.5.9", "A.5.15", "A.7.8", "A.8.24"]);
    expect(card.controls.find((control) => control.code === "A.7.8")?.appliesToProvider).toBe(false);
  });

  it("is all zeros for a Provider that offers nothing this System needs", () => {
    expect(providerCardOf(dependency("Empty", false, []))).toMatchObject({ full: 0, shared: 0, controls: [], onboarded: false });
  });
});

describe("flowNodesOf", () => {
  const sum = (nodes: { count: number }[]) => nodes.reduce((total, node) => total + node.count, 0);

  it("orders the Organization, the Providers by name, then This System, each sized by the Controls it decides", () => {
    const nodes = flowNodesOf({
      organization: 12,
      system: 30,
      byProvider: { "p-Alpha": 2, "p-Zeta": 1 },
      dependencies: [dependency("Zeta", true, [offering("A.1", "FULL")]), dependency("Alpha", true, [offering("A.2", "FULL"), offering("A.3", "SHARED")])],
    });
    expect(nodes.map((node) => [node.name, node.count])).toEqual([
      ["Organization", 12],
      ["Alpha", 2],
      ["Zeta", 1],
      ["This System", 30],
    ]);
    expect(sum(nodes)).toBe(45);
  });

  it("sums to the applicable total when a Provider's Offerings take their status from the System itself", () => {
    // 10 applicable Controls: 3 from the Organization, 6 from the System (4 of them are Entra's Offerings, but the System's own Assessment decides), 1 from Entra.
    const entra = dependency("Entra", true, [offering("A.5.15", "FULL"), offering("A.5.16", "FULL"), offering("A.5.17", "FULL"), offering("A.8.5", "FULL")]);
    const nodes = flowNodesOf({ organization: 3, system: 6, byProvider: { "p-Entra": 1 }, dependencies: [entra] });
    expect(sum(nodes)).toBe(10);
    expect(providerCardOf(entra).full).toBe(4); // the card still counts its Offerings
    expect(nodes.find((node) => node.name === "Entra")?.count).toBe(1);
  });

  it("keeps a Provider that decides nothing at 0, dashed when pending", () => {
    const nodes = flowNodesOf({ organization: 0, system: 0, byProvider: {}, dependencies: [dependency("Waiting", false, [offering("A.1", "FULL")]), dependency("Idle", true, [])] });
    expect(nodes.map((node) => [node.name, node.count, node.pending ?? false])).toEqual([
      ["Idle", 0, false],
      ["Waiting", 0, true],
    ]);
  });

  it("leaves the Organization and This System out when they supply nothing", () => {
    expect(flowNodesOf({ organization: 0, system: 0, byProvider: {}, dependencies: [] })).toEqual([]);
  });
});
