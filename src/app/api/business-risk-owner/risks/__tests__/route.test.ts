import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { ACTING_USER_COOKIE } from "@/lib/acting-user";
import { GET } from "../route";

/** The Risk queue's filter by Risk Source (#322). Fixtures only; the Admin sees every System, so the test narrows to its own. */

const suffix = `${process.pid}-${Date.now()}`;

describe("GET /api/business-risk-owner/risks?source=", () => {
  let adminId: string;
  let systemId: string;
  const riskIds: Record<string, string> = {};

  const list = (query = "") =>
    GET(new NextRequest(`http://localhost/api/business-risk-owner/risks${query}`, { headers: { cookie: `${ACTING_USER_COOKIE}=${adminId}` } }));
  const mine = async (query = "") => {
    const response = await list(query);
    expect(response.status).toBe(200);
    return ((await response.json()).risks as { id: string; source: string }[]).filter((risk) => Object.values(riskIds).includes(risk.id));
  };

  beforeAll(async () => {
    adminId = (await prisma.user.create({ data: { email: `test-322-bro-admin-${suffix}@example.com`, name: "Test 322 Admin", role: "ADMIN" } })).id;
    systemId = (await prisma.system.create({ data: { name: `Test 322 BRO System ${suffix}`, ownerId: adminId } })).id;
    for (const source of ["AD_HOC", "AUDIT_FINDING", "REQUIREMENT_NONCONFORMANCE"] as const) {
      riskIds[source] = (await prisma.risk.create({ data: { systemId, source, title: `Test 322 ${source}`, description: "d", severity: "LOW", likelihood: "LOW" } })).id;
    }
  });

  afterAll(async () => {
    await prisma.risk.deleteMany({ where: { systemId } });
    await prisma.system.deleteMany({ where: { id: systemId } });
    await prisma.user.deleteMany({ where: { id: adminId } });
  });

  it("lists every source without a filter, each with its source", async () => {
    const risks = await mine();
    expect(risks.map((risk) => risk.source).sort()).toEqual(["AD_HOC", "AUDIT_FINDING", "REQUIREMENT_NONCONFORMANCE"]);
  });

  it.each(["AD_HOC", "AUDIT_FINDING", "REQUIREMENT_NONCONFORMANCE"])("narrows to %s", async (source) => {
    const risks = await mine(`?source=${source}`);
    expect(risks.map((risk) => risk.id)).toEqual([riskIds[source]]);
  });

  it("refuses an unknown source with a 400", async () => {
    expect((await list("?source=bogus")).status).toBe(400);
  });
});
