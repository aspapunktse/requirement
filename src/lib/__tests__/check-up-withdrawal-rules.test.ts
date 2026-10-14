import { describe, expect, it } from "vitest";
import type { InternalAuditStatus, UserRole } from "@prisma/client";
import {
  canWithdrawCheckUps,
  checkUpWithdrawalRefusal,
  MAX_WITHDRAWAL_REASON_LENGTH,
  validateWithdrawal,
} from "@/lib/check-up-withdrawal-rules";

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
const STATUSES: InternalAuditStatus[] = ["DRAFT", "LAUNCHED", "CLOSED"];

describe("canWithdrawCheckUps", () => {
  it("lets only an Internal Auditor withdraw", () => {
    for (const role of ALL_ROLES) expect(canWithdrawCheckUps({ role })).toBe(role === "INTERNAL_AUDITOR");
  });
});

describe("checkUpWithdrawalRefusal", () => {
  it("allows exactly an unevaluated, unwithdrawn Check-up of a launched audit (the full matrix)", () => {
    for (const auditStatus of STATUSES) {
      for (const evaluated of [false, true]) {
        for (const withdrawn of [false, true]) {
          const refusal = checkUpWithdrawalRefusal({ auditStatus, evaluated, withdrawn });
          const allowed = auditStatus === "LAUNCHED" && !evaluated && !withdrawn;
          expect(refusal === null, `${auditStatus} evaluated=${evaluated} withdrawn=${withdrawn}`).toBe(allowed);
        }
      }
    }
  });

  it("says why, in order: withdrawn already, evaluated, then the audit's state", () => {
    expect(checkUpWithdrawalRefusal({ auditStatus: "CLOSED", evaluated: true, withdrawn: true })).toMatch(/withdrawn already.*final/);
    expect(checkUpWithdrawalRefusal({ auditStatus: "CLOSED", evaluated: true, withdrawn: false })).toMatch(/evaluated/);
    expect(checkUpWithdrawalRefusal({ auditStatus: "CLOSED", evaluated: false, withdrawn: false })).toMatch(/closed/);
    expect(checkUpWithdrawalRefusal({ auditStatus: "DRAFT", evaluated: false, withdrawn: false })).toMatch(/draft/);
  });
});

describe("validateWithdrawal", () => {
  it("trims the reason and accepts it", () => {
    expect(validateWithdrawal({ reason: "  No longer applies  " })).toEqual({ reason: "No longer applies", problems: [] });
  });

  it("requires a reason: missing, empty and blank are refused", () => {
    for (const input of [{}, { reason: "" }, { reason: "  \n " }]) {
      const result = validateWithdrawal(input);
      expect(result.reason).toBeNull();
      expect(result.problems).toEqual(["A reason is required to withdraw a Check-up"]);
    }
  });

  it("allows a reason of exactly the limit and refuses one more character", () => {
    expect(validateWithdrawal({ reason: "x".repeat(MAX_WITHDRAWAL_REASON_LENGTH) }).problems).toEqual([]);
    const over = validateWithdrawal({ reason: "x".repeat(MAX_WITHDRAWAL_REASON_LENGTH + 1) });
    expect(over.reason).toBeNull();
    expect(over.problems[0]).toMatch(/at most 2000/);
  });
});
