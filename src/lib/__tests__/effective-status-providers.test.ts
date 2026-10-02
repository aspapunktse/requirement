import { describe, expect, it } from "vitest";
import type { ControlAssessmentStatus } from "@prisma/client";
import {
  CREDITED_OFFERING_TYPES,
  describeEffectiveStatusNow,
  describeInheritedStatusChange,
  effectiveOverrideNote,
  effectiveSourceDetails,
  effectiveSourceLabel,
  inheritanceSourceGivesCredit,
  inheritanceSourcesFor,
  isInheritanceSource,
  PROVIDER_PENDING_TEXT,
  resetToInheritedRefusal,
  resolveEffectiveStatus,
  sourceNoCreditReason,
  type InheritanceSource,
  type OwnAssessment,
  type ProviderSource,
  type SourceNoCreditReason,
} from "../effective-status";

/** Pure Provider-source rules (F-IN.3-F-IN.5, OQ-2, #124): no database. */

const STATUSES: ControlAssessmentStatus[] = ["NOT_STARTED", "IN_PROGRESS", "FULFILLED", "WAIVED", "NOT_APPLICABLE"];

const organization = (status: ControlAssessmentStatus): InheritanceSource => ({ kind: "ORGANIZATION", type: "FULL", status });

function provider(overrides: Partial<ProviderSource> & { name?: string; id?: string } = {}): ProviderSource {
  const { name = "Landing Zone", id = "p-lz", ...rest } = overrides;
  return {
    kind: "PROVIDER",
    type: "FULL",
    status: "FULFILLED",
    provider: { id, name },
    providerOnboarded: true,
    appliesToProvider: true,
    customerResponsibility: null,
    ...rest,
  };
}

describe("sourceNoCreditReason: why a source gives no credit", () => {
  it("gives credit to a Fulfilled Full Offering of an Onboarded Provider that still applies", () => {
    expect(sourceNoCreditReason(provider())).toBeNull();
    expect(inheritanceSourceGivesCredit(provider())).toBe(true);
  });

  it.each(STATUSES.filter((status) => status !== "FULFILLED"))("%s Provider status: not Fulfilled", (status) => {
    expect(sourceNoCreditReason(provider({ status }))).toBe("NOT_FULFILLED");
  });

  it("a Provider that isn't Onboarded: pending, whatever its status", () => {
    for (const status of STATUSES) {
      expect(sourceNoCreditReason(provider({ status, providerOnboarded: false }))).toBe("PROVIDER_NOT_ONBOARDED");
    }
  });

  it("a Control that no longer applies to the Provider: no credit, even if Fulfilled", () => {
    expect(sourceNoCreditReason(provider({ appliesToProvider: false }))).toBe("NO_LONGER_APPLIES");
  });

  it("a Shared Offering gives credit only with the System's own half done too (#125); both types can give credit", () => {
    const shared = provider({ type: "SHARED", customerResponsibility: "Manage keys" });
    expect(sourceNoCreditReason(shared)).toBe("CUSTOMER_HALF_MISSING");
    expect(sourceNoCreditReason(shared, false)).toBe("CUSTOMER_HALF_MISSING");
    expect(sourceNoCreditReason(shared, true)).toBeNull();
    expect(CREDITED_OFFERING_TYPES).toEqual(["FULL", "SHARED"]);
  });

  it("names the first reason when several hold: pending, then no longer applies, then not Fulfilled, then the System's own half", () => {
    const all = provider({ type: "SHARED", status: "NOT_STARTED", providerOnboarded: false, appliesToProvider: false });
    const reasons: SourceNoCreditReason[] = [];
    reasons.push(sourceNoCreditReason(all)!);
    reasons.push(sourceNoCreditReason({ ...all, providerOnboarded: true })!);
    reasons.push(sourceNoCreditReason({ ...all, providerOnboarded: true, appliesToProvider: true })!);
    reasons.push(sourceNoCreditReason({ ...all, providerOnboarded: true, appliesToProvider: true, status: "FULFILLED" })!);
    expect(reasons).toEqual(["PROVIDER_NOT_ONBOARDED", "NO_LONGER_APPLIES", "NOT_FULFILLED", "CUSTOMER_HALF_MISSING"]);
  });

  it("the Organization is judged by its status alone", () => {
    expect(STATUSES.filter((status) => inheritanceSourceGivesCredit(organization(status)))).toEqual(["FULFILLED"]);
    expect(sourceNoCreditReason(organization("WAIVED"))).toBe("NOT_FULFILLED");
  });
});

