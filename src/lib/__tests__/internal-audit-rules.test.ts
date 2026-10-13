import { describe, expect, it } from "vitest";
import type { InternalAuditStatus, UserRole } from "@prisma/client";
import {
  canReadInternalAudits,
  canWriteInternalAudits,
  dueDateRefusal,
  internalAuditEditRefusal,
  internalAuditNotes,
  validateInternalAudit,
} from "../internal-audit-rules";

const ALL_ROLES: UserRole[] = [
  "ADMIN",
  "COMPLIANCE_MANAGER",
  "SYSTEM_OWNER",
  "RISK_OWNER",
  "REVIEWER",
  "BUSINESS_RISK_OWNER",
  "VIEWER",
  "INTERNAL_AUDITOR",
];

describe("who may write and read Internal Audits (#152)", () => {
  it.each(ALL_ROLES)("%s writes only as an Internal Auditor", (role) => {
    expect(canWriteInternalAudits({ role })).toBe(role === "INTERNAL_AUDITOR");
  });

  it.each(ALL_ROLES)("%s reads?", (role) => {
    const reads = ["INTERNAL_AUDITOR", "ADMIN", "COMPLIANCE_MANAGER", "RISK_OWNER"].includes(role);
    expect(canReadInternalAudits({ role })).toBe(reads);
  });
});

describe("internalAuditEditRefusal", () => {
  it("lets a draft be edited and deleted", () => {
    expect(internalAuditEditRefusal("DRAFT")).toBeNull();
  });

  it.each<InternalAuditStatus>(["LAUNCHED", "CLOSED"])("refuses a %s audit", (status) => {
    expect(internalAuditEditRefusal(status)).toMatch(/draft/i);
  });
});

describe("dueDateRefusal", () => {
  const now = new Date("2026-10-13T23:59:00Z");

  it("accepts today and later, comparing calendar dates in UTC", () => {
    expect(dueDateRefusal("2026-10-13", now)).toBeNull();
    expect(dueDateRefusal("2027-01-01", now)).toBeNull();
  });

  it("refuses a past date", () => {
    expect(dueDateRefusal("2026-10-12", now)).toMatch(/past/i);
  });

  it("refuses something that is not a calendar date", () => {
    expect(dueDateRefusal("tomorrow", now)).toMatch(/date/i);
    expect(dueDateRefusal("2026-02-31", now)).toMatch(/date/i);
    expect(dueDateRefusal("", now)).toMatch(/date/i);
  });
});

describe("validateInternalAudit", () => {
  const valid = { title: "Q4 access review", controlIds: ["c1"], systemIds: ["s1"], includeOrganization: false, dueDate: "2027-01-01" };

  it("accepts a title, a Control, a due date and a System", () => {
    expect(validateInternalAudit(valid)).toEqual([]);
  });

  it("accepts the Organization instead of a System", () => {
    expect(validateInternalAudit({ ...valid, systemIds: [], includeOrganization: true })).toEqual([]);
  });

  it("names each thing that is missing", () => {
    const problems = validateInternalAudit({ title: "  ", controlIds: [], systemIds: [], includeOrganization: false, dueDate: null });
    expect(problems).toEqual([
      "A title is required",
      "Pick at least one Control",
      "A due date is required",
      "Pick at least one System or include the Organization",
    ]);
  });

  it("leaves a past due date to dueDateRefusal, which applies to a new or changed date only", () => {
    expect(validateInternalAudit({ ...valid, dueDate: "2001-01-01" })).toEqual([]);
  });
});

describe("internalAuditNotes", () => {
  it("is silent when every picked half has something to audit", () => {
    expect(internalAuditNotes({ includeOrganization: true, systemCount: 1, controls: [{ applicability: "BOTH" }] })).toEqual([]);
  });

  it("notes an included Organization with no Organizational or Both Control", () => {
    const notes = internalAuditNotes({ includeOrganization: true, systemCount: 1, controls: [{ applicability: "PER_SYSTEM" }] });
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatch(/Organization/);
  });

  it("notes Systems picked with no Per-System or Both Control", () => {
    const notes = internalAuditNotes({ includeOrganization: false, systemCount: 2, controls: [{ applicability: "ORGANIZATIONAL" }] });
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatch(/System/);
  });

  it("says nothing about the Organization when it is not included", () => {
    expect(internalAuditNotes({ includeOrganization: false, systemCount: 0, controls: [{ applicability: "PER_SYSTEM" }] })).toEqual([]);
  });
});
