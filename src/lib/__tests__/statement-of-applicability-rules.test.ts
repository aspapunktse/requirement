import { describe, expect, it } from "vitest";
import type { ControlApplicability, ControlAssessmentStatus } from "@prisma/client";
import type { ProviderSource } from "@/lib/effective-status";
import {
  controlAppliesToOrganization,
  countByInclusion,
  countJustificationsMissing,
  exclusionJustificationWriteRefusal,
  normalizeExclusionJustification,
  deriveStatementOfApplicability,
  describeRollup,
  inclusionJustification,
  type SoaControl,
  type SoaMapping,
  type SoaSystem,
} from "../statement-of-applicability-rules";

/** Pure rules of the Statement of Applicability (#145): no database. */

const ISO = { id: "f-iso", name: "ISO/IEC 27001", version: "2022", status: "PUBLISHED", isBase: true };
const CSL = { id: "f-csl", name: "Cybersäkerhetslagen", version: "2025", status: "PUBLISHED", isBase: false };
const DRAFT = { id: "f-draft", name: "Secret Draft Law", version: "1", status: "DRAFT", isBase: false };

const mapping = (framework: SoaMapping["requirement"]["framework"], code: string): SoaMapping => ({
  requirement: { code, framework },
});

function control(
  id: string,
  applicability: ControlApplicability,
  mappings: SoaMapping[],
  extra: Partial<SoaControl> = {},
): SoaControl {
  return {
    id,
    code: id,
    title: `Title ${id}`,
    applicability,
    deploymentFacets: [],
    minConfidentialityImpactLevel: null,
    minIntegrityImpactLevel: null,
    minAvailabilityImpactLevel: null,
    mappings,
    soaExclusionJustification: null,
    ...extra,
  };
}

const system = (id: string, extra: Partial<SoaSystem> = {}): SoaSystem => ({
  id,
  deploymentFacets: [],
  frameworkScopes: [],
  confidentialityImpactLevel: null,
  integrityImpactLevel: null,
  availabilityImpactLevel: null,
  ...extra,
});

const noInputs = {
  systems: [] as SoaSystem[],
  organizationStatusByControlId: new Map<string, ControlAssessmentStatus>(),
  ownAssessmentsBySystemId: new Map(),
  providerSourcesBySystemId: new Map(),
};

describe("inclusionJustification", () => {
  it("lists Requirement codes per Framework after one label, in a deterministic order", () => {
    const text = inclusionJustification([
      mapping(CSL, "3 kap. 2 §"),
      mapping(ISO, "A.8.24"),
      mapping(ISO, "A.8.4"),
      mapping(ISO, "A.8.24"),
    ]);
    expect(text).toBe("Cybersäkerhetslagen:2025 3 kap. 2 §; ISO/IEC 27001:2022 A.8.4, A.8.24");
  });

  it("leaves a Draft Framework's mapping out", () => {
    expect(inclusionJustification([mapping(ISO, "A.5.1"), mapping(DRAFT, "D-1")])).toBe("ISO/IEC 27001:2022 A.5.1");
    expect(inclusionJustification([mapping(DRAFT, "D-1")])).toBe("");
  });
});

describe("controlAppliesToOrganization", () => {
  it("is false for a Per-System Control", () => {
    expect(controlAppliesToOrganization(control("c", "PER_SYSTEM", [mapping(ISO, "A.1")]))).toBe(false);
  });

  it("needs a Published mapping for an Organizational or Both Control (the recommended default)", () => {
    expect(controlAppliesToOrganization(control("c", "ORGANIZATIONAL", [mapping(ISO, "A.1")]))).toBe(true);
    expect(controlAppliesToOrganization(control("c", "BOTH", [mapping(CSL, "1")]))).toBe(true);
    expect(controlAppliesToOrganization(control("c", "ORGANIZATIONAL", []))).toBe(false);
    expect(controlAppliesToOrganization(control("c", "BOTH", [mapping(DRAFT, "D-1")]))).toBe(false);
  });
});

