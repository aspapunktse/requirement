import { describe, expect, it } from "vitest";
import type { ControlAssessmentStatus, SelfAssessmentAnswer, UserRole } from "@prisma/client";
import {
  assessmentEditAccess,
  canAnswerSelfAssessment,
  canCreateSystem,
  canEditAssessment,
  canSubmit,
  isSystemOwnerOrAdmin,
} from "../system-permissions";
import { canManageBusinessUnits } from "../business-units";
import { canManageFrameworkScopes } from "../framework-scope";
import { canMarkOnboarded } from "../onboarding";
import { canLogRisk } from "../risks";
import { canManageCapabilities } from "../system-capabilities";
import { canChangeSystemClassification } from "../system-classification-change";

const system = { ownerId: "owner" };
const ALL_ROLES: UserRole[] = [
  "ADMIN",
  "RISK_OWNER",
  "SYSTEM_OWNER",
  "REVIEWER",
  "VIEWER",
  "BUSINESS_RISK_OWNER",
  "COMPLIANCE_MANAGER",
];
const ALL_STATUSES: ControlAssessmentStatus[] = ["NOT_STARTED", "IN_PROGRESS", "FULFILLED", "NOT_APPLICABLE", "WAIVED"];
const ALL_ANSWERS: SelfAssessmentAnswer[] = ["YES", "NO", "NA"];
const NON_OWNER_NO_ACCESS_ROLES = ["SYSTEM_OWNER", "REVIEWER", "VIEWER", "BUSINESS_RISK_OWNER", "COMPLIANCE_MANAGER"] as const;

describe("isSystemOwnerOrAdmin / canSubmit", () => {
  it("allows an ADMIN on any System", () => {
    expect(isSystemOwnerOrAdmin({ id: "a", role: "ADMIN" }, system)).toBe(true);
    expect(canSubmit({ id: "a", role: "ADMIN" }, system)).toBe(true);
  });

  it.each(ALL_ROLES.filter((role) => role !== "ADMIN" && role !== "COMPLIANCE_MANAGER"))(
    "allows the System's owner whatever their role (%s), and nobody else of that role",
    (role) => {
      expect(canSubmit({ id: "owner", role }, system)).toBe(true);
      expect(canSubmit({ id: "someone-else", role }, system)).toBe(false);
    },
  );

  it("never allows a COMPLIANCE_MANAGER, even as the recorded owner (#71)", () => {
    expect(canSubmit({ id: "owner", role: "COMPLIANCE_MANAGER" }, system)).toBe(false);
    expect(canSubmit({ id: "cm", role: "COMPLIANCE_MANAGER" }, system)).toBe(false);
  });
});

describe("assessmentEditAccess", () => {
  it("is full for an ADMIN and for the System's owner", () => {
    expect(assessmentEditAccess({ id: "a", role: "ADMIN" }, system)).toBe("full");
    expect(assessmentEditAccess({ id: "owner", role: "SYSTEM_OWNER" }, system)).toBe("full");
    expect(assessmentEditAccess({ id: "owner", role: "RISK_OWNER" }, system)).toBe("full");
  });

  it("is waive-only for a RISK_OWNER who doesn't own the System", () => {
    expect(assessmentEditAccess({ id: "ro", role: "RISK_OWNER" }, system)).toBe("waive-only");
  });

  it.each(NON_OWNER_NO_ACCESS_ROLES)("is none for a non-owner %s", (role) => {
    expect(assessmentEditAccess({ id: "x", role }, system)).toBe("none");
  });
});

describe("canEditAssessment", () => {
  it.each(ALL_STATUSES)("lets the owner and an ADMIN set %s", (status) => {
    expect(canEditAssessment({ id: "owner", role: "SYSTEM_OWNER" }, system, status)).toBe(true);
    expect(canEditAssessment({ id: "a", role: "ADMIN" }, system, status)).toBe(true);
  });

  it.each(ALL_STATUSES)("lets a non-owner RISK_OWNER set %s only when it is Waived / Not Applicable", (status) => {
    expect(canEditAssessment({ id: "ro", role: "RISK_OWNER" }, system, status)).toBe(
      status === "WAIVED" || status === "NOT_APPLICABLE",
    );
  });

  it.each(NON_OWNER_NO_ACCESS_ROLES)("refuses a non-owner %s every status", (role) => {
    for (const status of ALL_STATUSES) {
      expect(canEditAssessment({ id: "x", role }, system, status)).toBe(false);
    }
  });
});

