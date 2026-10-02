import { describe, expect, it } from "vitest";
import type { ControlAssessmentStatus } from "@prisma/client";
import {
  awaitedProviderHalves,
  customerHalfIsDone,
  describeEffectiveStatusNow,
  describeInheritedStatusChange,
  describeOwnEditEffect,
  effectiveAwaitingNote,
  effectiveNote,
  effectiveOverrideNote,
  effectiveSourceDetails,
  effectiveSourceLabel,
  inheritanceSourcesFor,
  PROVIDER_HALF_MISSING_STATUS,
  resetToInheritedRefusalMessage,
  resolveEffectiveStatus,
  sourceHalfMissing,
  type EffectiveStatus,
  type InheritanceSource,
  type OwnAssessment,
  type ProviderSource,
} from "../effective-status";

/** The F-IN.5 rule with Shared Offerings (#125): own half, Provider's half, D1, D2, D3. No database. */

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

/** A Shared Offering whose Provider half is satisfied (Onboarded, applies, Fulfilled) unless `overrides` break it. */
const shared = (overrides: Partial<ProviderSource> & { name?: string; id?: string } = {}) =>
  provider({ type: "SHARED", customerResponsibility: "The tenant manages its own keys", ...overrides });

const person = (status: ControlAssessmentStatus): OwnAssessment => ({ status, personSet: true });
const nobody = (status: ControlAssessmentStatus): OwnAssessment => ({ status, personSet: false });

function deciding(effective: EffectiveStatus): string {
  const { source } = effective;
  if (source.kind === "PROVIDER") return `${source.provider.name}/${source.type}`;
  return source.kind;
}

describe("the Provider's half of an Offering", () => {
  it("is satisfied when the Provider is Onboarded, the Control still applies and its own status is Fulfilled", () => {
    expect(sourceHalfMissing(shared())).toBeNull();
    expect(sourceHalfMissing(shared({ status: "IN_PROGRESS" }))).toBe("NOT_FULFILLED");
    expect(sourceHalfMissing(shared({ providerOnboarded: false }))).toBe("PROVIDER_NOT_ONBOARDED");
    expect(sourceHalfMissing(shared({ appliesToProvider: false }))).toBe("NO_LONGER_APPLIES");
  });

  it("is judged the same for a Full source, which needs nothing else", () => {
    expect(sourceHalfMissing(provider())).toBeNull();
    expect(sourceHalfMissing(organization("WAIVED"))).toBe("NOT_FULFILLED");
  });
});

describe("the System's own half (D3)", () => {
  it("is done when the own status is Fulfilled, whoever set it", () => {
    expect(customerHalfIsDone(person("FULFILLED"))).toBe(true);
    expect(customerHalfIsDone(nobody("FULFILLED"))).toBe(true); // a Capability's auto-fulfilment
  });

  it.each(STATUSES.filter((status) => status !== "FULFILLED"))("is not done for own %s", (status) => {
    expect(customerHalfIsDone(person(status))).toBe(false);
    expect(customerHalfIsDone(nobody(status))).toBe(false);
  });

  it("is not done with no row", () => {
    expect(customerHalfIsDone(null)).toBe(false);
  });
});

