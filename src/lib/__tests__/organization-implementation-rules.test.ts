import { describe, expect, it } from "vitest";
import type { ControlApplicability, ControlAssessmentStatus, UserRole } from "@prisma/client";
import {
  canEditOrganizationImplementation,
  hasOrganizationImplementation,
  IMPLEMENTATION_STATUSES_REQUIRING_DESCRIPTION,
  implementationDescriptionRefusal,
} from "../organization-implementation-rules";

const ALL_ROLES: UserRole[] = [
  "ADMIN",
  "COMPLIANCE_MANAGER",
  "SYSTEM_OWNER",
  "RISK_OWNER",
  "REVIEWER",
  "BUSINESS_RISK_OWNER",
  "VIEWER",
];
const ALL_STATUSES: ControlAssessmentStatus[] = ["NOT_STARTED", "IN_PROGRESS", "FULFILLED", "NOT_APPLICABLE", "WAIVED"];

describe("canEditOrganizationImplementation (#120)", () => {
  const userId = "user-1";
  const ownedBy = (ownerId: string | null) => ({ ownerId });

  it.each(ALL_ROLES)("lets a %s edit a Control they own, whatever their role", (role) => {
    expect(canEditOrganizationImplementation({ id: userId, role }, ownedBy(userId))).toBe(true);
  });

  it.each(["ADMIN", "COMPLIANCE_MANAGER"] as UserRole[])("lets a %s edit any Control, owned by someone else or unowned", (role) => {
    expect(canEditOrganizationImplementation({ id: userId, role }, ownedBy("someone-else"))).toBe(true);
    expect(canEditOrganizationImplementation({ id: userId, role }, ownedBy(null))).toBe(true);
  });

  it.each(ALL_ROLES.filter((role) => role !== "ADMIN" && role !== "COMPLIANCE_MANAGER"))(
    "refuses a %s who is not the Control Owner, for another owner's Control and an unowned one",
    (role) => {
      expect(canEditOrganizationImplementation({ id: userId, role }, ownedBy("someone-else"))).toBe(false);
      expect(canEditOrganizationImplementation({ id: userId, role }, ownedBy(null))).toBe(false);
    },
  );

  it("is an allow-list: a role the rule does not name is refused, even with a null owner and a null-ish id", () => {
    const future = { id: "", role: "AUDITOR" as unknown as UserRole };
    expect(canEditOrganizationImplementation(future, ownedBy(null))).toBe(false);
    expect(canEditOrganizationImplementation(future, ownedBy("someone-else"))).toBe(false);
  });
});

describe("hasOrganizationImplementation", () => {
  it.each([
    ["ORGANIZATIONAL", true],
    ["BOTH", true],
    ["PER_SYSTEM", false],
  ] as [ControlApplicability, boolean][])("%s -> %s", (applicability, expected) => {
    expect(hasOrganizationImplementation(applicability)).toBe(expected);
  });
});

describe("implementationDescriptionRefusal", () => {
  it("requires a description for exactly Waived and Not Applicable", () => {
    expect([...IMPLEMENTATION_STATUSES_REQUIRING_DESCRIPTION].sort()).toEqual(["NOT_APPLICABLE", "WAIVED"]);
    for (const status of ALL_STATUSES) {
      const required = status === "WAIVED" || status === "NOT_APPLICABLE";
      expect(implementationDescriptionRefusal(status, null) !== null, status).toBe(required);
    }
  });

  it.each([null, undefined, "", "   ", "\n\t"])("treats %j as no description", (description) => {
    expect(implementationDescriptionRefusal("WAIVED", description)).not.toBeNull();
    expect(implementationDescriptionRefusal("NOT_APPLICABLE", description)).not.toBeNull();
  });

  it("accepts a description for every status", () => {
    for (const status of ALL_STATUSES) {
      expect(implementationDescriptionRefusal(status, "Covered by the ISMS policy")).toBeNull();
    }
  });
});
