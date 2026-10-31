import { describe, expect, it } from "vitest";
import type { StatementOfApplicabilityRow } from "../statement-of-applicability-rules";
import { buildAuditCover, frameworksBehind } from "../soa-audit-export";

const row = (over: Partial<StatementOfApplicabilityRow>): StatementOfApplicabilityRow => ({
  controlId: "c",
  code: "C-1",
  title: "Test Control",
  applicability: "PER_SYSTEM",
  included: true,
  appliesToOrganization: false,
  appliesToSystemCount: 1,
  inclusionJustification: "",
  exclusionJustification: null,
  justificationMissing: false,
  organizationStatus: null,
  systemRollup: null,
  ...over,
});

const fw = (id: string, name: string, version: string, status: string, isBase = false) => ({ id, name, version, status, isBase });
const control = (...frameworks: ReturnType<typeof fw>[]) => ({ mappings: frameworks.map((framework) => ({ requirement: { framework } })) });

describe("buildAuditCover (#273)", () => {
  const args = { frameworks: ["A:1"], generatedAt: new Date("2026-10-31T14:05:00Z"), generatedByName: "Test User" };

  it("counts included, excluded and excluded without a justification", () => {
    const cover = buildAuditCover({
      ...args,
      organizationName: "Acme AB",
      rows: [
        row({}),
        row({}),
        row({ included: false, exclusionJustification: "Out of scope" }),
        row({ included: false, justificationMissing: true }),
        row({ included: false, justificationMissing: true }),
      ],
    });
    expect(cover).toMatchObject({
      organizationName: "Acme AB",
      generatedAt: "2026-10-31T14:05:00.000Z",
      generatedByName: "Test User",
      frameworks: ["A:1"],
      total: 5,
      included: 2,
      excluded: 3,
      excludedWithoutJustification: 2,
    });
  });

  it("leaves the Organization out while the name is unset or blank, and counts an empty Statement as zeros", () => {
    expect(buildAuditCover({ ...args, rows: [], organizationName: null }).organizationName).toBeNull();
    expect(buildAuditCover({ ...args, rows: [], organizationName: "  " }).organizationName).toBeNull();
    expect(buildAuditCover({ ...args, rows: [], organizationName: null })).toMatchObject({ total: 0, included: 0, excluded: 0, excludedWithoutJustification: 0 });
  });
});

describe("frameworksBehind (#273)", () => {
  it("lists each Published Framework once with its version, the base first, and never a Draft", () => {
    const base = fw("b", "ISO/IEC 27001", "2022", "PUBLISHED", true);
    const nis = fw("n", "NIS2", "2022", "PUBLISHED");
    const draft = fw("d", "Secret Draft", "1", "DRAFT");
    expect(frameworksBehind([control(nis, draft), control(base, nis), control()])).toEqual(["ISO/IEC 27001:2022", "NIS2:2022"]);
  });

  it("is empty when no Control maps to a Published Framework", () => {
    expect(frameworksBehind([control(fw("d", "Draft", "1", "DRAFT")), control()])).toEqual([]);
    expect(frameworksBehind([])).toEqual([]);
  });
});