describe("resolveEffectiveStatus with Shared sources: the decision table", () => {
  const SATISFIED = shared();
  const PROVIDER_IN_PROGRESS = shared({ status: "IN_PROGRESS" });
  const PENDING = shared({ providerOnboarded: false });
  const NOT_APPLYING = shared({ appliesToProvider: false });

  // [label, own, sources, status, deciding source, overridesInherited]
  const table: [string, OwnAssessment, InheritanceSource[], ControlAssessmentStatus, string, boolean][] = [
    // Waived / Not Applicable win outright, whatever the sources.
    ["person-set Waived, Shared satisfied", person("WAIVED"), [SATISFIED], "WAIVED", "SYSTEM", false],
    ["person-set Waived, a Full source gives credit", person("WAIVED"), [provider({ name: "Full" }), SATISFIED], "WAIVED", "SYSTEM", true],
    ["person-set Not Applicable, Shared satisfied", person("NOT_APPLICABLE"), [SATISFIED], "NOT_APPLICABLE", "SYSTEM", false],
    ["person-set Not Applicable, nothing gives credit", person("NOT_APPLICABLE"), [PROVIDER_IN_PROGRESS], "NOT_APPLICABLE", "SYSTEM", false],
    // A person-set In Progress / Not Started is the effective status, over a Full credit as before.
    ["person-set In Progress, Shared satisfied", person("IN_PROGRESS"), [SATISFIED], "IN_PROGRESS", "SYSTEM", false],
    ["person-set Not Started, Shared satisfied", person("NOT_STARTED"), [SATISFIED], "NOT_STARTED", "SYSTEM", false],
    ["person-set In Progress over a Full credit", person("IN_PROGRESS"), [provider({ name: "Full" }), SATISFIED], "IN_PROGRESS", "SYSTEM", true],
    ["person-set Not Started over the Organization", person("NOT_STARTED"), [organization("FULFILLED"), SATISFIED], "NOT_STARTED", "SYSTEM", true],
    // Own Fulfilled.
    ["own Fulfilled, no Shared source", person("FULFILLED"), [], "FULFILLED", "SYSTEM", false],
    ["own Fulfilled, a Full source that gives nothing", person("FULFILLED"), [provider({ status: "NOT_STARTED" })], "FULFILLED", "SYSTEM", false],
    ["own Fulfilled, a Full source gives credit and a Shared one does not", person("FULFILLED"), [provider({ name: "Full" }), PROVIDER_IN_PROGRESS], "FULFILLED", "SYSTEM", false],
    ["own Fulfilled, Shared satisfied", person("FULFILLED"), [SATISFIED], "FULFILLED", "Landing Zone/SHARED", false],
    ["own Fulfilled, Shared satisfied, a Full source gives credit too", person("FULFILLED"), [SATISFIED, provider({ name: "Zed" })], "FULFILLED", "SYSTEM", false],
    ["own Fulfilled, the Provider is not Fulfilled (D1)", person("FULFILLED"), [PROVIDER_IN_PROGRESS], PROVIDER_HALF_MISSING_STATUS, "SYSTEM", false],
    ["own Fulfilled, the Provider is not Onboarded (D1)", person("FULFILLED"), [PENDING], PROVIDER_HALF_MISSING_STATUS, "SYSTEM", false],
    ["own Fulfilled, the Control no longer applies to the Provider (D1)", person("FULFILLED"), [NOT_APPLYING], PROVIDER_HALF_MISSING_STATUS, "SYSTEM", false],
    ["own Fulfilled, the Organization not Fulfilled and Shared not satisfied (D1)", person("FULFILLED"), [organization("NOT_STARTED"), PROVIDER_IN_PROGRESS], PROVIDER_HALF_MISSING_STATUS, "SYSTEM", false],
    // OQ-2 with several Shared sources: one satisfied is enough.
    [
      "own Fulfilled, two Shared sources, one satisfied",
      person("FULFILLED"),
      [shared({ name: "Alpha", id: "a", status: "IN_PROGRESS" }), shared({ name: "Beta", id: "b" })],
      "FULFILLED",
      "Beta/SHARED",
      false,
    ],
    [
      "own Fulfilled, two Shared sources, both satisfied: the first decides",
      person("FULFILLED"),
      [shared({ name: "Alpha", id: "a" }), shared({ name: "Beta", id: "b" })],
      "FULFILLED",
      "Alpha/SHARED",
      false,
    ],
    [
      "own Fulfilled, two Shared sources, none satisfied (D1)",
      person("FULFILLED"),
      [shared({ name: "Alpha", id: "a", status: "IN_PROGRESS" }), shared({ name: "Beta", id: "b", providerOnboarded: false })],
      PROVIDER_HALF_MISSING_STATUS,
      "SYSTEM",
      false,
    ],
    // Own untouched: a Full credit still makes it Fulfilled, a Shared source alone does not.
    ["untouched, a Full source gives credit, Shared satisfied", nobody("NOT_STARTED"), [SATISFIED, provider({ name: "Zed" })], "FULFILLED", "Zed/FULL", false],
    ["untouched, the Organization gives credit and a Shared source", nobody("NOT_STARTED"), [organization("FULFILLED"), SATISFIED], "FULFILLED", "ORGANIZATION", false],
    ["no row, a Full source gives credit and a Shared source", null, [SATISFIED, provider({ name: "Zed" })], "FULFILLED", "Zed/FULL", false],
    ["untouched, only Shared sources, satisfied: the owner's half is open", nobody("NOT_STARTED"), [SATISFIED], "NOT_STARTED", "SYSTEM", false],
    ["no row, only Shared sources, satisfied", null, [SATISFIED], "NOT_STARTED", "SYSTEM", false],
    ["untouched, only Shared sources, not satisfied", nobody("NOT_STARTED"), [PROVIDER_IN_PROGRESS], "NOT_STARTED", "SYSTEM", false],
    // D3: a Capability's auto-fulfilment is the customer's half.
    ["Capability-fulfilled, Shared satisfied (D3)", nobody("FULFILLED"), [SATISFIED], "FULFILLED", "Landing Zone/SHARED", false],
    ["Capability-fulfilled, Shared not satisfied (D1, D3)", nobody("FULFILLED"), [PROVIDER_IN_PROGRESS], PROVIDER_HALF_MISSING_STATUS, "SYSTEM", false],
    ["Capability-fulfilled, a Full source gives credit", nobody("FULFILLED"), [PROVIDER_IN_PROGRESS, provider({ name: "Zed" })], "FULFILLED", "Zed/FULL", false],
    ["Capability-fulfilled, no sources", nobody("FULFILLED"), [], "FULFILLED", "SYSTEM", false],
  ];

  it.each(table)("%s", (_label, own, sources, status, source, overridesInherited) => {
    const result = resolveEffectiveStatus(own, sources);
    expect(result.status).toBe(status);
    expect(deciding(result)).toBe(source);
    expect(result.overridesInherited).toBe(overridesInherited);
  });

  it("every status of the own Assessment against every Provider state, for a lone Shared source", () => {
    for (const ownStatus of STATUSES) {
      for (const personSet of [true, false]) {
        for (const [label, source, satisfied] of [
          ["satisfied", SATISFIED, true],
          ["Provider not Fulfilled", PROVIDER_IN_PROGRESS, false],
          ["pending", PENDING, false],
          ["not applying", NOT_APPLYING, false],
        ] as const) {
          const result = resolveEffectiveStatus({ status: ownStatus, personSet }, [source]);
          const expected: ControlAssessmentStatus =
            ownStatus !== "FULFILLED" ? ownStatus : satisfied ? "FULFILLED" : PROVIDER_HALF_MISSING_STATUS;
          expect(result.status, `own ${ownStatus} (person-set ${personSet}), ${label}`).toBe(expected);
          // A Shared source never reports an override: the own status is the customer's half.
          expect(result.overridesInherited).toBe(false);
        }
      }
    }
  });

  it("D1 is In Progress, in one constant", () => {
    expect(PROVIDER_HALF_MISSING_STATUS).toBe("IN_PROGRESS");
  });

  it("says per Shared source whether the System's own half is done, and nothing for a Full source", () => {
    const done = resolveEffectiveStatus(person("FULFILLED"), [organization("FULFILLED"), provider({ name: "F" }), shared({ name: "S" })]);
    expect(done.sources.map((s) => s.customerHalfDone)).toEqual([undefined, undefined, true]);
    expect(done.sources[0]).not.toHaveProperty("customerHalfDone");
    const open = resolveEffectiveStatus(person("IN_PROGRESS"), [shared()]);
    expect(open.sources[0].customerHalfDone).toBe(false);
    expect(open.sources[0].givesCredit).toBe(false);
  });

  it("a Shared source gives credit only while the own half is done and the Provider's is satisfied", () => {
    expect(resolveEffectiveStatus(person("FULFILLED"), [shared()]).sources[0].givesCredit).toBe(true);
    expect(resolveEffectiveStatus(person("FULFILLED"), [shared({ status: "IN_PROGRESS" })]).sources[0].givesCredit).toBe(false);
    expect(resolveEffectiveStatus(person("IN_PROGRESS"), [shared()]).sources[0].givesCredit).toBe(false);
  });

  it("is a function of the source objects alone: re-resolving what it returned after a save (the client) agrees", () => {
    const first = resolveEffectiveStatus(null, [shared(), shared({ name: "Zed", id: "z", status: "IN_PROGRESS" })]);
    expect(first.status).toBe("NOT_STARTED");
    const saved = resolveEffectiveStatus(person("FULFILLED"), first.sources);
    expect(saved.status).toBe("FULFILLED");
    expect(deciding(saved)).toBe("Landing Zone/SHARED");
    expect(saved.sources.map((s) => s.givesCredit)).toEqual([true, false]);
    expect(saved).toEqual(resolveEffectiveStatus(person("FULFILLED"), [shared(), shared({ name: "Zed", id: "z", status: "IN_PROGRESS" })]));
    const lowered = resolveEffectiveStatus(person("FULFILLED"), first.sources.map((s) => (s.kind === "PROVIDER" ? { ...s, status: "IN_PROGRESS" as const } : s)));
    expect(lowered.status).toBe(PROVIDER_HALF_MISSING_STATUS);
  });

  it("Full-only inputs resolve as they did before Shared Offerings", () => {
    const org = resolveEffectiveStatus(nobody("NOT_STARTED"), [organization("FULFILLED")]);
    expect(org).toEqual({
      status: "FULFILLED",
      source: organization("FULFILLED"),
      sources: [{ ...organization("FULFILLED"), givesCredit: true }],
      overridesInherited: false,
    });
    const overridden = resolveEffectiveStatus(person("IN_PROGRESS"), [provider()]);
    expect(overridden.overridesInherited).toBe(true);
    expect(resolveEffectiveStatus(person("FULFILLED"), [provider()]).source).toEqual({ kind: "SYSTEM" });
  });
});

