import { describe, expect, it } from "vitest";
import type { ControlAssessmentStatus, SelfAssessmentAnswer, UserRole } from "@prisma/client";
import {
  assessmentEditAccess,
  canAnswerSelfAssessment,
  canEditAssessment,
  canSubmit,
  isSystemOwnerOrAdmin,
} from "../system-permissions";

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
