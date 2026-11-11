import { describe, expect, it } from "vitest";
import type { UserRole } from "@prisma/client";
import { canAssignRiskOwner, canLogRisk, ROLES_ALLOWED_TO_MANAGE_RISK_STATUS, systemRiskHref } from "../risks";
import { canRecordRiskAnalysis } from "../risk-analysis";
import { canBeSystemOwner, canCreateSystem } from "../system-permissions";

/** Who may assign a Risk's owner and record a Risk Analysis (#360), and what the Risk Facilitator may not do (#362). */
const system = { ownerId: "owner" };
const as = (role: UserRole, id = "someone") => ({ id, role });

describe("canAssignRiskOwner", () => {
  it.each(["ADMIN", "RISK_OWNER", "RISK_FACILITATOR"] as const)("allows a %s who does not own the System", (role) => {
    expect(canAssignRiskOwner(as(role), system)).toBe(true);
  });

  it.each(["SYSTEM_OWNER", "BUSINESS_RISK_OWNER", "VIEWER", "REVIEWER", "COMPLIANCE_MANAGER", "INTERNAL_AUDITOR"] as const)(
    "refuses a %s, even as the System's owner",
    (role) => {
      expect(canAssignRiskOwner(as(role), system)).toBe(false);
      expect(canAssignRiskOwner(as(role, "owner"), system)).toBe(false);
    },
  );

  it("refuses a Risk Facilitator on a System they own, but not an Admin or a Risk Owner", () => {
    expect(canAssignRiskOwner(as("RISK_FACILITATOR", "owner"), system)).toBe(false);
    expect(canAssignRiskOwner(as("ADMIN", "owner"), system)).toBe(true);
    expect(canAssignRiskOwner(as("RISK_OWNER", "owner"), system)).toBe(true);
  });
});

describe("the Risk Facilitator (#362)", () => {
  const facilitator = as("RISK_FACILITATOR");

  it("records a Risk Analysis, except on a System they own", () => {
    expect(canRecordRiskAnalysis(facilitator, system)).toBe(true);
    expect(canRecordRiskAnalysis(as("RISK_FACILITATOR", "owner"), system)).toBe(false);
  });

  it("does not manage Risk status, log an ad hoc Risk, create a System or own one", () => {
    expect(ROLES_ALLOWED_TO_MANAGE_RISK_STATUS).not.toContain("RISK_FACILITATOR");
    expect(canLogRisk(facilitator, system)).toBe(false);
    expect(canLogRisk(as("RISK_FACILITATOR", "owner"), system)).toBe(false);
    expect(canCreateSystem(facilitator)).toBe(false);
    expect(canBeSystemOwner(facilitator)).toBe(false);
  });
});

describe("systemRiskHref", () => {
  it("links to the opened Risk on its System", () => {
    expect(systemRiskHref("sys1", "risk1")).toBe("/systems/sys1#risk-risk1");
  });
});