describe("which half is missing", () => {
  it("is the Provider's, with the reason, when the own half is done", () => {
    const effective = resolveEffectiveStatus(person("FULFILLED"), [shared({ status: "IN_PROGRESS" })]);
    expect(effectiveSourceDetails(effective)).toEqual([
      'Provider "Landing Zone" (Shared): In Progress (the Provider\'s half is missing: the Provider has not Fulfilled it; customer responsibility: The tenant manages its own keys)',
    ]);
    expect(effectiveSourceDetails(resolveEffectiveStatus(person("FULFILLED"), [shared({ providerOnboarded: false })]))).toEqual([
      'Provider "Landing Zone" (Shared): Fulfilled (the Provider\'s half is missing, pending: Provider not Onboarded; customer responsibility: The tenant manages its own keys)',
    ]);
    expect(effectiveSourceDetails(resolveEffectiveStatus(person("FULFILLED"), [shared({ appliesToProvider: false })]))).toEqual([
      'Provider "Landing Zone" (Shared): Fulfilled (the Provider\'s half is missing: this Control no longer applies to the Provider; customer responsibility: The tenant manages its own keys)',
    ]);
  });

  it("is this System's own half when the Provider's is satisfied", () => {
    expect(effectiveSourceDetails(resolveEffectiveStatus(null, [shared()]))).toEqual([
      'Provider "Landing Zone" (Shared): Fulfilled (this System\'s own half is not Fulfilled; customer responsibility: The tenant manages its own keys)',
    ]);
  });

  it("is both when both are missing", () => {
    expect(effectiveSourceDetails(resolveEffectiveStatus(person("IN_PROGRESS"), [shared({ status: "NOT_STARTED" })]))).toEqual([
      'Provider "Landing Zone" (Shared): Not Started (the Provider\'s half is missing: the Provider has not Fulfilled it; this System\'s own half is not Fulfilled; customer responsibility: The tenant manages its own keys)',
    ]);
  });

  it("is neither when both halves are done: just the customer responsibility", () => {
    expect(effectiveSourceDetails(resolveEffectiveStatus(person("FULFILLED"), [shared()]))).toEqual([
      'Provider "Landing Zone" (Shared): Fulfilled (customer responsibility: The tenant manages its own keys)',
    ]);
  });

  it("keeps the Full and Organization lines byte for byte", () => {
    expect(effectiveSourceDetails(resolveEffectiveStatus(null, [organization("WAIVED"), provider({ status: "IN_PROGRESS" }), provider({ id: "x", name: "P", providerOnboarded: false })]))).toEqual([
      "Organization: Waived (gives no credit)",
      'Provider "Landing Zone" (Full): In Progress (gives no credit)',
      'Provider "P" (Full): Fulfilled (pending: Provider not Onboarded)',
    ]);
  });
});

