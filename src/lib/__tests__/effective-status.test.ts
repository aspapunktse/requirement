import { describe, expect, it } from "vitest";
import type { ControlAssessmentStatus } from "@prisma/client";
import {
  describeEffectiveStatusNow,
  describeInheritedStatusChange,
  describeOrganizationImplementationChange,
  effectiveOverrideNote,
  effectiveSourceDetails,
  effectiveSourceLabel,
  INHERITED_SOURCE_STATUSES,
  inheritanceSourcesFor,
  isInheritanceSource,
  parseOrganizationImplementationChange,
  resolveEffectiveStatus,
  resetToInheritedRefusal,
  resetToInheritedRefusalMessage,
  resolveImplementedByOrganization,
  sourceGivesCredit,
  type InheritanceSource,
  type OwnAssessment,
} from "../effective-status";
import { isEffectivelyFulfilled } from "../requirement-status-rules";

/** Pure effective-status rules (F-IN.5, #121): no database. */

const STATUSES: ControlAssessmentStatus[] = ["NOT_STARTED", "IN_PROGRESS", "FULFILLED", "WAIVED", "NOT_APPLICABLE"];
const organization = (status: ControlAssessmentStatus): InheritanceSource => ({ kind: "ORGANIZATION", type: "FULL", status });

describe("which source statuses give credit", () => {
  it("is Fulfilled and nothing else (product-owner decision on #121)", () => {
    expect(INHERITED_SOURCE_STATUSES).toEqual(["FULFILLED"]);
    expect(STATUSES.filter(sourceGivesCredit)).toEqual(["FULFILLED"]);
  });
});

describe("resolveEffectiveStatus", () => {
  describe("an own Assessment nobody set (untouched, or none at all)", () => {
    const owns: [string, OwnAssessment][] = [
      ["no row", null],
      ...STATUSES.map((status): [string, OwnAssessment] => [`${status}`, { status, personSet: false }]),
    ];

    it.each(owns)("with own %s: a Fulfilled Organization makes it Fulfilled, decided by the Organization", (_label, own) => {
      const result = resolveEffectiveStatus(own, [organization("FULFILLED")]);
      expect(result.status).toBe("FULFILLED");
      expect(result.source).toEqual({ kind: "ORGANIZATION", type: "FULL", status: "FULFILLED" });
      expect(result.sources).toEqual([{ ...organization("FULFILLED"), givesCredit: true }]);
      expect(result.overridesInherited).toBe(false);
    });

    it.each(owns)("with own %s: no source at all leaves the own status", (_label, own) => {
      const result = resolveEffectiveStatus(own, []);
      expect(result.status).toBe(own?.status ?? "NOT_STARTED");
      expect(result.source).toEqual({ kind: "SYSTEM" });
      expect(result.sources).toEqual([]);
    });

    it.each(STATUSES.filter((status) => status !== "FULFILLED"))(
      "a %s Organization gives no credit: the own status stands, and the source is still listed",
      (organizationStatus) => {
        for (const [, own] of owns) {
          const result = resolveEffectiveStatus(own, [organization(organizationStatus)]);
          expect(result.status).toBe(own?.status ?? "NOT_STARTED");
          expect(result.source).toEqual({ kind: "SYSTEM" });
          expect(result.sources).toEqual([{ ...organization(organizationStatus), givesCredit: false }]);
          expect(result.overridesInherited).toBe(false);
        }
      },
    );
  });

  describe("an own Assessment a person set", () => {
    it.each(STATUSES)("own %s is never overridden, whatever the Organization says", (status) => {
      for (const organizationStatus of STATUSES) {
        const result = resolveEffectiveStatus({ status, personSet: true }, [organization(organizationStatus)]);
        expect(result.status).toBe(status);
        expect(result.source).toEqual({ kind: "SYSTEM" });
        expect(result.sources).toHaveLength(1);
      }
    });

    it("says it overrides a Fulfilled Organization when it is not itself Fulfilled", () => {
      for (const status of STATUSES) {
        const result = resolveEffectiveStatus({ status, personSet: true }, [organization("FULFILLED")]);
        expect(result.overridesInherited).toBe(status !== "FULFILLED");
      }
    });

    it("overrides nothing when the Organization gives no credit or there is no source", () => {
      expect(resolveEffectiveStatus({ status: "NOT_STARTED", personSet: true }, [organization("WAIVED")]).overridesInherited).toBe(false);
      expect(resolveEffectiveStatus({ status: "NOT_STARTED", personSet: true }, []).overridesInherited).toBe(false);
    });
  });

  it("an Assessment Fulfilled but not person-set stays Fulfilled when the Organization drops back", () => {
    const own: OwnAssessment = { status: "FULFILLED", personSet: false };
    expect(resolveEffectiveStatus(own, [organization("NOT_STARTED")]).status).toBe("FULFILLED");
  });
});

