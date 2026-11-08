import { describe, expect, it } from "vitest";
import type { UserRole } from "@prisma/client";
import { canCurateFramework } from "@/lib/frameworks";

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

  it("lets the owner of a non-base Framework curate it, whatever their role", () => {
    for (const role of ["VIEWER", "SYSTEM_OWNER", "REVIEWER", "RISK_OWNER", "BUSINESS_RISK_OWNER", "INTERNAL_AUDITOR"] as const) {
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
});