describe("the System page wording", () => {
  it("labels a Shared source that decided: Inherited from Provider <name>: Shared", () => {
    expect(effectiveSourceLabel(resolveEffectiveStatus(person("FULFILLED"), [shared()]))).toBe("Inherited from Provider Landing Zone: Shared");
    expect(effectiveSourceLabel(resolveEffectiveStatus(person("FULFILLED"), [shared({ status: "IN_PROGRESS" })]))).toBe("System-specific");
  });

  it("says a held-back Control is waiting for the Provider (D1), and names every Provider it waits for", () => {
    const held = resolveEffectiveStatus(person("FULFILLED"), [shared({ status: "IN_PROGRESS" })]);
    expect(effectiveAwaitingNote(held)).toBe(
      `This System's own half is Fulfilled, but it is waiting for Provider "Landing Zone" to provide its half, so the Control is In Progress.`,
    );
    const heldTwice = resolveEffectiveStatus(person("FULFILLED"), [
      shared({ name: "Alpha", id: "a", status: "IN_PROGRESS" }),
      shared({ name: "Beta", id: "b", providerOnboarded: false }),
    ]);
    expect(effectiveAwaitingNote(heldTwice)).toContain('waiting for Provider "Alpha" or Provider "Beta" to provide their half');
    expect(effectiveNote(held)).toBe(effectiveAwaitingNote(held));
  });

  it("says nothing about waiting unless the Control is held back", () => {
    for (const effective of [
      resolveEffectiveStatus(person("FULFILLED"), [shared()]),
      resolveEffectiveStatus(person("IN_PROGRESS"), [shared({ status: "IN_PROGRESS" })]),
      resolveEffectiveStatus(null, [shared()]),
      resolveEffectiveStatus(person("FULFILLED"), [provider()]),
      resolveEffectiveStatus(person("FULFILLED"), []),
    ]) {
      expect(awaitedProviderHalves(effective)).toEqual([]);
      expect(effectiveAwaitingNote(effective)).toBeNull();
    }
  });

  it("claims no override where the own status is the customer's half of a Shared source, and still does for a Full one", () => {
    const sharedOnly = resolveEffectiveStatus(person("IN_PROGRESS"), [shared()]);
    expect(effectiveOverrideNote(sharedOnly)).toBeNull();
    expect(effectiveNote(sharedOnly)).toBeNull();
    const both = resolveEffectiveStatus(person("IN_PROGRESS"), [shared(), provider({ name: "Zed", id: "z" })]);
    expect(effectiveOverrideNote(both)).toBe(`This System's own Assessment (In Progress) overrides Provider "Zed"'s Fulfilled status.`);
  });
});