describe("inheritanceSourcesFor", () => {
  it("gives a Both Control an Organization source, Not Started while the Organization has recorded nothing", () => {
    expect(inheritanceSourcesFor({ applicability: "BOTH" }, undefined)).toEqual([organization("NOT_STARTED")]);
    expect(inheritanceSourcesFor({ applicability: "BOTH" }, "FULFILLED")).toEqual([organization("FULFILLED")]);
  });

  it("gives a Per-System Control no source, and an Organizational one none either (it is implemented, not inherited, #122)", () => {
    expect(inheritanceSourcesFor({ applicability: "PER_SYSTEM" }, "FULFILLED")).toEqual([]);
    expect(inheritanceSourcesFor({ applicability: "ORGANIZATIONAL" }, "FULFILLED")).toEqual([]);
  });
});

describe("the wording", () => {
  it("names the source and lists every source with its own status", () => {
    const inherited = resolveEffectiveStatus(null, [organization("FULFILLED")]);
    expect(effectiveSourceLabel(inherited)).toBe("Inherited from Organization");
    expect(effectiveSourceDetails(inherited)).toEqual(["Organization: Fulfilled"]);

    const waived = resolveEffectiveStatus(null, [organization("WAIVED")]);
    expect(effectiveSourceLabel(waived)).toBe("System-specific");
    expect(effectiveSourceDetails(waived)).toEqual(["Organization: Waived (gives no credit)"]);

    expect(effectiveSourceLabel(resolveEffectiveStatus(null, []))).toBe("System-specific");
    expect(effectiveSourceDetails(resolveEffectiveStatus(null, []))).toEqual([]);
  });

  it("says so in one line when the System's own person-set Assessment overrides a Fulfilled Organization", () => {
    const overriding = resolveEffectiveStatus({ status: "IN_PROGRESS", personSet: true }, [organization("FULFILLED")]);
    expect(effectiveOverrideNote(overriding)).toBe("This System's own Assessment (In Progress) overrides the Organization's Fulfilled status.");
    expect(effectiveOverrideNote(resolveEffectiveStatus(null, [organization("FULFILLED")]))).toBeNull();
  });

  it("words the Change Event for gaining and losing credit, and has none when the status stays", () => {
    const untouched = (organizationStatus: ControlAssessmentStatus) => resolveEffectiveStatus(null, [organization(organizationStatus)]);
    expect(describeInheritedStatusChange("A.5.15", untouched("NOT_STARTED"), untouched("FULFILLED"))).toBe(
      "A.5.15 is now Fulfilled, inherited from the Organization",
    );
    expect(describeInheritedStatusChange("A.5.15", untouched("FULFILLED"), untouched("WAIVED"))).toBe(
      "A.5.15 is no longer inherited from the Organization (now Not Started)",
    );
    expect(describeInheritedStatusChange("A.5.15", untouched("NOT_STARTED"), untouched("WAIVED"))).toBeNull();
    const own = { status: "WAIVED", personSet: true } as const;
    expect(
      describeInheritedStatusChange(
        "A.5.15",
        resolveEffectiveStatus(own, [organization("NOT_STARTED")]),
        resolveEffectiveStatus(own, [organization("FULFILLED")]),
      ),
    ).toBeNull();
  });
});

