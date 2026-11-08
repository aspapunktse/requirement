import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requestAs } from "@/test/provider-fixtures";
import { POST as changeOwner } from "../../../owner/route";
import { GET as listSystems } from "../../../route";
import { GET as getSystem } from "../../route";
import { PUT } from "../route";

/**
 * A System's Business System Owner (#321, PRD 0002 F-BSO). Self-contained fixtures (CI's DB is migrated, not
 * seeded): Test Users and Test Systems. The Systems are Drafts unless a test needs more, so a user who is
 * neither owner nor Admin can't see them, and a 403 is a real refusal.
 */

const suffix = `${process.pid}-${Date.now()}`;
const KEYS = ["admin", "owner", "otherOwner", "riskOwner", "viewer", "complianceManager", "internalAuditor", "bso", "bsoViewer", "bsoOwner"] as const;
type Key = (typeof KEYS)[number];
const ROLE: Record<Key, UserRole> = {
  admin: "ADMIN",
  owner: "SYSTEM_OWNER",
  otherOwner: "SYSTEM_OWNER",
  riskOwner: "RISK_OWNER",
  viewer: "VIEWER",
  complianceManager: "COMPLIANCE_MANAGER",
  internalAuditor: "INTERNAL_AUDITOR",
  bso: "REVIEWER",
  bsoViewer: "VIEWER",
  bsoOwner: "SYSTEM_OWNER",
};
const users = {} as Record<Key, string>;
const systemIds: string[] = [];

beforeAll(async () => {
  for (const key of KEYS) {
    users[key] = (await prisma.user.create({ data: { email: `test-bso-${key}-${suffix}@example.com`, name: `Test Bso ${key}`, role: ROLE[key] } })).id;
  }
});

afterAll(async () => {
  // Change Events cascade with the System.
  await prisma.system.deleteMany({ where: { id: { in: systemIds } } });
  await prisma.user.deleteMany({ where: { id: { in: Object.values(users) } } });
});

async function makeSystem(ownerId: string, options: { status?: "ONBOARDED" | "DRAFT"; bso?: string } = {}) {
  const system = await prisma.system.create({
    data: { name: `Test Bso System ${suffix}-${systemIds.length}`, ownerId, status: options.status ?? "DRAFT", businessSystemOwnerId: options.bso },
  });
  systemIds.push(system.id);
  return system.id;
}

const put = (userId: string | null, id: string, body: unknown) =>
  PUT(requestAs(`/api/systems/${id}/business-system-owner`, userId, "PUT", body), { params: Promise.resolve({ id }) });
const bsoOf = async (id: string) => (await prisma.system.findUniqueOrThrow({ where: { id } })).businessSystemOwnerId;
const events = (id: string) => prisma.changeEvent.findMany({ where: { systemId: id, action: "BUSINESS_SYSTEM_OWNER_CHANGED" } });
const idsOf = async (userId: string) =>
  ((await (await listSystems(requestAs("/api/systems", userId, "GET"))).json()).systems as { id: string }[]).map((s) => s.id);