describe("resolveEffectiveStatus with Provider sources", () => {
  const untouched: OwnAssessment = { status: "NOT_STARTED", personSet: false };

  it("a credited Provider makes an untouched Control Fulfilled, decided by that Provider", () => {
    const result = resolveEffectiveStatus(untouched, [provider()]);
    expect(result.status).toBe("FULFILLED");
    expect(result.source).toEqual(provider());
    expect(result.sources).toEqual([{ ...provider(), givesCredit: true }]);
    expect(isInheritanceSource(result.source)).toBe(true);
  });

  it("with no row at all it is the same", () => {
    expect(resolveEffectiveStatus(null, [provider()]).status).toBe("FULFILLED");
  });

  it.each([
    ["not Fulfilled", provider({ status: "IN_PROGRESS" })],
    ["pending (not Onboarded)", provider({ providerOnboarded: false })],
    ["no longer applying", provider({ appliesToProvider: false })],
  ])("a %s Provider gives no credit: the own status stands and the source is still listed", (_label, source) => {
    for (const own of [null, untouched, { status: "IN_PROGRESS", personSet: false } as OwnAssessment]) {
      const result = resolveEffectiveStatus(own, [source]);
      expect(result.status).toBe(own?.status ?? "NOT_STARTED");
      expect(result.source).toEqual({ kind: "SYSTEM" });
      expect(result.sources).toEqual([{ ...source, givesCredit: false }]);
      expect(result.overridesInherited).toBe(false);
    }
  });

  it.each(STATUSES)("a person-set own %s always wins over a credited Provider", (status) => {
    const result = resolveEffectiveStatus({ status, personSet: true }, [provider()]);
    expect(result.status).toBe(status);
    expect(result.source).toEqual({ kind: "SYSTEM" });
    expect(result.overridesInherited).toBe(status !== "FULFILLED");
  });

  it("an own Fulfilled that a Capability set (not person-set) stays Fulfilled with no credited source", () => {
    expect(resolveEffectiveStatus({ status: "FULFILLED", personSet: false }, [provider({ status: "NOT_STARTED" })]).status).toBe("FULFILLED");
  });

  describe("several sources for one Control (OQ-2: the most favourable wins, every one is listed)", () => {
    it("Organization Fulfilled and a Provider that gives nothing: Fulfilled through the Organization", () => {
      const result = resolveEffectiveStatus(untouched, [organization("FULFILLED"), provider({ status: "NOT_STARTED" })]);
      expect(result.status).toBe("FULFILLED");
      expect(result.source.kind).toBe("ORGANIZATION");
      expect(result.sources.map((source) => source.givesCredit)).toEqual([true, false]);
    });

    it("Organization not Fulfilled and a credited Provider: Fulfilled through the Provider", () => {
      const result = resolveEffectiveStatus(untouched, [organization("NOT_STARTED"), provider()]);
      expect(result.status).toBe("FULFILLED");
      expect(result.source).toEqual(provider());
      expect(result.sources.map((source) => source.givesCredit)).toEqual([false, true]);
    });

    it("both credited: the first in list order decides (the Organization), both are listed", () => {
      const result = resolveEffectiveStatus(untouched, [organization("FULFILLED"), provider()]);
      expect(result.source.kind).toBe("ORGANIZATION");
      expect(result.sources).toHaveLength(2);
    });

    it("two Providers, one Fulfilled and one not: the Fulfilled one wins and both are listed", () => {
      const fulfilled = provider({ name: "Beta", id: "b", status: "FULFILLED" });
      const notYet = provider({ name: "Alpha", id: "a", status: "IN_PROGRESS" });
      const result = resolveEffectiveStatus(untouched, inheritanceSourcesFor({ applicability: "PER_SYSTEM" }, undefined, [fulfilled, notYet]));
      expect(result.status).toBe("FULFILLED");
      expect(result.source).toEqual(fulfilled);
      expect(result.sources.map((source) => (source.kind === "PROVIDER" ? source.provider.name : "Organization"))).toEqual(["Alpha", "Beta"]);
      expect(result.sources.map((source) => source.givesCredit)).toEqual([false, true]);
    });

    it("two Providers neither of which gives credit: nothing is inherited", () => {
      const result = resolveEffectiveStatus(untouched, [provider({ status: "IN_PROGRESS" }), provider({ id: "x", providerOnboarded: false })]);
      expect(result.status).toBe("NOT_STARTED");
      expect(result.sources.map((source) => source.givesCredit)).toEqual([false, false]);
    });
  });

  it("is a function of the source objects alone: re-resolving the sources it returned (as the client does after a save) gives the same answer", () => {
    const first = resolveEffectiveStatus(untouched, [organization("FULFILLED"), provider(), provider({ id: "q", name: "Q", providerOnboarded: false })]);
    const again = resolveEffectiveStatus(untouched, first.sources);
    expect(again).toEqual(first);
    const afterSave = resolveEffectiveStatus({ status: "IN_PROGRESS", personSet: true }, first.sources);
    expect(afterSave.status).toBe("IN_PROGRESS");
    expect(afterSave.overridesInherited).toBe(true);
    expect(afterSave.sources.map((s) => s.givesCredit)).toEqual(first.sources.map((s) => s.givesCredit));
  });
});