describe("resolveImplementedByOrganization (an Organizational Control, #122)", () => {
  it("is the Organization's status as it is, Not Started while nothing is recorded", () => {
    expect(resolveImplementedByOrganization(undefined).status).toBe("NOT_STARTED");
    for (const status of STATUSES) expect(resolveImplementedByOrganization(status).status).toBe(status);
  });

  it("has no per-System Assessment to override, so nothing is inherited over and no source is listed", () => {
    const result = resolveImplementedByOrganization("FULFILLED");
    expect(result.source).toEqual({ kind: "ORGANIZATION_DIRECT" });
    expect(isInheritanceSource(result.source)).toBe(false);
    expect(result.sources).toEqual([]);
    expect(result.overridesInherited).toBe(false);
    expect(effectiveSourceLabel(result)).toBe("Implemented by the Organization");
    expect(effectiveSourceDetails(result)).toEqual([]);
    expect(effectiveOverrideNote(result)).toBeNull();
  });

  it("is judged like any Assessment status: Waived and Not Applicable count except on a strict Framework (product-owner decision on #122)", () => {
    for (const status of ["WAIVED", "NOT_APPLICABLE"] as const) {
      expect(isEffectivelyFulfilled(resolveImplementedByOrganization(status).status, { strictComplianceRequired: false })).toBe(true);
      expect(isEffectivelyFulfilled(resolveImplementedByOrganization(status).status, { strictComplianceRequired: true })).toBe(false);
    }
    // ...which the Both rule deliberately does not do: a Waived Organization gives a Both Control no credit.
    expect(resolveEffectiveStatus(null, [organization("WAIVED")]).status).toBe("NOT_STARTED");
    for (const status of ["NOT_STARTED", "IN_PROGRESS"] as const) {
      expect(isEffectivelyFulfilled(resolveImplementedByOrganization(status).status, { strictComplianceRequired: false })).toBe(false);
    }
    expect(isEffectivelyFulfilled(resolveImplementedByOrganization("FULFILLED").status, { strictComplianceRequired: true })).toBe(true);
  });
});

describe("describeOrganizationImplementationChange (the System-less Change Event, #122)", () => {
  it("says what changed to what, and is null when the status did not change", () => {
    expect(describeOrganizationImplementationChange("A.5.1", "NOT_STARTED", "FULFILLED")).toBe(
      "A.5.1 Organization Control Implementation changed from Not Started to Fulfilled",
    );
    expect(describeOrganizationImplementationChange("A.5.1", "FULFILLED", "NOT_APPLICABLE")).toBe(
      "A.5.1 Organization Control Implementation changed from Fulfilled to Not Applicable",
    );
    for (const status of STATUSES) expect(describeOrganizationImplementationChange("A.5.1", status, status)).toBeNull();
  });

  it("is read back by parseOrganizationImplementationChange for every pair of statuses (the page's history, #284)", () => {
    for (const before of STATUSES) {
      for (const after of STATUSES) {
        if (before === after) continue;
        const detail = describeOrganizationImplementationChange("A.5.1", before, after)!;
        expect(parseOrganizationImplementationChange(detail)).toEqual({ controlCode: "A.5.1", before, after });
      }
    }
  });

  it("reads the code up to the marker, so a code with spaces or dashes survives", () => {
    const detail = describeOrganizationImplementationChange("CCM IAM-01 (x)", "WAIVED", "FULFILLED")!;
    expect(parseOrganizationImplementationChange(detail)?.controlCode).toBe("CCM IAM-01 (x)");
  });

  it("reads nothing from any other detail", () => {
    for (const detail of [
      "",
      "A.5.1 is now Fulfilled",
      " Organization Control Implementation changed from Fulfilled to Waived",
      "A.5.1 Organization Control Implementation changed from Fulfilled to Whatever",
      "A.5.1 Organization Control Implementation changed from Fulfilled",
      "A.5.1 Organization Control Implementation changed from Fulfilled to Waived and more text",
    ]) {
      expect(parseOrganizationImplementationChange(detail)).toBeNull();
    }
  });
});

describe("what the readers do with the effective status", () => {
  it("judges Waived and Not Applicable by the Framework, and inherited Fulfilled like any Fulfilled", () => {
    const inherited = resolveEffectiveStatus(null, [organization("FULFILLED")]).status;
    expect(isEffectivelyFulfilled(inherited, { strictComplianceRequired: true })).toBe(true);
    expect(isEffectivelyFulfilled("WAIVED", { strictComplianceRequired: true })).toBe(false);
    expect(isEffectivelyFulfilled("WAIVED", { strictComplianceRequired: false })).toBe(true);
  });
});

