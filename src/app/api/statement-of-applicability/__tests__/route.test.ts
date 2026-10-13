import type { UserRole } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { requestAs } from "@/test/provider-fixtures";
import { createFixtureFramework, mapControlsToFramework } from "@/test/framework-fixtures";
import { GET } from "../route";

/**
 * GET /api/statement-of-applicability (#145): every signed-in role reads the same
 * rows, and a Draft Framework never shows up in them, for a curator or anyone else.
 */

const SUFFIX = `${process.pid}-${Date.now()}`;
const ROLES: UserRole[] = ["ADMIN", "COMPLIANCE_MANAGER", "SYSTEM_OWNER", "RISK_OWNER", "REVIEWER", "BUSINESS_RISK_OWNER", "VIEWER", "INTERNAL_AUDITOR"];

describe("GET /api/statement-of-applicability (#145)", () => {
  const userIds: Record<string, string> = {};
  let controlId: string;
  let draftFrameworkId: string;
  let draftName: string;
  let publishedLabel: string;

  const get = (userId: string | null) => GET(requestAs("/api/statement-of-applicability", userId, "GET"));

  beforeAll(async () => {
    for (const role of ROLES) {
      userIds[role] = (
        await prisma.user.create({ data: { email: `test-soa-${role}-${SUFFIX}@example.com`, name: `Test SOA ${role}`, role } })
      ).id;
    }
    const published = await createFixtureFramework("SOA route");
    publishedLabel = `${published.name}:${published.version}`;
    const draft = await prisma.framework.create({ data: { name: `Test SOA route Draft ${SUFFIX}`, version: "1", status: "DRAFT" } });
    draftFrameworkId = draft.id;
    draftName = draft.name;
    const control = await prisma.control.create({
      data: { code: `TEST-SOA-ROUTE-${SUFFIX}`, title: "Test SOA route", description: "d", category: "Test", applicability: "ORGANIZATIONAL" },
    });
    controlId = control.id;
    await mapControlsToFramework(published.id, [controlId]);
    await mapControlsToFramework(draft.id, [controlId]);
  });

  afterAll(async () => {
    await prisma.control.deleteMany({ where: { id: controlId } });
    await prisma.requirement.deleteMany({ where: { frameworkId: draftFrameworkId } });
    await prisma.framework.deleteMany({ where: { id: draftFrameworkId } });
    await prisma.user.deleteMany({ where: { id: { in: Object.values(userIds) } } });
  });

  it.each(ROLES)("lets a %s read it, with the Control once and no Draft in its justification", async (role) => {
    const response = await get(userIds[role]);
    expect(response.status).toBe(200);
    const { rows } = (await response.json()) as { rows: { controlId: string; included: boolean; inclusionJustification: string }[] };
    const mine = rows.filter((row) => row.controlId === controlId);
    expect(mine).toHaveLength(1);
    expect(mine[0].included).toBe(true);
    expect(mine[0].inclusionJustification).toContain(publishedLabel);
    expect(JSON.stringify(rows)).not.toContain(draftName);
  });

  it("refuses an unauthenticated request (401)", async () => {
    expect((await get(null)).status).toBe(401);
  });
});