describe("PUT /api/systems/[id]/business-system-owner (#321)", { timeout: 30_000 }, () => {
  it("lets the owner set the Business System Owner, with one Change Event naming old and new", async () => {
    const id = await makeSystem(users.owner);

    const response = await put(users.owner, id, { businessSystemOwnerId: users.bso });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ changed: true, businessSystemOwner: { id: users.bso, name: "Test Bso bso" } });
    expect(await bsoOf(id)).toBe(users.bso);
    const written = await events(id);
    expect(written).toHaveLength(1);
    expect(written[0]).toMatchObject({ actorId: users.owner, systemId: id });
    expect(written[0].detail).toContain("from none to Test Bso bso");

    expect((await put(users.owner, id, { businessSystemOwnerId: users.bsoViewer })).status).toBe(200);
    expect(await bsoOf(id)).toBe(users.bsoViewer);
    const all = await events(id);
    expect(all).toHaveLength(2);
    expect(all.map((event) => event.detail)).toContain("Business System Owner changed from Test Bso bso to Test Bso bsoViewer");
  });

  it("lets an Admin who is not the owner change it, on a System in any status", async () => {
    for (const status of ["DRAFT", "ONBOARDED"] as const) {
      const id = await makeSystem(users.owner, { status });
      expect((await put(users.admin, id, { businessSystemOwnerId: users.bso })).status).toBe(200);
      expect(await bsoOf(id)).toBe(users.bso);
      expect((await events(id))[0].actorId).toBe(users.admin);
    }
  });

  it("lets the owner clear it, with an event; clearing when none is set writes nothing", async () => {
    const id = await makeSystem(users.owner, { bso: users.bso });
    const response = await put(users.owner, id, { businessSystemOwnerId: null });
    expect(response.status).toBe(200);
    expect(await bsoOf(id)).toBeNull();
    const written = await events(id);
    expect(written).toHaveLength(1);
    expect(written[0].detail).toContain("from Test Bso bso to none");

    expect(((await (await put(users.owner, id, { businessSystemOwnerId: null })).json()) as { changed: boolean }).changed).toBe(false);
    expect(await events(id)).toHaveLength(1);
  });

  it("writes no Change Event when the same Business System Owner is saved again", async () => {
    const id = await makeSystem(users.owner, { bso: users.bso });
    const response = await put(users.owner, id, { businessSystemOwnerId: users.bso });
    expect(response.status).toBe(200);
    expect((await response.json()).changed).toBe(false);
    expect(await bsoOf(id)).toBe(users.bso);
    expect(await events(id)).toEqual([]);
  });

  it.each(["otherOwner", "riskOwner", "viewer", "complianceManager", "internalAuditor", "bso", "bsoViewer"] as const)(
    "refuses a %s who is not the owner with 403 and changes nothing",
    async (key) => {
      const id = await makeSystem(users.owner, { status: "ONBOARDED", bso: key === "bso" || key === "bsoViewer" ? users[key] : undefined });
      const before = await bsoOf(id);

      const response = await put(users[key], id, { businessSystemOwnerId: users[key] });

      expect(response.status).toBe(403);
      expect(await bsoOf(id)).toBe(before);
      expect(await events(id)).toEqual([]);
    },
  );

  it("refuses the same way a System the actor can't see and one that doesn't exist", async () => {
    const draft = await makeSystem(users.owner);
    const hidden = await put(users.otherOwner, draft, { businessSystemOwnerId: users.bso });
    const missing = await put(users.otherOwner, "no-such-system", { businessSystemOwnerId: users.bso });
    expect(hidden.status).toBe(403);
    expect(missing.status).toBe(403);
    expect(await hidden.json()).toEqual(await missing.json());
    expect(await bsoOf(draft)).toBeNull();
  });

  it("refuses a read-only role recorded as the owner", async () => {
    const id = await makeSystem(users.complianceManager);
    expect((await put(users.complianceManager, id, { businessSystemOwnerId: users.bso })).status).toBe(403);
    expect(await bsoOf(id)).toBeNull();
    expect(await events(id)).toEqual([]);
  });

  it("answers 401 when nobody is signed in", async () => {
    const id = await makeSystem(users.owner);
    expect((await put(null, id, { businessSystemOwnerId: users.bso })).status).toBe(401);
    expect(await bsoOf(id)).toBeNull();
  });

  it("refuses the System's owner as Business System Owner with 400 and changes nothing", async () => {
    const id = await makeSystem(users.owner, { bso: users.bso });
    for (const actor of [users.owner, users.admin]) {
      const response = await put(actor, id, { businessSystemOwnerId: users.owner });
      expect(response.status).toBe(400);
      expect((await response.json()).error).toMatch(/can't be the System's owner/);
    }
    expect(await bsoOf(id)).toBe(users.bso);
    expect(await events(id)).toEqual([]);
  });

  it("refuses a user who doesn't exist and a malformed body with 400, changing nothing", async () => {
    const id = await makeSystem(users.owner, { bso: users.bso });
    for (const body of [{ businessSystemOwnerId: "no-such-user" }, {}, { businessSystemOwnerId: "" }, { businessSystemOwnerId: 5 }, null]) {
      expect((await put(users.owner, id, body)).status).toBe(400);
    }
    expect(await bsoOf(id)).toBe(users.bso);
    expect(await events(id)).toEqual([]);
  });

  it("accepts a user of any role, a Viewer and a Compliance Manager included", async () => {
    for (const key of ["viewer", "complianceManager", "internalAuditor", "riskOwner"] as const) {
      const id = await makeSystem(users.owner);
      expect((await put(users.owner, id, { businessSystemOwnerId: users[key] })).status).toBe(200);
      expect(await bsoOf(id)).toBe(users[key]);
    }
  });
});

describe("what the Business System Owner can see and do (#321, F-BSO.3)", { timeout: 30_000 }, () => {
  it("shows a Draft System in the list and opens it for a Viewer and for a System Owner who doesn't own it, until replaced", async () => {
    for (const key of ["bsoViewer", "bsoOwner"] as const) {
      const id = await makeSystem(users.owner, { status: "DRAFT" });
      expect(await idsOf(users[key])).not.toContain(id);
      const opened = () => getSystem(requestAs(`/api/systems/${id}`, users[key], "GET"), { params: Promise.resolve({ id }) });
      expect((await opened()).status).toBe(404);

      expect((await put(users.owner, id, { businessSystemOwnerId: users[key] })).status).toBe(200);
      expect(await idsOf(users[key])).toContain(id);
      expect((await opened()).status).toBe(200);

      expect((await put(users.owner, id, { businessSystemOwnerId: users.bso })).status).toBe(200);
      expect(await idsOf(users[key])).not.toContain(id);
      expect((await opened()).status).toBe(404);
    }
  });

  it("gives the Business System Owner visibility only: no write rights on the System", async () => {
    const id = await makeSystem(users.owner, { status: "DRAFT", bso: users.bsoOwner });
    // Can't change the Business System Owner, nor the owner.
    expect((await put(users.bsoOwner, id, { businessSystemOwnerId: null })).status).toBe(403);
    expect((await changeOwner(requestAs("/api/systems/owner", users.bsoOwner, "POST", { systemIds: [id], ownerId: users.bsoOwner }))).status).toBe(403);
    expect(await bsoOf(id)).toBe(users.bsoOwner);
    expect((await prisma.system.findUniqueOrThrow({ where: { id } })).ownerId).toBe(users.owner);
  });
});