describe("deriveStatementOfApplicability", () => {
  it("returns one row per Control exactly once, ordered by code", () => {
    const rows = deriveStatementOfApplicability({
      ...noInputs,
      controls: [
        control("A.5.10", "ORGANIZATIONAL", [mapping(ISO, "A.5.10")]),
        control("A.5.2", "ORGANIZATIONAL", [mapping(ISO, "A.5.2")]),
        control("A.5.1", "PER_SYSTEM", []),
      ],
    });
    expect(rows.map((r) => r.code)).toEqual(["A.5.1", "A.5.2", "A.5.10"]);
    expect(new Set(rows.map((r) => r.controlId)).size).toBe(3);
  });

  it("excludes a Per-System Control no System needs, flagged justification missing, with no status", () => {
    const [row] = deriveStatementOfApplicability({ ...noInputs, controls: [control("c", "PER_SYSTEM", [mapping(ISO, "A.1")])] });
    expect(row).toMatchObject({
      included: false,
      inclusionJustification: "",
      exclusionJustification: null,
      justificationMissing: true,
      organizationStatus: null,
      systemRollup: null,
    });
  });

  it("includes the same Per-System Control as soon as a System it applies to exists (nothing stored)", () => {
    const c = control("c", "PER_SYSTEM", [mapping(ISO, "A.1")]);
    const [row] = deriveStatementOfApplicability({ ...noInputs, controls: [c], systems: [system("s1")] });
    expect(row.included).toBe(true);
    expect(row.justificationMissing).toBe(false);
    expect(row.inclusionJustification).toBe("ISO/IEC 27001:2022 A.1");
    expect(row.systemRollup?.total).toBe(1);
    expect(row.systemRollup?.counts.NOT_STARTED).toBe(1);
  });

  it("does not let a Draft mapping include a Control or appear in the justification", () => {
    const rows = deriveStatementOfApplicability({
      ...noInputs,
      controls: [control("o", "ORGANIZATIONAL", [mapping(DRAFT, "D-1")]), control("p", "PER_SYSTEM", [mapping(DRAFT, "D-1")])],
      systems: [system("s1", { frameworkScopes: [{ id: DRAFT.id }] })],
    });
    expect(rows.map((r) => r.included)).toEqual([false, false]);
    expect(JSON.stringify(rows)).not.toContain("Secret Draft Law");
  });

  it("respects Framework Scope: a non-base mapping includes the Control only for a System that declares it", () => {
    const c = control("c", "PER_SYSTEM", [mapping(CSL, "1")]);
    expect(deriveStatementOfApplicability({ ...noInputs, controls: [c], systems: [system("s1")] })[0].included).toBe(false);
    expect(
      deriveStatementOfApplicability({ ...noInputs, controls: [c], systems: [system("s1", { frameworkScopes: [{ id: CSL.id }] })] })[0]
        .included,
    ).toBe(true);
  });

  it("shows an Organizational Control's Organization status, Not Started when it has no row, and no rollup", () => {
    const rows = deriveStatementOfApplicability({
      ...noInputs,
      controls: [control("a", "ORGANIZATIONAL", [mapping(ISO, "A.1")]), control("b", "ORGANIZATIONAL", [mapping(ISO, "A.2")])],
      organizationStatusByControlId: new Map([["a", "FULFILLED" as const]]),
      systems: [system("s1")],
    });
    expect(rows[0]).toMatchObject({ organizationStatus: "FULFILLED", systemRollup: null, appliesToSystemCount: 0 });
    expect(rows[1]).toMatchObject({ organizationStatus: "NOT_STARTED", systemRollup: null });
  });

  it("rolls a Per-System Control up by effective status, counting inheritance from a Provider", () => {
    const c = control("c", "PER_SYSTEM", [mapping(ISO, "A.1")]);
    const provider: ProviderSource = {
      kind: "PROVIDER",
      type: "FULL",
      status: "FULFILLED",
      provider: { id: "p", name: "Landing Zone" },
      providerOnboarded: true,
      appliesToProvider: true,
      customerResponsibility: null,
    };
    const [row] = deriveStatementOfApplicability({
      ...noInputs,
      controls: [c],
      systems: [system("s1"), system("s2"), system("s3")],
      ownAssessmentsBySystemId: new Map([["s2", new Map([["c", { status: "IN_PROGRESS" as const, personSet: true }]])]]),
      providerSourcesBySystemId: new Map([["s1", new Map([["c", [provider]]])]]),
    });
    expect(row.organizationStatus).toBeNull();
    expect(row.systemRollup).toEqual({
      total: 3,
      counts: { NOT_STARTED: 1, IN_PROGRESS: 1, FULFILLED: 1, NOT_APPLICABLE: 0, WAIVED: 0 },
    });
  });

  it("shows a Both Control's Organization status and its rollup, inheriting the Organization's Fulfilled", () => {
    const [row] = deriveStatementOfApplicability({
      ...noInputs,
      controls: [control("c", "BOTH", [mapping(ISO, "A.1")])],
      systems: [system("s1"), system("s2")],
      organizationStatusByControlId: new Map([["c", "FULFILLED" as const]]),
      ownAssessmentsBySystemId: new Map([["s2", new Map([["c", { status: "NOT_APPLICABLE" as const, personSet: true }]])]]),
    });
    expect(row.organizationStatus).toBe("FULFILLED");
    expect(row.systemRollup?.counts).toMatchObject({ FULFILLED: 1, NOT_APPLICABLE: 1, NOT_STARTED: 0 });
  });

  it("excludes an Organizational Control mapped to no Published Framework (flagged default rule)", () => {
    const [row] = deriveStatementOfApplicability({ ...noInputs, controls: [control("c", "ORGANIZATIONAL", [])] });
    expect(row).toMatchObject({ included: false, appliesToOrganization: false, justificationMissing: true });
  });
});

