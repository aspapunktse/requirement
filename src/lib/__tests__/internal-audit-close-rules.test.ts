import { describe, expect, it } from "vitest";
import type { UserRole } from "@prisma/client";
import {
  canCloseInternalAudits,
  closeBlockedMessage,
  describeUnfinishedCheckUp,
  internalAuditCloseRefusal,
  isUnfinishedCheckUp,
  unfinishedCheckUps,
} from "@/lib/internal-audit-close-rules";

const ALL_ROLES: UserRole[] = [
  "ADMIN",
  "COMPLIANCE_MANAGER",
  "RISK_OWNER",
  "SYSTEM_OWNER",
  "REVIEWER",
  "BUSINESS_RISK_OWNER",
  "VIEWER",
  "INTERNAL_AUDITOR",
];

describe("canCloseInternalAudits", () => {
  it("lets only an Internal Auditor close", () => {
    for (const role of ALL_ROLES) expect(canCloseInternalAudits({ role })).toBe(role === "INTERNAL_AUDITOR");
  });
});

describe("internalAuditCloseRefusal", () => {
  it("allows only a launched audit", () => {
    expect(internalAuditCloseRefusal("LAUNCHED")).toBeNull();
    expect(internalAuditCloseRefusal("DRAFT")).toMatch(/draft.*delete/i);
    expect(internalAuditCloseRefusal("CLOSED")).toMatch(/closed already/);
  });
});

describe("unfinished Check-ups", () => {
  it("is unfinished when neither evaluated nor withdrawn (the full matrix)", () => {
    expect(isUnfinishedCheckUp({ evaluated: false, withdrawn: false })).toBe(true);
    expect(isUnfinishedCheckUp({ evaluated: true, withdrawn: false })).toBe(false);
    expect(isUnfinishedCheckUp({ evaluated: false, withdrawn: true })).toBe(false);
    expect(isUnfinishedCheckUp({ evaluated: true, withdrawn: true })).toBe(false);
  });

  const base = { evaluated: false, withdrawn: false };
  const checkUps = [
    { id: "1", controlCode: "A.5.10", systemName: "Payroll", ...base },
    { id: "2", controlCode: "A.5.2", systemName: null, ...base },
    { id: "3", controlCode: "A.5.2", systemName: "Zeta", ...base },
    { id: "4", controlCode: "A.5.2", systemName: "Alpha", ...base },
    { id: "5", controlCode: "A.5.1", systemName: "Payroll", evaluated: true, withdrawn: false },
    { id: "6", controlCode: "A.5.1", systemName: "Billing", evaluated: false, withdrawn: true },
  ];

  it("lists only the unfinished ones, by Control code (numerically), then Systems by name, the Organization last", () => {
    expect(unfinishedCheckUps(checkUps).map((c) => c.id)).toEqual(["4", "3", "2", "1"]);
  });

  it("is empty when every Check-up is evaluated or withdrawn, and for an audit without Check-ups", () => {
    expect(unfinishedCheckUps(checkUps.filter((c) => c.id === "5" || c.id === "6"))).toEqual([]);
    expect(unfinishedCheckUps([])).toEqual([]);
  });

  it("names a Check-up by Control code and its System, or the Organization", () => {
    expect(describeUnfinishedCheckUp({ controlCode: "A.5.1", systemName: "Payroll" })).toBe('A.5.1 for System "Payroll"');
    expect(describeUnfinishedCheckUp({ controlCode: "A.5.1", systemName: null })).toBe("A.5.1 for the Organization");
  });

  it("words the refusal in the singular and the plural", () => {
    expect(closeBlockedMessage(1)).toBe("This Internal Audit can't be closed yet: 1 Check-up is neither evaluated nor withdrawn");
    expect(closeBlockedMessage(3)).toBe("This Internal Audit can't be closed yet: 3 Check-ups are neither evaluated nor withdrawn");
  });
});
