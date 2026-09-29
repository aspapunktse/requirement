import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { canWriteSystems, visibleSystemsWhere } from "../system-visibility";

describe("visibleSystemsWhere", () => {
  it.each(["ADMIN", "RISK_OWNER", "REVIEWER", "COMPLIANCE_MANAGER"] as const)(
    "returns an unrestricted clause for %s",
    async (role) => {
      expect(await visibleSystemsWhere({ id: "u1", role })).toEqual({});
    },
  );

  it.each(["SYSTEM_OWNER", "VIEWER"] as const)(
    "restricts %s to owned Systems plus ONBOARDED ones",
    async (role) => {
      expect(await visibleSystemsWhere({ id: "u1", role })).toEqual({
        OR: [{ ownerId: "u1" }, { status: "ONBOARDED" }],
      });
    },
  );

  describe("BUSINESS_RISK_OWNER", () => {
    const suffix = Date.now();
    const EMAIL = `test-visibility-bro-${suffix}@example.com`;
    let userId: string;
    let businessUnitId: string;

    beforeAll(async () => {
      const businessUnit = await prisma.businessUnit.create({
        data: { name: `Test Visibility BU ${suffix}` },
      });
      businessUnitId = businessUnit.id;

      const user = await prisma.user.create({
        data: {
          email: EMAIL,
          name: "Test Visibility BRO",
          role: "BUSINESS_RISK_OWNER",
          businessUnitScopes: { connect: { id: businessUnitId } },
        },
      });
      userId = user.id;
    });

    afterAll(async () => {
      await prisma.user.deleteMany({ where: { id: userId } });
      await prisma.businessUnit.deleteMany({ where: { id: businessUnitId } });
    });

    it("also includes Systems within their assigned Business Unit scope, any status", async () => {
      const where = await visibleSystemsWhere({ id: userId, role: "BUSINESS_RISK_OWNER" });
      expect(where).toEqual({
        OR: [
          { ownerId: userId },
          { status: "ONBOARDED" },
          { OR: [{ businessUnits: { some: { id: { in: [businessUnitId] } } } }] },
        ],
      });
    });

    it("restricts an unassigned BUSINESS_RISK_OWNER to owned/ONBOARDED Systems only", async () => {
      const unassigned = await prisma.user.create({
        data: {
          email: `test-visibility-bro-unassigned-${suffix}@example.com`,
          name: "Test Visibility Unassigned BRO",
          role: "BUSINESS_RISK_OWNER",
        },
      });
      try {
        const where = await visibleSystemsWhere({ id: unassigned.id, role: "BUSINESS_RISK_OWNER" });
        expect(where).toEqual({
          OR: [{ ownerId: unassigned.id }, { status: "ONBOARDED" }, { id: { in: [] } }],
        });
      } finally {
        await prisma.user.deleteMany({ where: { id: unassigned.id } });
      }
    });
  });
});

describe("canWriteSystems", () => {
  it("is false for COMPLIANCE_MANAGER, which reads every System but never changes one (#71)", () => {
    expect(canWriteSystems({ role: "COMPLIANCE_MANAGER" })).toBe(false);
  });

  it.each(["ADMIN", "RISK_OWNER", "SYSTEM_OWNER", "REVIEWER", "VIEWER", "BUSINESS_RISK_OWNER"] as const)(
    "is true for %s (its own route-level rules still apply)",
    (role) => {
      expect(canWriteSystems({ role })).toBe(true);
    },
  );
});
