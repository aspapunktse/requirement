import { NextRequest } from "next/server";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ACTING_USER_COOKIE } from "@/lib/acting-user";
import { saveSystemDetails } from "@/lib/system-details";
import { PATCH } from "../details/route";

const EMAIL = (key: string) => `test-246-${key}@example.com`;
const ROLES: Record<string, UserRole> = {
  owner: "SYSTEM_OWNER",
  other: "SYSTEM_OWNER",
  admin: "ADMIN",
  reviewer: "REVIEWER",
  compliance: "COMPLIANCE_MANAGER",
  auditor: "INTERNAL_AUDITOR",
};

function requestAs(id: string, userId: string | null, body?: unknown, raw?: string) {
  const headers = new Headers({ "Content-Type": "application/json" });
  if (userId) headers.set("cookie", `${ACTING_USER_COOKIE}=${userId}`);
  return new NextRequest(`http://localhost/api/systems/${id}/details`, {
    method: "PATCH",
    headers,
    body: raw ?? (body !== undefined ? JSON.stringify(body) : undefined),
  });
}

const ctxFor = (id: string) => ({ params: Promise.resolve({ id }) });

describe("PATCH /api/systems/[id]/details (#246)", () => {
  const users: Record<string, string> = {};
  let systemId: string;

  beforeAll(async () => {
    for (const [key, role] of Object.entries(ROLES)) {
      const user = await prisma.user.upsert({
        where: { email: EMAIL(key) },
        update: {},
        create: { email: EMAIL(key), name: `Test #246 ${key}`, role },
      });
      users[key] = user.id;
    }
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { in: Object.keys(ROLES).map(EMAIL) } } });
  });

  beforeEach(async () => {
    const system = await prisma.system.create({
      data: { name: "Test #246 System", vendor: "Test #246 Vendor", description: "Test #246 description", ownerId: users.owner, status: "ONBOARDED" },
    });
    systemId = system.id;
  });

  afterEach(async () => {
    await prisma.changeEvent.deleteMany({ where: { systemId } });
    await prisma.system.deleteMany({ where: { id: systemId } });
  });

  const events = () => prisma.changeEvent.findMany({ where: { systemId, action: "SYSTEM_DETAILS_CHANGED" } });
  const row = () => prisma.system.findUniqueOrThrow({ where: { id: systemId } });

  async function expectUnchanged() {
    const system = await row();
    expect(system.name).toBe("Test #246 System");
    expect(system.vendor).toBe("Test #246 Vendor");
    expect(system.description).toBe("Test #246 description");
    expect(await events()).toHaveLength(0);
  }

  it("rejects an unauthenticated request", async () => {
    const response = await PATCH(requestAs(systemId, null, { name: "X" }), ctxFor(systemId));
    expect(response.status).toBe(401);
    await expectUnchanged();
  });

  it.each(["owner", "admin"])("lets the %s edit and records exactly one Change Event with old and new values", async (who) => {
    const response = await PATCH(
      requestAs(systemId, users[who], { name: "  Test #246 Renamed  ", vendor: "Acme", description: "New text" }),
      ctxFor(systemId),
    );
    expect(response.status).toBe(200);
    expect((await response.json()).system).toMatchObject({ id: systemId, name: "Test #246 Renamed", vendor: "Acme", description: "New text" });

    const system = await row();
    expect(system).toMatchObject({ name: "Test #246 Renamed", vendor: "Acme", description: "New text", status: "ONBOARDED" });
    const logged = await events();
    expect(logged).toHaveLength(1);
    expect(logged[0].actorId).toBe(users[who]);
    expect(logged[0].detail).toBe(
      'Name: "Test #246 System" → "Test #246 Renamed"; Vendor: "Test #246 Vendor" → "Acme"; Description: "Test #246 description" → "New text"',
    );
  });

  it("changes only the fields sent and names only those in the detail", async () => {
    const response = await PATCH(requestAs(systemId, users.owner, { vendor: "Acme" }), ctxFor(systemId));
    expect(response.status).toBe(200);
    expect(await row()).toMatchObject({ name: "Test #246 System", vendor: "Acme", description: "Test #246 description" });
    const logged = await events();
    expect(logged).toHaveLength(1);
    expect(logged[0].detail).toBe('Vendor: "Test #246 Vendor" → "Acme"');
  });

  it("stores an empty vendor and description as null (Built in-house) and says Not set in the detail", async () => {
    const response = await PATCH(requestAs(systemId, users.owner, { vendor: "   ", description: "" }), ctxFor(systemId));
    expect(response.status).toBe(200);
    expect(await row()).toMatchObject({ vendor: null, description: null });
    expect((await events())[0].detail).toBe('Vendor: "Test #246 Vendor" → Not set; Description: "Test #246 description" → Not set');
  });

  it("accepts null to clear the vendor", async () => {
    const response = await PATCH(requestAs(systemId, users.owner, { vendor: null }), ctxFor(systemId));
    expect(response.status).toBe(200);
    expect((await row()).vendor).toBeNull();
  });

  it("cuts a long description short in the detail but stores it whole", async () => {
    const long = "word ".repeat(300).trim();
    const response = await PATCH(requestAs(systemId, users.owner, { description: long }), ctxFor(systemId));
    expect(response.status).toBe(200);
    expect((await row()).description).toBe(long);
    const detail = (await events())[0].detail!;
    expect(detail.length).toBeLessThan(300);
    expect(detail).toContain("…");
  });

  it("writes nothing when nothing changed, including after normalising", async () => {
    const response = await PATCH(
      requestAs(systemId, users.owner, { name: " Test #246 System ", vendor: "Test #246 Vendor", description: "Test #246 description" }),
      ctxFor(systemId),
    );
    expect(response.status).toBe(200);
    await expectUnchanged();
  });

  it("does not change the onboarding status of a Draft System either", async () => {
    await prisma.system.update({ where: { id: systemId }, data: { status: "DRAFT" } });
    const response = await PATCH(requestAs(systemId, users.owner, { name: "Test #246 Draft rename" }), ctxFor(systemId));
    expect(response.status).toBe(200);
    expect((await row()).status).toBe("DRAFT");
  });

  it.each(["reviewer", "other", "compliance", "auditor"])("refuses %s with 403 on a System it can see, and changes nothing", async (who) => {
    const response = await PATCH(requestAs(systemId, users[who], { name: "Hijacked" }), ctxFor(systemId));
    expect(response.status).toBe(403);
    await expectUnchanged();
  });

  it("refuses a read-only role even when it is recorded as the System's owner", async () => {
    await prisma.system.update({ where: { id: systemId }, data: { ownerId: users.compliance } });
    const response = await PATCH(requestAs(systemId, users.compliance, { name: "Hijacked" }), ctxFor(systemId));
    expect(response.status).toBe(403);
    expect((await row()).name).toBe("Test #246 System");
    expect(await events()).toHaveLength(0);
  });

  it("is a 404 for a System the user cannot see (another owner's Draft), and changes nothing", async () => {
    await prisma.system.update({ where: { id: systemId }, data: { status: "DRAFT" } });
    const response = await PATCH(requestAs(systemId, users.other, { name: "Hijacked" }), ctxFor(systemId));
    expect(response.status).toBe(404);
    await expectUnchanged();
  });

  it("is a 404 for a System that does not exist", async () => {
    const response = await PATCH(requestAs("nope", users.admin, { name: "X" }), ctxFor("nope"));
    expect(response.status).toBe(404);
  });

  it.each([
    ["an empty name", { name: "" }],
    ["a whitespace-only name", { name: "   " }],
    ["a name over 200 characters", { name: "n".repeat(201) }],
    ["a vendor over 200 characters", { vendor: "v".repeat(201) }],
    ["a description over 2000 characters", { description: "d".repeat(2001) }],
    ["an empty body", {}],
    ["a body with none of the three fields", { owner: "x" }],
    ["a non-string name", { name: 5 }],
  ])("rejects %s with 400 and changes nothing", async (_label, body) => {
    const response = await PATCH(requestAs(systemId, users.owner, body), ctxFor(systemId));
    expect(response.status).toBe(400);
    expect(typeof (await response.json()).error).toBe("string");
    await expectUnchanged();
  });

  it("rejects a body that is not JSON with 400", async () => {
    const response = await PATCH(requestAs(systemId, users.owner, undefined, "not json"), ctxFor(systemId));
    expect(response.status).toBe(400);
    await expectUnchanged();
  });

  it("accepts values exactly at the limits", async () => {
    const response = await PATCH(
      requestAs(systemId, users.owner, { name: "n".repeat(200), vendor: "v".repeat(200), description: "d".repeat(2000) }),
      ctxFor(systemId),
    );
    expect(response.status).toBe(200);
  });

  it("refuses under the lock a former owner whose earlier checks passed (the owner changed in between), and changes nothing", async () => {
    // What the route's first checks would have passed for `owner`, then an Admin hands the System over.
    await prisma.system.update({ where: { id: systemId }, data: { ownerId: users.other } });
    const result = await saveSystemDetails({ id: users.owner, role: "SYSTEM_OWNER" }, systemId, { name: "Stale owner" });
    expect(result.status).toBe(403);
    await expectUnchanged();
    // The new owner still can.
    expect((await saveSystemDetails({ id: users.other, role: "SYSTEM_OWNER" }, systemId, { name: "New owner" })).status).toBe(200);
  });

  it("answers 404 under the lock when the System is gone", async () => {
    const result = await saveSystemDetails({ id: users.admin, role: "ADMIN" }, "gone", { name: "X" });
    expect(result.status).toBe(404);
  });

  it("writes one event for two concurrent identical saves", async () => {
    const send = () => PATCH(requestAs(systemId, users.owner, { name: "Test #246 Same" }), ctxFor(systemId));
    const responses = await Promise.all([send(), send()]);
    expect(responses.map((r) => r.status)).toEqual([200, 200]);
    expect((await row()).name).toBe("Test #246 Same");
    expect(await events()).toHaveLength(1);
  });

  it("records a consistent chain for two concurrent different renames", async () => {
    const rename = (name: string) => PATCH(requestAs(systemId, users.owner, { name }), ctxFor(systemId));
    const responses = await Promise.all([rename("Test #246 B"), rename("Test #246 C")]);
    expect(responses.map((r) => r.status)).toEqual([200, 200]);
    const logged = (await events()).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    expect(logged).toHaveLength(2);
    const second = /^Name: "(.*)" → "(.*)"$/.exec(logged[1].detail!)!;
    const firstMatch = /^Name: "(.*)" → "(.*)"$/.exec(logged[0].detail!)!;
    expect(firstMatch[1]).toBe("Test #246 System");
    expect(second[1]).toBe(firstMatch[2]);
    expect((await row()).name).toBe(second[2]);
  });
});
