import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requestAs } from "@/test/provider-fixtures";
import { POST } from "../route";

/**
 * Changing a System's owner, single and bulk (#233). Self-contained fixtures (CI's DB is migrated, not
 * seeded): Test Users and Onboarded Test Systems, so every role sees them and a 403 is a real refusal.
 */

const suffix = `${process.pid}-${Date.now()}`;
const KEYS = ["admin", "owner", "otherOwner", "riskOwner", "reviewer", "viewer", "complianceManager", "internalAuditor", "businessRiskOwner"] as const;
const ROLE: Record<(typeof KEYS)[number], UserRole> = {
  admin: "ADMIN",
  owner: "SYSTEM_OWNER",
  otherOwner: "SYSTEM_OWNER",
  riskOwner: "RISK_OWNER",
  reviewer: "REVIEWER",
  viewer: "VIEWER",
  complianceManager: "COMPLIANCE_MANAGER",
  internalAuditor: "INTERNAL_AUDITOR",
  businessRiskOwner: "BUSINESS_RISK_OWNER",
};
const users = {} as Record<(typeof KEYS)[number], string>;
const systemIds: string[] = [];

beforeAll(async () => {
  for (const key of KEYS) {
    users[key] = (
      await prisma.user.create({ data: { email: `test-owner-${key}-${suffix}@example.com`, name: `Test Owner ${key}`, role: ROLE[key] } })
    ).id;
  }
});

afterAll(async () => {
  // Change Events cascade with the System.
  await prisma.system.deleteMany({ where: { id: { in: systemIds } } });
  await prisma.user.deleteMany({ where: { id: { in: Object.values(users) } } });
});

async function makeSystem(ownerId: string, status: "ONBOARDED" | "DRAFT" = "ONBOARDED") {
  const system = await prisma.system.create({
    data: { name: `Test Owner System ${suffix}-${systemIds.length}`, ownerId, status },
  });
  systemIds.push(system.id);
  return system.id;
}

const change = (userId: string | null, body: unknown) => POST(requestAs("/api/systems/owner", userId, "POST", body));
const ownerOf = async (id: string) => (await prisma.system.findUniqueOrThrow({ where: { id } })).ownerId;
const events = (ids: string[]) => prisma.changeEvent.findMany({ where: { systemId: { in: ids }, action: "SYSTEM_OWNER_CHANGED" } });