describe("inheritanceSourcesFor with Providers", () => {
  const zebra = provider({ name: "Zebra", id: "1" });
  const alphaLate = provider({ name: "Alpha", id: "9" });
  const alphaEarly = provider({ name: "Alpha", id: "2" });
  const lowercase = provider({ name: "alpha", id: "0" });

  it("lists the Organization first, then Providers by name in code-unit order, then id", () => {
    const sources = inheritanceSourcesFor({ applicability: "BOTH" }, "FULFILLED", [zebra, lowercase, alphaLate, alphaEarly]);
    expect(sources.map((source) => (source.kind === "PROVIDER" ? `${source.provider.name}/${source.provider.id}` : source.kind))).toEqual([
      "ORGANIZATION",
      "Alpha/2",
      "Alpha/9",
      "Zebra/1",
      "alpha/0",
    ]);
  });

  it("is the same whatever order the Providers come in", () => {
    const a = inheritanceSourcesFor({ applicability: "PER_SYSTEM" }, undefined, [zebra, alphaEarly, alphaLate]);
    const b = inheritanceSourcesFor({ applicability: "PER_SYSTEM" }, undefined, [alphaLate, zebra, alphaEarly]);
    expect(a).toEqual(b);
  });

  it("gives a Per-System Control a source for each Provider (and no Organization source)", () => {
    expect(inheritanceSourcesFor({ applicability: "PER_SYSTEM" }, "FULFILLED", [zebra])).toEqual([zebra]);
    expect(inheritanceSourcesFor({ applicability: "PER_SYSTEM" }, "FULFILLED")).toEqual([]);
  });

  it("gives an Organizational Control none at all: it is implemented, not inherited", () => {
    expect(inheritanceSourcesFor({ applicability: "ORGANIZATIONAL" }, "FULFILLED", [zebra])).toEqual([]);
  });

  it("does not change what a Both Control without Providers gets", () => {
    expect(inheritanceSourcesFor({ applicability: "BOTH" }, undefined)).toEqual([organization("NOT_STARTED")]);
  });
});

