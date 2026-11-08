import { describe, expect, it } from "vitest";
import type { UserRole } from "@prisma/client";
import { canCurateFramework, canMarkFirstRound } from "@/lib/frameworks";

/** The one curation rule (#320): a Compliance Manager or an Admin on any Framework, its owner on a non-base one. */
const user = (role: UserRole, id = "u1") => ({ id, role });
const framework = (over: Partial<{ ownerId: string | null; isBase: boolean }> = {}) => ({ ownerId: null, isBase: false, ...over });

describe("canCurateFramework", () => {
  it("lets a Compliance Manager and an Admin curate every Framework, the base and an unowned one included", () => {
    for (const role of ["COMPLIANCE_MANAGER", "ADMIN"] as const) {
      expect(canCurateFramework(user(role), framework())).toBe(true);
      expect(canCurateFramework(user(role), framework({ isBase: true }))).toBe(true);
      expect(canCurateFramework(user(role), framework({ ownerId: "someone-else" }))).toBe(true);
      expect(canCurateFramework(user(role), framework({ ownerId: "u1", isBase: true }))).toBe(true);
    }
  });

  it("lets the owner of a non-base Framework curate it, whatever their writable role", () => {
    for (const role of ["VIEWER", "SYSTEM_OWNER", "REVIEWER", "RISK_OWNER", "BUSINESS_RISK_OWNER"] as const) {
      expect(canCurateFramework(user(role), framework({ ownerId: "u1" }))).toBe(true);
    }
  });

  it("refuses the owner of the base Framework", () => {
    expect(canCurateFramework(user("VIEWER"), framework({ ownerId: "u1", isBase: true }))).toBe(false);
  });

  it("refuses everyone else: another user's Framework and an unowned one", () => {
    expect(canCurateFramework(user("VIEWER"), framework({ ownerId: "u2" }))).toBe(false);
    expect(canCurateFramework(user("SYSTEM_OWNER"), framework({ ownerId: null }))).toBe(false);
    expect(canCurateFramework(user("VIEWER"), framework({ isBase: true }))).toBe(false);
  });

  it("refuses an owner whose role has become strictly read-only (Internal Auditor)", () => {
    expect(canCurateFramework(user("INTERNAL_AUDITOR"), framework({ ownerId: "u1" }))).toBe(false);
  });
});

describe("canMarkFirstRound", () => {
  it("lets a Compliance Manager and an Admin mark on any Framework, and the owner on any Framework including the base", () => {
    for (const role of ["COMPLIANCE_MANAGER", "ADMIN"] as const) expect(canMarkFirstRound(user(role), framework({ ownerId: "x" }))).toBe(true);
    expect(canMarkFirstRound(user("VIEWER"), framework({ ownerId: "u1" }))).toBe(true);
    expect(canMarkFirstRound(user("VIEWER"), framework({ ownerId: "u1", isBase: true }))).toBe(true);
  });

  it("refuses a non-owner, an unowned Framework and an owner who is now an Internal Auditor", () => {
    expect(canMarkFirstRound(user("VIEWER"), framework({ ownerId: "u2" }))).toBe(false);
    expect(canMarkFirstRound(user("VIEWER"), framework({ ownerId: null }))).toBe(false);
    expect(canMarkFirstRound(user("INTERNAL_AUDITOR"), framework({ ownerId: "u1" }))).toBe(false);
    expect(canMarkFirstRound(user("INTERNAL_AUDITOR"), framework({ ownerId: "u1", isBase: true }))).toBe(false);
  });
});