describe("POST /api/systems/owner (#233)", { timeout: 30_000 }, () => {
  it("lets the current owner hand the System over, with one Change Event", async () => {
    const id = await makeSystem(users.owner);

    const response = await change(users.owner, { systemIds: [id], ownerId: users.otherOwner });

    expect(response.status).toBe(200);
    expect((await response.json()).changed).toEqual([expect.objectContaining({ id })]);
    expect(await ownerOf(id)).toBe(users.otherOwner);
    const written = await events([id]);
    expect(written).toHaveLength(1);
    expect(written[0]).toMatchObject({ actorId: users.owner, systemId: id });
    expect(written[0].detail).toContain("Test Owner owner");
    expect(written[0].detail).toContain("Test Owner otherOwner");
  });

  it("lets an Admin who is not the owner change it, at any Onboarding Status", async () => {
    const id = await makeSystem(users.owner, "DRAFT");
    const response = await change(users.admin, { systemIds: [id], ownerId: users.riskOwner });
    expect(response.status).toBe(200);
    expect(await ownerOf(id)).toBe(users.riskOwner);
    expect((await events([id]))[0].actorId).toBe(users.admin);
  });

  it("lets an Admin become the new owner", async () => {
    const id = await makeSystem(users.owner);
    expect((await change(users.admin, { systemIds: [id], ownerId: users.admin })).status).toBe(200);
    expect(await ownerOf(id)).toBe(users.admin);
  });

  it.each(["otherOwner", "riskOwner", "reviewer", "viewer", "complianceManager", "internalAuditor", "businessRiskOwner"] as const)(
    "refuses a %s who is not the owner with 403 and changes nothing",
    async (key) => {
      const id = await makeSystem(users.owner);

      const response = await change(users[key], { systemIds: [id], ownerId: users[key] });

      expect(response.status).toBe(403);
      expect((await response.json()).refusedIds).toEqual([id]);
      expect(await ownerOf(id)).toBe(users.owner);
      expect(await events([id])).toEqual([]);
    },
  );

  it("refuses a read-only role recorded as the owner", async () => {
    const id = await makeSystem(users.complianceManager);
    const response = await change(users.complianceManager, { systemIds: [id], ownerId: users.owner });
    expect(response.status).toBe(403);
    expect(await ownerOf(id)).toBe(users.complianceManager);
    expect(await events([id])).toEqual([]);
  });

  it("answers 401 when nobody is signed in", async () => {
    const id = await makeSystem(users.owner);
    expect((await change(null, { systemIds: [id], ownerId: users.otherOwner })).status).toBe(401);
    expect(await ownerOf(id)).toBe(users.owner);
  });

  it.each(["reviewer", "viewer", "complianceManager", "internalAuditor", "businessRiskOwner"] as const)(
    "refuses a new owner who is a %s with 400 and changes nothing",
    async (key) => {
      const id = await makeSystem(users.owner);
      const response = await change(users.owner, { systemIds: [id], ownerId: users[key] });
      expect(response.status).toBe(400);
      expect(await ownerOf(id)).toBe(users.owner);
      expect(await events([id])).toEqual([]);
    },
  );

  it("refuses an unknown new owner with 400", async () => {
    const id = await makeSystem(users.owner);
    expect((await change(users.owner, { systemIds: [id], ownerId: "no-such-user" })).status).toBe(400);
    expect(await ownerOf(id)).toBe(users.owner);
  });

  it("refuses a malformed body or an empty selection with 400", async () => {
    expect((await change(users.admin, { systemIds: [], ownerId: users.owner })).status).toBe(400);
    expect((await change(users.admin, { ownerId: users.owner })).status).toBe(400);
    expect((await change(users.admin, { systemIds: ["x"] })).status).toBe(400);
  });

  describe("in bulk", () => {
    it("changes every System, one Change Event each", async () => {
      const ids = [await makeSystem(users.owner), await makeSystem(users.owner), await makeSystem(users.owner)];
      const response = await change(users.owner, { systemIds: ids, ownerId: users.riskOwner });
      expect(response.status).toBe(200);
      for (const id of ids) expect(await ownerOf(id)).toBe(users.riskOwner);
      expect(await events(ids)).toHaveLength(3);
    });

    it("changes none when one System is one the user may not change", async () => {
      const mine = await makeSystem(users.owner);
      const theirs = await makeSystem(users.otherOwner);

      const response = await change(users.owner, { systemIds: [mine, theirs], ownerId: users.riskOwner });

      expect(response.status).toBe(403);
      expect((await response.json()).refusedIds).toEqual([theirs]);
      expect(await ownerOf(mine)).toBe(users.owner);
      expect(await ownerOf(theirs)).toBe(users.otherOwner);
      expect(await events([mine, theirs])).toEqual([]);
    });

    it("refuses an unknown id and changes none, naming it like any refused System", async () => {
      const mine = await makeSystem(users.owner);
      const response = await change(users.owner, { systemIds: [mine, "no-such-system"], ownerId: users.riskOwner });
      expect(response.status).toBe(403);
      expect((await response.json()).refusedIds).toEqual(["no-such-system"]);
      expect(await ownerOf(mine)).toBe(users.owner);
      expect(await events([mine])).toEqual([]);
    });

    it("treats a System the user can't see like an unknown one", async () => {
      const hidden = await makeSystem(users.otherOwner, "DRAFT");
      const response = await change(users.owner, { systemIds: [hidden], ownerId: users.owner });
      expect(response.status).toBe(403);
      expect(await ownerOf(hidden)).toBe(users.otherOwner);
    });

    it("lets an Admin change Systems of several owners at once", async () => {
      const ids = [await makeSystem(users.owner), await makeSystem(users.otherOwner)];
      expect((await change(users.admin, { systemIds: ids, ownerId: users.riskOwner })).status).toBe(200);
      expect(await Promise.all(ids.map(ownerOf))).toEqual([users.riskOwner, users.riskOwner]);
      expect(await events(ids)).toHaveLength(2);
    });

    it("leaves a System already owned by the new owner alone, with no event", async () => {
      const already = await makeSystem(users.otherOwner);
      const other = await makeSystem(users.admin);

      const response = await change(users.admin, { systemIds: [already, other], ownerId: users.otherOwner });

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.changed.map((s: { id: string }) => s.id)).toEqual([other]);
      expect(body.unchanged.map((s: { id: string }) => s.id)).toEqual([already]);
      expect(await events([already])).toEqual([]);
      expect(await events([other])).toHaveLength(1);
    });

    it("counts a repeated id once", async () => {
      const id = await makeSystem(users.owner);
      expect((await change(users.owner, { systemIds: [id, id], ownerId: users.riskOwner })).status).toBe(200);
      expect(await events([id])).toHaveLength(1);
    });
  });
});