describe("the Change Event wording (F-IN.7)", () => {
  const before = (sources: InheritanceSource[], own: OwnAssessment = person("FULFILLED")) => resolveEffectiveStatus(own, sources);

  it("a Shared source that makes the Control Fulfilled: now Fulfilled, inherited from the Provider (Shared)", () => {
    const missing = before([shared({ status: "IN_PROGRESS" })]);
    const satisfied = before([shared()]);
    expect(describeInheritedStatusChange("A.8.24", missing, satisfied)).toBe('A.8.24 is now Fulfilled, inherited from Provider "Landing Zone" (Shared)');
  });

  it("the Provider's half going missing: now In Progress, waiting for the Provider", () => {
    const satisfied = before([shared()]);
    const missing = before([shared({ status: "IN_PROGRESS" })]);
    expect(describeInheritedStatusChange("A.8.24", satisfied, missing)).toBe('A.8.24 is now In Progress: waiting for Provider "Landing Zone" to provide its half');
  });

  it("declaring a dependency that lowers the System: from System-specific Fulfilled to waiting", () => {
    const alone = before([]);
    const lowered = before([shared({ status: "NOT_STARTED" })]);
    expect(alone.status).toBe("FULFILLED");
    expect(describeInheritedStatusChange("A.8.24", alone, lowered)).toBe('A.8.24 is now In Progress: waiting for Provider "Landing Zone" to provide its half');
  });

  it("stays quiet when the status doesn't move, even if a different source decides", () => {
    expect(describeInheritedStatusChange("A.8.24", before([]), before([shared()]))).toBeNull();
    expect(describeInheritedStatusChange("A.8.24", before([shared()]), before([]))).toBeNull();
  });

  it("an Offering going from Full to Shared, or back, reads in the existing wording with the type named", () => {
    const untouched = (source: ProviderSource) => resolveEffectiveStatus(nobody("NOT_STARTED"), [source]);
    expect(describeInheritedStatusChange("A.8.24", untouched(provider()), untouched(shared()))).toBe(
      'A.8.24 is no longer inherited from Provider "Landing Zone" (now Not Started)',
    );
    expect(describeInheritedStatusChange("A.8.24", untouched(shared()), untouched(provider()))).toBe(
      'A.8.24 is now Fulfilled, inherited from Provider "Landing Zone"',
    );
  });

  it("keeps the Organization and Full wordings byte for byte", () => {
    const none = resolveEffectiveStatus(null, [provider({ status: "NOT_STARTED" })]);
    const credited = resolveEffectiveStatus(null, [provider()]);
    const org = resolveEffectiveStatus(null, [organization("FULFILLED")]);
    expect(describeInheritedStatusChange("A.8.24", none, credited)).toBe('A.8.24 is now Fulfilled, inherited from Provider "Landing Zone"');
    expect(describeInheritedStatusChange("A.8.24", credited, none)).toBe('A.8.24 is no longer inherited from Provider "Landing Zone" (now Not Started)');
    expect(describeInheritedStatusChange("A.5.15", none, org)).toBe("A.5.15 is now Fulfilled, inherited from the Organization");
    expect(describeInheritedStatusChange("A.5.15", org, none)).toBe("A.5.15 is no longer inherited from the Organization (now Not Started)");
  });

  it("takes effective statuses with no `sources` too (a bare status and source)", () => {
    expect(describeInheritedStatusChange("A.1", { status: "NOT_STARTED", source: { kind: "SYSTEM" } }, { status: "FULFILLED", source: { kind: "SYSTEM" } })).toBe("A.1 is now Fulfilled");
  });
});

