import { describe, expect, it } from "vitest";
import { appendNote } from "@/lib/check-up-nonconformity";
import { nonconformityRiskText, RISK_COMMENT_COPY_LIMIT, setBackNote, setBackSentence } from "@/lib/check-up-nonconformity-rules";
import { canManageOrganizationRisks, canReadOrganizationRisks, riskHref } from "@/lib/risks";

describe("Nonconformity wording and rules (#157)", () => {
  const control = { code: "A.5.1", title: "Policies" };

  it("words the Risk from the audit, the Control, the target and the comment, and caps the comment", () => {
    const system = nonconformityRiskText({ auditTitle: "Q4", control, systemName: "Payroll", comment: "short", outcome: { kind: "SET_BACK" }, finding: "/check-ups/c1" });
    expect(system.title).toBe("A.5.1: Policies (Internal Audit Nonconformity)");
    expect(system.description).toContain('Internal Audit "Q4" found a Nonconformity on A.5.1 for System "Payroll" (/check-ups/c1).');
    expect(system.description).toContain("Auditor's comment: short");
    expect(system.description).toContain("set back to In Progress");

    const organization = nonconformityRiskText({
      auditTitle: "Q4",
      control,
      systemName: null,
      comment: "y".repeat(RISK_COMMENT_COPY_LIMIT + 50),
      outcome: { kind: "NOT_FULFILLED", status: "WAIVED" },
      finding: "/check-ups/c2",
    });
    expect(organization.description).toContain("for the Organization");
    expect(organization.description).toContain("y".repeat(RISK_COMMENT_COPY_LIMIT) + "…");
    expect(organization.description).not.toContain("y".repeat(RISK_COMMENT_COPY_LIMIT + 1));
    expect(organization.description).toContain("Not changed: the Organization's stored status is Waived, not Fulfilled.");
  });

  it("says that an inherited Fulfilled status was overridden", () => {
    expect(setBackSentence({ kind: "INHERITED_OVERRIDDEN", status: "NOT_STARTED", source: "Inherited from Organization" }, "System")).toBe(
      "This System's Fulfilled status was inherited (Inherited from Organization; its own status was Not Started). It has been overridden with an In Progress status of the System's own.",
    );
  });

  it("appends a note to what the owner wrote and never replaces it", () => {
    const note = setBackNote("Q4", "/check-ups/c1");
    expect(note).toContain('"Q4"');
    expect(appendNote(null, note)).toBe(note);
    expect(appendNote("   ", note)).toBe(note);
    expect(appendNote("Owner text", note)).toBe(`Owner text\n\n${note}`);
  });

  it("lets the Risk Owner and Admin manage and the Internal Auditor only read Organization Risks", () => {
    for (const role of ["RISK_OWNER", "ADMIN"] as const) {
      expect(canReadOrganizationRisks({ role })).toBe(true);
      expect(canManageOrganizationRisks({ role })).toBe(true);
    }
    expect(canReadOrganizationRisks({ role: "INTERNAL_AUDITOR" })).toBe(true);
    expect(canManageOrganizationRisks({ role: "INTERNAL_AUDITOR" })).toBe(false);
    for (const role of ["COMPLIANCE_MANAGER", "SYSTEM_OWNER", "REVIEWER", "BUSINESS_RISK_OWNER", "VIEWER"] as const) {
      expect(canReadOrganizationRisks({ role }), role).toBe(false);
      expect(canManageOrganizationRisks({ role }), role).toBe(false);
    }
  });

  it("links a Risk to its System, or to the Organization Risks page when it has none", () => {
    expect(riskHref({ system: { id: "s1" } })).toBe("/systems/s1");
    expect(riskHref({ system: null })).toBe("/risks/organization");
  });
});