describe("changing the owner to the Business System Owner (#321)", { timeout: 30_000 }, () => {
  const change = (userId: string, ids: string[], ownerId: string) =>
    changeOwner(requestAs("/api/systems/owner", userId, "POST", { systemIds: ids, ownerId }));
  const ownerOf = async (id: string) => (await prisma.system.findUniqueOrThrow({ where: { id } })).ownerId;
  const ownerEvents = (ids: string[]) => prisma.changeEvent.findMany({ where: { systemId: { in: ids }, action: "SYSTEM_OWNER_CHANGED" } });

  it("refuses a single System with 400, naming it, and changes nothing", async () => {
    const id = await makeSystem(users.owner, { bso: users.bsoOwner });
    const response = await change(users.owner, [id], users.bsoOwner);
    expect(response.status).toBe(400);
    expect((await response.json()).refusedIds).toEqual([id]);
    expect(await ownerOf(id)).toBe(users.owner);
    expect(await ownerEvents([id])).toEqual([]);
  });

  it("refuses the whole bulk change when one selected System has that user as Business System Owner", async () => {
    const fine = await makeSystem(users.owner);
    const blocked = await makeSystem(users.owner, { bso: users.bsoOwner });
    const response = await change(users.admin, [fine, blocked], users.bsoOwner);
    expect(response.status).toBe(400);
    expect((await response.json()).refusedIds).toEqual([blocked]);
    expect(await ownerOf(fine)).toBe(users.owner);
    expect(await ownerOf(blocked)).toBe(users.owner);
    expect(await ownerEvents([fine, blocked])).toEqual([]);
  });

  it("still allows the change when the Business System Owner is someone else", async () => {
    const id = await makeSystem(users.owner, { bso: users.bso });
    expect((await change(users.owner, [id], users.bsoOwner)).status).toBe(200);
    expect(await ownerOf(id)).toBe(users.bsoOwner);
  });
});

describe("a concurrent owner change and Business System Owner change (#321)", { timeout: 30_000 }, () => {
  const settle = (ms = 400) => new Promise((resolve) => setTimeout(resolve, ms));
  const state = (promise: Promise<unknown>) => Promise.race([promise.then(() => "done"), settle().then(() => "pending")]);

  it("never leaves one person as owner and Business System Owner: the BSO change loses to an owner change in flight (409)", async () => {
    const id = await makeSystem(users.owner);
    let release!: () => void;
    const hold = new Promise<void>((resolve) => (release = resolve));
    // Request B: hands the System to the would-be BSO, holding the row lock before it commits.
    const handingOver = prisma.$transaction(
      async (tx) => {
        await tx.system.update({ where: { id }, data: { ownerId: users.bsoOwner } });
        await hold;
      },
      { timeout: 20_000 },
    );
    await settle(150);
    // Request A reads owner = the old owner, then waits on the row lock.
    const setting = put(users.admin, id, { businessSystemOwnerId: users.bsoOwner });
    expect(await state(setting)).toBe("pending");
    release();
    await handingOver;

    const response = await setting;
    expect(response.status).toBe(409);
    const system = await prisma.system.findUniqueOrThrow({ where: { id } });
    expect(system.ownerId).toBe(users.bsoOwner);
    expect(system.businessSystemOwnerId).toBeNull();
    expect(await events(id)).toEqual([]);
  });

  it("an owner change loses to a Business System Owner change in flight (409), the other way round", async () => {
    const id = await makeSystem(users.owner);
    let release!: () => void;
    const hold = new Promise<void>((resolve) => (release = resolve));
    const setting = prisma.$transaction(
      async (tx) => {
        await tx.system.update({ where: { id }, data: { businessSystemOwnerId: users.bsoOwner } });
        await hold;
      },
      { timeout: 20_000 },
    );
    await settle(150);
    const handingOver = changeOwner(requestAs("/api/systems/owner", users.admin, "POST", { systemIds: [id], ownerId: users.bsoOwner }));
    expect(await state(handingOver)).toBe("pending");
    release();
    await setting;

    const response = await handingOver;
    expect(response.status).toBe(409);
    const system = await prisma.system.findUniqueOrThrow({ where: { id } });
    expect(system.ownerId).toBe(users.owner);
    expect(system.businessSystemOwnerId).toBe(users.bsoOwner);
    expect(await prisma.changeEvent.count({ where: { systemId: id, action: "SYSTEM_OWNER_CHANGED" } })).toBe(0);
  });
});