describe("the own-edit event effect", () => {
  it("is nothing when the stored status says it all", () => {
    expect(describeOwnEditEffect("IN_PROGRESS", resolveEffectiveStatus(person("IN_PROGRESS"), [shared()]))).toBeNull();
    expect(describeOwnEditEffect("FULFILLED", resolveEffectiveStatus(person("FULFILLED"), []))).toBeNull();
    expect(describeOwnEditEffect("FULFILLED", resolveEffectiveStatus(person("FULFILLED"), [provider()]))).toBeNull();
    expect(describeOwnEditEffect("WAIVED", resolveEffectiveStatus(person("WAIVED"), [shared()]))).toBeNull();
  });

  it("says the Control is held at In Progress when the Provider's half is missing", () => {
    expect(describeOwnEditEffect("FULFILLED", resolveEffectiveStatus(person("FULFILLED"), [shared({ providerOnboarded: false })]))).toBe(
      'now In Progress: waiting for Provider "Landing Zone" to provide its half',
    );
  });

  it("says the Control is Fulfilled through the Shared source when the Provider's half is done", () => {
    expect(describeOwnEditEffect("FULFILLED", resolveEffectiveStatus(person("FULFILLED"), [shared()]))).toBe(
      'now Fulfilled, inherited from Provider "Landing Zone" (Shared)',
    );
  });

  it("is the wording of describeEffectiveStatusNow, which a reset also uses", () => {
    const held = resolveEffectiveStatus(person("FULFILLED"), [shared({ status: "NOT_STARTED" })]);
    expect(describeOwnEditEffect("FULFILLED", held)).toBe(describeEffectiveStatusNow(held));
  });
});

describe("sources of a Both Control with Shared Offerings", () => {
  it("lists the Organization first and judges it as a Full source", () => {
    const sources = inheritanceSourcesFor({ applicability: "BOTH" }, "FULFILLED", [shared()]);
    expect(resolveEffectiveStatus(nobody("NOT_STARTED"), sources).status).toBe("FULFILLED");
    expect(resolveEffectiveStatus(person("FULFILLED"), inheritanceSourcesFor({ applicability: "BOTH" }, "NOT_STARTED", [shared()])).status).toBe("FULFILLED");
    expect(resolveEffectiveStatus(person("FULFILLED"), inheritanceSourcesFor({ applicability: "BOTH" }, "NOT_STARTED", [shared({ status: "NOT_STARTED" })])).status).toBe(
      PROVIDER_HALF_MISSING_STATUS,
    );
  });
});

describe("the reset refusal message (D2)", () => {
  it("still says there is no inheritance source, and now names what counts", () => {
    expect(resetToInheritedRefusalMessage("NO_SOURCE")).toMatch(/no inheritance source/);
    expect(resetToInheritedRefusalMessage("NO_SOURCE")).toMatch(/Full Provider Offering/);
  });
});