describe("resetToInheritedRefusal (#129)", () => {
  const person = (status: ControlAssessmentStatus): OwnAssessment => ({ status, personSet: true });
  const nobody = (status: ControlAssessmentStatus): OwnAssessment => ({ status, personSet: false });

  it.each(STATUSES)("allows resetting a person-set %s Assessment of a Control with a source, whatever the source's status", (status) => {
    for (const sourceStatus of STATUSES) {
      expect(resetToInheritedRefusal({ applies: true, sources: [organization(sourceStatus)], own: person(status) })).toBeNull();
    }
  });

  it.each(STATUSES)("refuses an Assessment nobody set (%s): it already follows its sources", (status) => {
    expect(resetToInheritedRefusal({ applies: true, sources: [organization("FULFILLED")], own: nobody(status) })).toBe("NOT_PERSON_SET");
  });

  it("refuses when there is no row at all", () => {
    expect(resetToInheritedRefusal({ applies: true, sources: [organization("FULFILLED")], own: null })).toBe("NOT_PERSON_SET");
  });

  it.each(STATUSES)("refuses a person-set %s Assessment of a Control with no source (a Per-System Control)", (status) => {
    expect(resetToInheritedRefusal({ applies: true, sources: [], own: person(status) })).toBe("NO_SOURCE");
  });

  it("refuses a stale row first: the Control no longer applies", () => {
    expect(resetToInheritedRefusal({ applies: false, sources: [organization("FULFILLED")], own: person("FULFILLED") })).toBe("NOT_APPLICABLE");
    expect(resetToInheritedRefusal({ applies: false, sources: [], own: null })).toBe("NOT_APPLICABLE");
  });

  it("checks the source before the Assessment", () => {
    expect(resetToInheritedRefusal({ applies: true, sources: [], own: null })).toBe("NO_SOURCE");
  });

  it("goes by the sources `inheritanceSourcesFor` gives, never by the Control's applicability itself", () => {
    const own = person("IN_PROGRESS");
    const refusal = (applicability: "BOTH" | "PER_SYSTEM" | "ORGANIZATIONAL") =>
      resetToInheritedRefusal({ applies: true, sources: inheritanceSourcesFor({ applicability }, "NOT_STARTED"), own });
    expect(refusal("BOTH")).toBeNull();
    expect(refusal("PER_SYSTEM")).toBe("NO_SOURCE");
    expect(refusal("ORGANIZATIONAL")).toBe("NO_SOURCE");
  });

  it("has a message for every refusal", () => {
    expect(resetToInheritedRefusalMessage("NOT_APPLICABLE")).toMatch(/no longer applies/);
    expect(resetToInheritedRefusalMessage("NO_SOURCE")).toMatch(/no inheritance source/);
    expect(resetToInheritedRefusalMessage("NOT_PERSON_SET")).toMatch(/not set by a person/);
  });

  it("returns the Control to what the sources give: a reset Assessment resolves as an untouched one", () => {
    const sources = [organization("FULFILLED")];
    expect(resolveEffectiveStatus(person("IN_PROGRESS"), sources).status).toBe("IN_PROGRESS");
    const after = resolveEffectiveStatus(nobody("NOT_STARTED"), sources);
    expect(after).toMatchObject({ status: "FULFILLED", source: { kind: "ORGANIZATION" } });
    expect(describeEffectiveStatusNow(after)).toBe("now Fulfilled, inherited from the Organization");
  });
});

describe("describeEffectiveStatusNow", () => {
  it("names the source only when the status is inherited", () => {
    expect(describeEffectiveStatusNow({ status: "FULFILLED", source: { kind: "ORGANIZATION", type: "FULL", status: "FULFILLED" } })).toBe(
      "now Fulfilled, inherited from the Organization",
    );
    expect(describeEffectiveStatusNow({ status: "NOT_STARTED", source: { kind: "SYSTEM" } })).toBe("now Not Started");
    expect(describeEffectiveStatusNow({ status: "IN_PROGRESS", source: { kind: "ORGANIZATION_DIRECT" } })).toBe("now In Progress");
  });
});
