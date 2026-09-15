import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { getAssignedScope, resolveScopeWhere, scopedSystemsWhere } from "../business-risk-owner";

describe("scopedSystemsWhere", () => {
  it("sees nothing when unassigned to any Business Unit or Framework", () => {
    expect(scopedSystemsWhere({ businessUnitIds: [], frameworkIds: [] })).toEqual({ id: { in: [] } });
  });

  it("unions Business Unit and Framework membership when both are assigned", () => {
    expect(scopedSystemsWhere({ businessUnitIds: ["bu1"], frameworkIds: ["fw1"] })).toEqual({
      OR: [
        { businessUnits: { some: { id: { in: ["bu1"] } } } },
        { frameworkScopes: { some: { id: { in: ["fw1"] } } } },
      ],
    });
  });

  it("only includes the axis that's actually assigned", () => {
    expect(scopedSystemsWhere({ businessUnitIds: ["bu1"], frameworkIds: [] })).toEqual({
      OR: [{ businessUnits: { some: { id: { in: ["bu1"] } } } }],
    });
  });
});

describe("getAssignedScope / resolveScopeWhere", () => {
  const EMAIL = "test-bro-scope-user@example.com";
  let userId: string;
  let businessUnitId: string;
  let frameworkId: string;
  let otherBusinessUnitId: string;

  beforeAll(async () => {
    const user = await prisma.user.upsert({
      where: { email: EMAIL },
      update: {},
      create: { email: EMAIL, name: "BRO Scope Test", role: "BUSINESS_RISK_OWNER" },
    });
    userId = user.id;

    const bu = await prisma.businessUnit.create({ data: { name: `Test BU ${Date.now()}` } });
    const otherBu = await prisma.businessUnit.create({ data: { name: `Test BU Other ${Date.now()}` } });
    const fw = await prisma.framework.create({ data: { name: `Test Framework ${Date.now()}` } });
    businessUnitId = bu.id;
    otherBusinessUnitId = otherBu.id;
    frameworkId = fw.id;

    await prisma.user.update({
      where: { id: userId },
      data: {
        businessUnitScopes: { connect: { id: businessUnitId } },
        frameworkScopes: { connect: { id: frameworkId } },
      },
    });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: EMAIL } });
    await prisma.businessUnit.deleteMany({ where: { id: { in: [businessUnitId, otherBusinessUnitId] } } });
    await prisma.framework.deleteMany({ where: { id: frameworkId } });
  });

  it("getAssignedScope returns the assigned Business Unit and Framework ids", async () => {
    const scope = await getAssignedScope(userId);
    expect(scope.businessUnitIds).toEqual([businessUnitId]);
    expect(scope.frameworkIds).toEqual([frameworkId]);
  });

  it("resolveScopeWhere for ADMIN is unrestricted with no filter", async () => {
    const result = await resolveScopeWhere({ id: "admin-1", role: "ADMIN" }, {});
    expect(result).toEqual({ ok: true, where: {} });
  });

  it("resolveScopeWhere for a BUSINESS_RISK_OWNER defaults to their assigned scope", async () => {
    const result = await resolveScopeWhere({ id: userId, role: "BUSINESS_RISK_OWNER" }, {});
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.where).toEqual(scopedSystemsWhere({ businessUnitIds: [businessUnitId], frameworkIds: [frameworkId] }));
    }
  });

  it("resolveScopeWhere rejects filtering by a Business Unit the user isn't assigned to", async () => {
    const result = await resolveScopeWhere(
      { id: userId, role: "BUSINESS_RISK_OWNER" },
      { businessUnitId: otherBusinessUnitId },
    );
    expect(result).toEqual({ ok: false, error: "Not assigned to that Business Unit" });
  });

  it("resolveScopeWhere accepts filtering by an assigned Business Unit", async () => {
    const result = await resolveScopeWhere(
      { id: userId, role: "BUSINESS_RISK_OWNER" },
      { businessUnitId },
    );
    expect(result.ok).toBe(true);
  });
});
