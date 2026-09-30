import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { getBaseFramework } from "@/test/framework-fixtures";
import { getAssignedScope, resolveScopeWhere, scopedSystemsWhere } from "../business-risk-owner";

describe("scopedSystemsWhere", () => {
  it("sees nothing when unassigned to any Business Unit or Framework", () => {
    expect(scopedSystemsWhere({ businessUnitIds: [], frameworkIds: [], baseFrameworkIds: [] })).toEqual({ id: { in: [] } });
  });

  it("unions Business Unit and Framework membership when both are assigned", () => {
    expect(scopedSystemsWhere({ businessUnitIds: ["bu1"], frameworkIds: ["fw1"], baseFrameworkIds: [] })).toEqual({
      OR: [
        { businessUnits: { some: { id: { in: ["bu1"] } } } },
        { frameworkScopes: { some: { id: { in: ["fw1"] } } } },
      ],
    });
  });

  it("only includes the axis that's actually assigned", () => {
    expect(scopedSystemsWhere({ businessUnitIds: ["bu1"], frameworkIds: [], baseFrameworkIds: [] })).toEqual({
      OR: [{ businessUnits: { some: { id: { in: ["bu1"] } } } }],
    });
  });

  it("sees every System when assigned the base Framework, which is in scope of every System (#90)", () => {
    const everything = { businessUnitIds: [], frameworkIds: ["base", "fw1"], baseFrameworkIds: ["base"] };
    expect(scopedSystemsWhere(everything)).toEqual({});
    // Owning the base is a union with everything, whatever else is assigned.
    expect(scopedSystemsWhere({ ...everything, businessUnitIds: ["bu1"] })).toEqual({});
  });

  it("still needs a stored scope row for an assigned non-base Framework", () => {
    expect(scopedSystemsWhere({ businessUnitIds: [], frameworkIds: ["fw1"], baseFrameworkIds: [] })).toEqual({
      OR: [{ frameworkScopes: { some: { id: { in: ["fw1"] } } } }],
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
    const fw = await prisma.framework.create({ data: { name: `Test Framework ${Date.now()}`, version: "1" } });
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
    expect(scope.baseFrameworkIds).toEqual([]);
  });

  it("resolveScopeWhere for ADMIN is unrestricted with no filter", async () => {
    const result = await resolveScopeWhere({ id: "admin-1", role: "ADMIN" }, {});
    expect(result).toEqual({ ok: true, where: {} });
  });

  it("resolveScopeWhere for a BUSINESS_RISK_OWNER defaults to their assigned scope", async () => {
    const result = await resolveScopeWhere({ id: userId, role: "BUSINESS_RISK_OWNER" }, {});
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.where).toEqual(
        scopedSystemsWhere({ businessUnitIds: [businessUnitId], frameworkIds: [frameworkId], baseFrameworkIds: [] }),
      );
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

/**
 * "Systems in scope of Framework F" (#90): the base Framework means every System,
 * stored scope row or not; a non-base Framework means Systems with a stored row.
 */
describe("Business Risk Owner scope and the base Framework", () => {
  const suffix = Date.now();
  const EMAILS = {
    owner: `test-bro-base-owner-${suffix}@example.com`,
    baseBro: `test-bro-base-bro-${suffix}@example.com`,
    otherBro: `test-bro-base-other-${suffix}@example.com`,
  };
  let baseId: string;
  let frameworkId: string;
  let baseBroId: string;
  let otherBroId: string;
  let noRowSystemId: string;
  let scopedSystemId: string;
  let ownerId: string;

  beforeAll(async () => {
    baseId = (await getBaseFramework()).id;
    frameworkId = (
      await prisma.framework.create({ data: { name: `Test BRO Base Framework ${suffix}`, version: "1", status: "PUBLISHED" } })
    ).id;
    ownerId = (await prisma.user.create({ data: { email: EMAILS.owner, name: "BRO Base Owner", role: "SYSTEM_OWNER" } })).id;
    // One BRO assigned the (seeded or fixture) base Framework, one assigned only the fixture non-base Framework.
    baseBroId = (
      await prisma.user.create({
        data: {
          email: EMAILS.baseBro,
          name: "BRO Base BRO",
          role: "BUSINESS_RISK_OWNER",
          frameworkScopes: { connect: { id: baseId } },
        },
      })
    ).id;
    otherBroId = (
      await prisma.user.create({
        data: {
          email: EMAILS.otherBro,
          name: "BRO Other BRO",
          role: "BUSINESS_RISK_OWNER",
          frameworkScopes: { connect: { id: frameworkId } },
        },
      })
    ).id;
    // A System with no stored scope row at all, and one that declared the fixture Framework.
    noRowSystemId = (await prisma.system.create({ data: { name: `Test BRO Base No Row ${suffix}`, ownerId } })).id;
    scopedSystemId = (
      await prisma.system.create({
        data: { name: `Test BRO Base Scoped ${suffix}`, ownerId, frameworkScopes: { connect: { id: frameworkId } } },
      })
    ).id;
  });

  afterAll(async () => {
    await prisma.system.deleteMany({ where: { id: { in: [noRowSystemId, scopedSystemId] } } });
    await prisma.user.deleteMany({ where: { email: { in: Object.values(EMAILS) } } });
    await prisma.framework.deleteMany({ where: { id: frameworkId } });
  });

  /** Which of the two fixture Systems a resolved `where` matches. */
  async function visible(where: object) {
    const rows = await prisma.system.findMany({
      where: { AND: [where, { id: { in: [noRowSystemId, scopedSystemId] } }] },
      select: { id: true },
    });
    return rows.map((r) => r.id).sort();
  }
  const both = () => [noRowSystemId, scopedSystemId].sort();

  it("getAssignedScope reports which assigned Framework is the base", async () => {
    expect(await getAssignedScope(baseBroId)).toMatchObject({ frameworkIds: [baseId], baseFrameworkIds: [baseId] });
    expect(await getAssignedScope(otherBroId)).toMatchObject({ frameworkIds: [frameworkId], baseFrameworkIds: [] });
  });

  it("a Business Risk Owner assigned the base Framework sees every System, including one with no stored base scope row", async () => {
    const result = await resolveScopeWhere({ id: baseBroId, role: "BUSINESS_RISK_OWNER" }, {});
    expect(result.ok).toBe(true);
    if (result.ok) expect(await visible(result.where)).toEqual(both());
  });

  it("filtering by the base Framework matches every System; filtering by a non-base Framework needs a stored row", async () => {
    const byBase = await resolveScopeWhere({ id: baseBroId, role: "BUSINESS_RISK_OWNER" }, { frameworkId: baseId });
    expect(byBase.ok).toBe(true);
    if (byBase.ok) expect(await visible(byBase.where)).toEqual(both());

    const byOther = await resolveScopeWhere({ id: otherBroId, role: "BUSINESS_RISK_OWNER" }, { frameworkId });
    expect(byOther.ok).toBe(true);
    if (byOther.ok) expect(await visible(byOther.where)).toEqual([scopedSystemId]);
  });

  it("a non-base assignment alone does not widen visibility to Systems without a stored row", async () => {
    const result = await resolveScopeWhere({ id: otherBroId, role: "BUSINESS_RISK_OWNER" }, {});
    expect(result.ok).toBe(true);
    if (result.ok) expect(await visible(result.where)).toEqual([scopedSystemId]);
  });

  it("still rejects a Framework filter the user is not assigned to, base or not", async () => {
    expect(await resolveScopeWhere({ id: otherBroId, role: "BUSINESS_RISK_OWNER" }, { frameworkId: baseId })).toEqual({
      ok: false,
      error: "Not assigned to that Framework",
    });
    expect(await resolveScopeWhere({ id: baseBroId, role: "BUSINESS_RISK_OWNER" }, { frameworkId })).toEqual({
      ok: false,
      error: "Not assigned to that Framework",
    });
  });

  it("an ADMIN filtering by the base Framework gets every System; by a non-base Framework, only those with a stored row", async () => {
    const admin = { id: "admin-1", role: "ADMIN" };
    const byBase = await resolveScopeWhere(admin, { frameworkId: baseId });
    expect(byBase.ok && (await visible(byBase.where))).toEqual(both());
    const byOther = await resolveScopeWhere(admin, { frameworkId });
    expect(byOther.ok && (await visible(byOther.where))).toEqual([scopedSystemId]);
  });
});