describe("countByInclusion and describeRollup", () => {
  it("counts all, included and excluded", () => {
    expect(countByInclusion([{ included: true }, { included: false }, { included: true }])).toEqual({
      all: 3,
      included: 2,
      excluded: 1,
    });
  });

  it("describes a rollup without zero counts", () => {
    expect(
      describeRollup({ total: 3, counts: { NOT_STARTED: 1, IN_PROGRESS: 0, FULFILLED: 2, NOT_APPLICABLE: 0, WAIVED: 0 } }),
    ).toBe("1 Not Started, 2 Fulfilled");
    expect(
      describeRollup({ total: 0, counts: { NOT_STARTED: 0, IN_PROGRESS: 0, FULFILLED: 0, NOT_APPLICABLE: 0, WAIVED: 0 } }),
    ).toBe("No Systems");
  });
});

describe("exclusion justification (#150)", () => {
  const perSystem = (justification: string | null) =>
    control("c", "PER_SYSTEM", [mapping(ISO, "A.1")], { soaExclusionJustification: justification });

  it("shows the stored text of an excluded Control and does not flag it missing", () => {
    const [row] = deriveStatementOfApplicability({ ...noInputs, controls: [perSystem("  Out of scope: no software development  ")] });
    expect(row).toMatchObject({ included: false, exclusionJustification: "Out of scope: no software development", justificationMissing: false });
  });

  it("flags an excluded Control whose stored text is null or blank", () => {
    for (const stored of [null, "", "   "]) {
      const [row] = deriveStatementOfApplicability({ ...noInputs, controls: [perSystem(stored)] });
      expect(row).toMatchObject({ exclusionJustification: null, justificationMissing: true });
    }
  });

  it("keeps the text when the Control becomes included, does not present it as the reason, and shows it again when excluded again", () => {
    const c = perSystem("Kept reason");
    const excluded = () => deriveStatementOfApplicability({ ...noInputs, controls: [c] })[0];
    const included = deriveStatementOfApplicability({ ...noInputs, controls: [c], systems: [system("s1")] })[0];

    expect(excluded().exclusionJustification).toBe("Kept reason");
    expect(included).toMatchObject({ included: true, exclusionJustification: null, justificationMissing: false });
    expect(included.inclusionJustification).toBe("ISO/IEC 27001:2022 A.1");
    // The System is gone again: the same stored text is back.
    expect(excluded()).toMatchObject({ included: false, exclusionJustification: "Kept reason", justificationMissing: false });
  });

  it("counts the excluded Controls with a justification missing, and the count drops when one is written", () => {
    const controls = (written: string | null) => [
      control("a", "PER_SYSTEM", [], { soaExclusionJustification: written }),
      control("b", "PER_SYSTEM", [], { soaExclusionJustification: "Has one" }),
      control("c", "ORGANIZATIONAL", [mapping(ISO, "A.2")]),
    ];
    expect(countJustificationsMissing(deriveStatementOfApplicability({ ...noInputs, controls: controls(null) }))).toBe(1);
    expect(countJustificationsMissing(deriveStatementOfApplicability({ ...noInputs, controls: controls("Now written") }))).toBe(0);
  });

  it("normalizes: trims, and blank or null means cleared", () => {
    expect(normalizeExclusionJustification("  x  ")).toBe("x");
    expect(normalizeExclusionJustification("   ")).toBeNull();
    expect(normalizeExclusionJustification("")).toBeNull();
    expect(normalizeExclusionJustification(null)).toBeNull();
  });

  it("refuses to write text for an included Control but allows clearing it and writing for an excluded one", () => {
    expect(exclusionJustificationWriteRefusal(true, "text")).toMatch(/included/);
    expect(exclusionJustificationWriteRefusal(true, null)).toBeNull();
    expect(exclusionJustificationWriteRefusal(false, "text")).toBeNull();
    expect(exclusionJustificationWriteRefusal(false, null)).toBeNull();
  });
});