describe("canAnswerSelfAssessment", () => {
  it.each(ALL_ANSWERS)("lets the owner and an ADMIN answer %s", (answer) => {
    expect(canAnswerSelfAssessment({ id: "owner", role: "SYSTEM_OWNER" }, system, answer)).toBe(true);
    expect(canAnswerSelfAssessment({ id: "a", role: "ADMIN" }, system, answer)).toBe(true);
  });

  it.each(ALL_ANSWERS)("lets a non-owner RISK_OWNER answer %s only when it is N/A", (answer) => {
    expect(canAnswerSelfAssessment({ id: "ro", role: "RISK_OWNER" }, system, answer)).toBe(answer === "NA");
  });

  it.each(NON_OWNER_NO_ACCESS_ROLES)("refuses a non-owner %s every answer", (role) => {
    for (const answer of ALL_ANSWERS) {
      expect(canAnswerSelfAssessment({ id: "x", role }, system, answer)).toBe(false);
    }
  });
});

describe("canCreateSystem (#91)", () => {
  it.each(["SYSTEM_OWNER", "RISK_OWNER", "ADMIN"] as const)("allows a %s", (role) => {
    expect(canCreateSystem({ role })).toBe(true);
  });

  it.each(["REVIEWER", "VIEWER", "BUSINESS_RISK_OWNER", "COMPLIANCE_MANAGER"] as const)("refuses a %s", (role) => {
    expect(canCreateSystem({ role })).toBe(false);
  });

  it("names its roles explicitly, so a role added in future is refused until listed", () => {
    expect(ALL_ROLES.filter((role) => canCreateSystem({ role })).sort()).toEqual(["ADMIN", "RISK_OWNER", "SYSTEM_OWNER"]);
  });
});

/**
 * Every per-feature owner rule delegates to `isSystemOwnerOrAdmin` (#91): the
 * System's owner (`ownerId`, whatever the role) or an ADMIN, never a
 * COMPLIANCE_MANAGER, never a non-owner. The classification helpers have no
 * lifecycle check any more (ADR 0006, #86); `canMarkOnboarded` and the
 * review lifecycle keep theirs.
 */
describe("owner actions share one owner rule (#91)", () => {
  const draft = { ownerId: "owner", status: "DRAFT" };
  type Helper = (user: { id: string; role: UserRole }, system: { ownerId: string; status: string }) => boolean;
  const ownerActions: [string, Helper][] = [
    ["change classification", canChangeSystemClassification],
    ["manage Capabilities", canManageCapabilities],
    ["manage Business Units", canManageBusinessUnits],
    ["manage Framework Scope", canManageFrameworkScopes],
    ["log a Risk", canLogRisk],
    ["mark Onboarded", canMarkOnboarded],
  ];

  describe.each(ownerActions)("%s", (_name, can) => {
    it.each(ALL_ROLES.filter((role) => role !== "COMPLIANCE_MANAGER"))(
      "allows the owner whatever their role (%s)",
      (role) => {
        expect(can({ id: "owner", role }, draft)).toBe(true);
      },
    );

    it("allows an ADMIN on any System", () => {
      expect(can({ id: "a", role: "ADMIN" }, draft)).toBe(true);
    });

    it("never allows a COMPLIANCE_MANAGER, even as the recorded owner", () => {
      expect(can({ id: "owner", role: "COMPLIANCE_MANAGER" }, draft)).toBe(false);
      expect(can({ id: "cm", role: "COMPLIANCE_MANAGER" }, draft)).toBe(false);
    });
  });

  it.each(["SYSTEM_OWNER", "REVIEWER", "VIEWER", "BUSINESS_RISK_OWNER"] as const)(
    "gives a non-owner %s no owner action: a role name alone grants nothing",
    (role) => {
      for (const [name, can] of ownerActions) {
        expect(can({ id: "someone-else", role }, draft), name).toBe(false);
      }
    },
  );

  it("lets a RISK_OWNER log a Risk on any System (a role grant), but nothing else on a System they don't own", () => {
    const riskOwner = { id: "ro", role: "RISK_OWNER" as const };
    for (const [name, can] of ownerActions) {
      expect(can(riskOwner, draft), name).toBe(name === "log a Risk");
    }
  });

  it("has no lifecycle lock on classification, Capabilities, Framework Scope or Business Units (ADR 0006, #86)", () => {
    const helpers = [
      canChangeSystemClassification,
      canManageCapabilities,
      canManageFrameworkScopes,
      canManageBusinessUnits,
    ];
    for (const status of ["DRAFT", "IN_REVIEW", "APPROVED", "ONBOARDED"]) {
      const system = { ownerId: "owner", status };
      for (const can of helpers) {
        expect(can({ id: "owner", role: "RISK_OWNER" }, system), `owner, ${status}`).toBe(true);
        expect(can({ id: "a", role: "ADMIN" }, system), `ADMIN, ${status}`).toBe(true);
        expect(can({ id: "someone-else", role: "SYSTEM_OWNER" }, system), `non-owner, ${status}`).toBe(false);
      }
    }
  });
});
