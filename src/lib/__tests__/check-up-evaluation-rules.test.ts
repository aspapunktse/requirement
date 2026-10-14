import { describe, expect, it } from "vitest";
import type { UserRole } from "@prisma/client";
import {
  canEvaluateCheckUps,
  checkUpEvaluationRefusal,
  commentRequired,
  describeCheckUpEvaluation,
  EVALUATION_EVENT_NAME_LIMIT,
  MAX_EVALUATION_COMMENT_LENGTH,
  validateEvaluation,
} from "@/lib/check-up-evaluation-rules";

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

describe("canEvaluateCheckUps", () => {
  it("lets only an Internal Auditor evaluate", () => {
    for (const role of ALL_ROLES) expect(canEvaluateCheckUps({ role })).toBe(role === "INTERNAL_AUDITOR");
  });
});

describe("checkUpEvaluationRefusal", () => {
  const ok = { auditStatus: "LAUNCHED", answered: true, evaluated: false, withdrawn: false } as const;

  it("allows an answered, unevaluated Check-up of a launched audit", () => {
    expect(checkUpEvaluationRefusal(ok)).toBeNull();
  });

  it("refuses an unanswered Check-up", () => {
    expect(checkUpEvaluationRefusal({ ...ok, answered: false })).toMatch(/answered/);
  });

  it("refuses an audit that isn't launched", () => {
    expect(checkUpEvaluationRefusal({ ...ok, auditStatus: "CLOSED" })).toMatch(/closed/);
    expect(checkUpEvaluationRefusal({ ...ok, auditStatus: "DRAFT" })).toMatch(/draft/);
  });

  it("refuses a withdrawn Check-up, answered or not (#158)", () => {
    expect(checkUpEvaluationRefusal({ ...ok, withdrawn: true })).toMatch(/withdrawn/);
    expect(checkUpEvaluationRefusal({ ...ok, answered: false, withdrawn: true })).toMatch(/withdrawn/);
    expect(checkUpEvaluationRefusal({ ...ok, auditStatus: "CLOSED", withdrawn: true })).toMatch(/withdrawn/);
  });

  it("refuses a second evaluation: an evaluation is final", () => {
    expect(checkUpEvaluationRefusal({ ...ok, evaluated: true })).toMatch(/final/);
    expect(checkUpEvaluationRefusal({ ...ok, auditStatus: "CLOSED", evaluated: true })).toMatch(/final/);
  });
});

describe("validateEvaluation", () => {
  it("accepts Conforming with or without a comment", () => {
    expect(validateEvaluation({ outcome: "CONFORMING" })).toEqual({ evaluation: { outcome: "CONFORMING", comment: "" }, problems: [] });
    expect(validateEvaluation({ outcome: "CONFORMING", comment: " Fine " }).evaluation).toEqual({ outcome: "CONFORMING", comment: "Fine" });
  });

  it("requires a comment for an Observation and a Nonconformity", () => {
    expect(commentRequired("CONFORMING")).toBe(false);
    for (const outcome of ["OBSERVATION", "NONCONFORMITY"]) {
      expect(validateEvaluation({ outcome }).evaluation).toBeNull();
      expect(validateEvaluation({ outcome, comment: "   " }).problems).toHaveLength(1);
      expect(validateEvaluation({ outcome, comment: "Because" }).evaluation).toEqual({ outcome, comment: "Because" });
    }
  });

  it("refuses an unknown outcome and an over-long comment", () => {
    expect(validateEvaluation({ outcome: "FAIL", comment: "x" }).problems).toHaveLength(1);
    expect(validateEvaluation({ outcome: "", comment: "x" }).evaluation).toBeNull();
    const long = "a".repeat(MAX_EVALUATION_COMMENT_LENGTH + 1);
    expect(validateEvaluation({ outcome: "CONFORMING", comment: long }).evaluation).toBeNull();
    expect(validateEvaluation({ outcome: "CONFORMING", comment: "a".repeat(MAX_EVALUATION_COMMENT_LENGTH) }).problems).toEqual([]);
  });
});

describe("describeCheckUpEvaluation", () => {
  it("names the audit, the Control, the System and the outcome", () => {
    expect(describeCheckUpEvaluation({ outcome: "NONCONFORMITY", auditTitle: "Q4 audit", controlCode: "A.5.1", systemName: "Payroll" })).toBe(
      'Check-up evaluated as Nonconformity: Control A.5.1 for System "Payroll" (Internal Audit "Q4 audit")',
    );
  });

  it("says the Organization for an Organization-level Check-up and caps long names", () => {
    const detail = describeCheckUpEvaluation({ outcome: "CONFORMING", auditTitle: "t".repeat(500), controlCode: "C", systemName: null });
    expect(detail).toContain("for the Organization");
    expect(detail.length).toBeLessThan(EVALUATION_EVENT_NAME_LIMIT + 100);
  });
});