describe("the Provider wording", () => {
  const credited = resolveEffectiveStatus(null, [provider()]);

  it("labels what decided: Inherited from Provider <name>: Full", () => {
    expect(effectiveSourceLabel(credited)).toBe("Inherited from Provider Landing Zone: Full");
    expect(effectiveSourceLabel(resolveEffectiveStatus(null, [organization("FULFILLED")]))).toBe("Inherited from Organization");
  });

  it("lists every source with the Provider's status and the reason it gives no credit", () => {
    const lines = (source: ProviderSource) => effectiveSourceDetails(resolveEffectiveStatus(null, [source]));
    expect(lines(provider())).toEqual(['Provider "Landing Zone" (Full): Fulfilled']);
    expect(lines(provider({ status: "IN_PROGRESS" }))).toEqual(['Provider "Landing Zone" (Full): In Progress (gives no credit)']);
    expect(lines(provider({ providerOnboarded: false }))).toEqual([`Provider "Landing Zone" (Full): Fulfilled (${PROVIDER_PENDING_TEXT})`]);
    expect(PROVIDER_PENDING_TEXT).toBe("pending: Provider not Onboarded");
    expect(lines(provider({ appliesToProvider: false }))).toEqual([
      'Provider "Landing Zone" (Full): Fulfilled (this Control no longer applies to the Provider, gives no credit)',
    ]);
    expect(lines(provider({ type: "SHARED", customerResponsibility: "The tenant manages its own keys" }))).toEqual([
      "Provider \"Landing Zone\" (Shared): Fulfilled (this System's own half is not Fulfilled; customer responsibility: The tenant manages its own keys)",
    ]);
  });

  it("keeps the Organization lines exactly as they were", () => {
    expect(effectiveSourceDetails(resolveEffectiveStatus(null, [organization("FULFILLED")]))).toEqual(["Organization: Fulfilled"]);
    expect(effectiveSourceDetails(resolveEffectiveStatus(null, [organization("WAIVED")]))).toEqual(["Organization: Waived (gives no credit)"]);
  });

  it("lists the Organization and a Provider together, in order", () => {
    const both = resolveEffectiveStatus(null, [organization("NOT_STARTED"), provider()]);
    expect(effectiveSourceDetails(both)).toEqual(["Organization: Not Started (gives no credit)", 'Provider "Landing Zone" (Full): Fulfilled']);
    expect(effectiveSourceLabel(both)).toBe("Inherited from Provider Landing Zone: Full");
  });

  it("says the override in one line, naming the Provider that would have made it Fulfilled", () => {
    const overriding = resolveEffectiveStatus({ status: "IN_PROGRESS", personSet: true }, [provider()]);
    expect(effectiveOverrideNote(overriding)).toBe(`This System's own Assessment (In Progress) overrides Provider "Landing Zone"'s Fulfilled status.`);
    const overridingOrganization = resolveEffectiveStatus({ status: "IN_PROGRESS", personSet: true }, [organization("FULFILLED")]);
    expect(effectiveOverrideNote(overridingOrganization)).toBe("This System's own Assessment (In Progress) overrides the Organization's Fulfilled status.");
  });

  it("words the Change Events and the reset event with the Provider's name", () => {
    const none = resolveEffectiveStatus(null, [provider({ status: "NOT_STARTED" })]);
    expect(describeInheritedStatusChange("A.8.24", none, credited)).toBe('A.8.24 is now Fulfilled, inherited from Provider "Landing Zone"');
    expect(describeInheritedStatusChange("A.8.24", credited, none)).toBe(
      'A.8.24 is no longer inherited from Provider "Landing Zone" (now Not Started)',
    );
    expect(describeInheritedStatusChange("A.8.24", credited, credited)).toBeNull();
    // The Organization wording is pinned byte for byte.
    const org = resolveEffectiveStatus(null, [organization("FULFILLED")]);
    expect(describeInheritedStatusChange("A.5.15", none, org)).toBe("A.5.15 is now Fulfilled, inherited from the Organization");
    expect(describeEffectiveStatusNow(credited)).toBe('now Fulfilled, inherited from Provider "Landing Zone"');
    expect(describeEffectiveStatusNow(org)).toBe("now Fulfilled, inherited from the Organization");
  });

  it("logs nothing when the status stays Fulfilled but a different source decides", () => {
    const viaOrganization = resolveEffectiveStatus(null, [organization("FULFILLED"), provider({ status: "NOT_STARTED" })]);
    const viaBoth = resolveEffectiveStatus(null, [organization("FULFILLED"), provider()]);
    expect(describeInheritedStatusChange("A.8.24", viaOrganization, viaBoth)).toBeNull();
  });
});

describe("reset to inherited with a Provider source (#129 and #124)", () => {
  const own: OwnAssessment = { status: "IN_PROGRESS", personSet: true };

  it("is possible on a Per-System Control, which never had a source before, once a Provider offers it", () => {
    const before = resetToInheritedRefusal({ applies: true, sources: inheritanceSourcesFor({ applicability: "PER_SYSTEM" }, undefined), own });
    expect(before).toBe("NO_SOURCE");
    const after = resetToInheritedRefusal({
      applies: true,
      sources: inheritanceSourcesFor({ applicability: "PER_SYSTEM" }, undefined, [provider()]),
      own,
    });
    expect(after).toBeNull();
  });

  it("the existence of a Full source is enough: a pending, not-Fulfilled or no-longer-applying one too", () => {
    for (const source of [
      provider({ providerOnboarded: false }),
      provider({ status: "NOT_STARTED" }),
      provider({ appliesToProvider: false }),
    ]) {
      expect(resetToInheritedRefusal({ applies: true, sources: [source], own })).toBeNull();
    }
  });

  it("a Shared source alone is not enough (D2 on #125), whatever its state", () => {
    for (const source of [
      provider({ type: "SHARED", customerResponsibility: "x" }),
      provider({ type: "SHARED", customerResponsibility: "x", providerOnboarded: false }),
      provider({ type: "SHARED", customerResponsibility: "x", status: "NOT_STARTED" }),
    ]) {
      expect(resetToInheritedRefusal({ applies: true, sources: [source], own })).toBe("NO_SOURCE");
    }
  });

  it("a Full source next to a Shared one still allows it", () => {
    const shared = provider({ type: "SHARED", customerResponsibility: "x", id: "s", name: "Shared" });
    expect(resetToInheritedRefusal({ applies: true, sources: [shared, provider()], own })).toBeNull();
    expect(resetToInheritedRefusal({ applies: true, sources: [organization("NOT_STARTED"), shared], own })).toBeNull();
  });

  it("still refuses when the Assessment is not person-set, or the Control no longer applies", () => {
    expect(resetToInheritedRefusal({ applies: true, sources: [provider()], own: { status: "FULFILLED", personSet: false } })).toBe("NOT_PERSON_SET");
    expect(resetToInheritedRefusal({ applies: false, sources: [provider()], own })).toBe("NOT_APPLICABLE");
  });
});
