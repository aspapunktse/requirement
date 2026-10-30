import type { UserRole } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { requestAs } from "@/test/provider-fixtures";
import { PUT } from "../[id]/gap-acceptances/route";

/**
 * PUT /api/frameworks/[id]/gap-acceptances (#269): accept several open Coverage Gaps with one justification,
 * all or nothing. Every fixture is created here (CI's database is migrated, not seeded) and removed in afterAll.
 */
const SUFFIX = `${process.pid}-${Date.now()}`;
const ROLES: UserRole[] = ["ADMIN", "COMPLIANCE_MANAGER", "SYSTEM_OWNER", "RISK_OWNER", "REVIEWER", "BUSINESS_RISK_OWNER", "VIEWER"];

const ctxFor = (id: string) => ({ params: Promise.resolve({ id }) }) as never;

describe("PUT /api/frameworks/[id]/gap-acceptances (#269)", () => {
  const userIds: Record<string, string> = {};
  let frameworkId: string;
  let otherFrameworkId: string;
  const controlIds: string[] = [];
  let ids: Record<string, string> = {};
  let otherRequirementId: string;

  const accept = (tag: string | null, body: unknown, id = frameworkId) =>
    PUT(requestAs(`/api/frameworks/${id}/gap-acceptances`, tag ? userIds[tag] : null, "PUT", body), ctxFor(id));
  const acceptance = (code: string) =>
    prisma.requirement.findUniqueOrThrow({
      where: { id: ids[code] },
      select: { gapAcceptedAt: true, gapAcceptedById: true, gapJustification: true },
    });
  const events = () => prisma.changeEvent.count({ where: { actorId: { in: Object.values(userIds) } } });

  beforeAll(async () => {
    for (const role of ROLES) {
      userIds[role] = (
        await prisma.user.create({ data: { email: `test-269-gaps-${role}-${SUFFIX}@example.com`, name: `Test 269 ${role}`, role } })
      ).id;
    }
    frameworkId = (await prisma.framework.create({ data: { name: `Test 269 Bulk ${SUFFIX}`, version: "1", status: "PUBLISHED" } })).id;
    otherFrameworkId = (await prisma.framework.create({ data: { name: `Test 269 Bulk Other ${SUFFIX}`, version: "1", status: "PUBLISHED" } })).id;
    for (const n of [1, 2]) {
      controlIds.push(
        (
          await prisma.control.create({
            data: { code: `TEST-269-GAPS-${SUFFIX}-${n}`, title: `Test 269 control ${n}`, description: "d", category: "Test", applicability: "ORGANIZATIONAL" },
          })
        ).id,
      );
    }
    otherRequirementId = (
      await prisma.requirement.create({ data: { frameworkId: otherFrameworkId, code: "O-1", section: "Other", title: "Other", text: "x" } })
    ).id;
  });

  afterAll(async () => {
    await prisma.changeEvent.deleteMany({ where: { actorId: { in: Object.values(userIds) } } });
    await prisma.requirement.deleteMany({ where: { frameworkId: { in: [frameworkId, otherFrameworkId] } } });
    await prisma.control.deleteMany({ where: { id: { in: controlIds } } });
    await prisma.framework.deleteMany({ where: { id: { in: [frameworkId, otherFrameworkId] } } });
    await prisma.user.deleteMany({ where: { id: { in: Object.values(userIds) } } });
  });

  beforeEach(async () => {
    await prisma.requirement.deleteMany({ where: { frameworkId } });
    ids = {};
    // none, none2, partial: open gaps; full: covered; accepted: an accepted gap
    for (const code of ["none", "none2", "partial", "full", "accepted"]) {
      ids[code] = (await prisma.requirement.create({ data: { frameworkId, code, section: "S", title: `Title ${code}`, text: "x" } })).id;
    }
    await prisma.controlMapping.create({ data: { requirementId: ids.partial, controlId: controlIds[0], coverage: "PARTIAL" } });
    await prisma.controlMapping.create({ data: { requirementId: ids.full, controlId: controlIds[0], coverage: "FULL" } });
    await prisma.requirement.update({
      where: { id: ids.accepted },
      data: { gapAcceptedAt: new Date("2026-01-01T00:00:00Z"), gapAcceptedById: userIds.COMPLIANCE_MANAGER, gapJustification: "Earlier" },
    });
  });

  it("accepts all the picked open gaps with one justification, stamped with the acting user", async () => {
    const response = await accept("COMPLIANCE_MANAGER", { requirementIds: [ids.none, ids.partial, ids.none2], justification: "  Out of scope  " });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ accepted: 3 });
    for (const code of ["none", "partial", "none2"]) {
      const row = await acceptance(code);
      expect(row.gapJustification).toBe("Out of scope");
      expect(row.gapAcceptedById).toBe(userIds.COMPLIANCE_MANAGER);
      expect(row.gapAcceptedAt).not.toBeNull();
    }
    // Untouched: the covered one, the previously accepted one.
    expect((await acceptance("full")).gapAcceptedAt).toBeNull();
    expect((await acceptance("accepted")).gapJustification).toBe("Earlier");
  });

  it("lets an Admin do it too", async () => {
    const response = await accept("ADMIN", { requirementIds: [ids.none], justification: "Admin says so" });
    expect(response.status).toBe(200);
    expect((await acceptance("none")).gapAcceptedById).toBe(userIds.ADMIN);
  });

  it("records no Change Event, like the single acceptance", async () => {
    const before = await events();
    await accept("COMPLIANCE_MANAGER", { requirementIds: [ids.none], justification: "x" });
    expect(await events()).toBe(before);
  });

  it("refuses every other role and a missing user, and changes nothing", async () => {
    for (const role of ROLES.filter((r) => r !== "ADMIN" && r !== "COMPLIANCE_MANAGER")) {
      expect((await accept(role, { requirementIds: [ids.none], justification: "x" })).status).toBe(403);
    }
    expect((await accept(null, { requirementIds: [ids.none], justification: "x" })).status).toBe(401);
    expect((await acceptance("none")).gapAcceptedAt).toBeNull();
  });

  it("rejects a malformed body with 400 and changes nothing", async () => {
    const bad = [
      {},
      { requirementIds: [], justification: "x" },
      { requirementIds: [ids.none] },
      { requirementIds: [ids.none], justification: "   " },
      { requirementIds: [ids.none, ids.none], justification: "x" },
      { requirementIds: "nope", justification: "x" },
    ];
    for (const body of bad) expect((await accept("COMPLIANCE_MANAGER", body)).status).toBe(400);
    expect((await acceptance("none")).gapAcceptedAt).toBeNull();
  });

  it("is all or nothing: a covered Requirement among the picked is a 409 and nothing is accepted", async () => {
    const response = await accept("COMPLIANCE_MANAGER", { requirementIds: [ids.none, ids.full, ids.partial], justification: "x" });
    expect(response.status).toBe(409);
    for (const code of ["none", "partial", "full"]) expect((await acceptance(code)).gapAcceptedAt).toBeNull();
  });

  it("is all or nothing: an already accepted gap among the picked is a 409 and keeps the earlier justification", async () => {
    const response = await accept("COMPLIANCE_MANAGER", { requirementIds: [ids.none, ids.accepted], justification: "New" });
    expect(response.status).toBe(409);
    expect((await acceptance("none")).gapAcceptedAt).toBeNull();
    expect((await acceptance("accepted")).gapJustification).toBe("Earlier");
  });

  it("is all or nothing: an unknown id, or one of another Framework, is a 404 and nothing is accepted", async () => {
    for (const stray of ["does-not-exist", otherRequirementId]) {
      const response = await accept("COMPLIANCE_MANAGER", { requirementIds: [ids.none, stray], justification: "x" });
      expect(response.status).toBe(404);
      expect((await acceptance("none")).gapAcceptedAt).toBeNull();
    }
    expect((await prisma.requirement.findUniqueOrThrow({ where: { id: otherRequirementId } })).gapAcceptedAt).toBeNull();
  });

  it("is a 404 for a Framework that does not exist", async () => {
    expect((await accept("COMPLIANCE_MANAGER", { requirementIds: [ids.none], justification: "x" }, "no-such-framework")).status).toBe(404);
    expect((await acceptance("none")).gapAcceptedAt).toBeNull();
  });
});
