import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { CHANGE_EVENT_ACTION_LABEL } from "@/lib/change-event-labels";
import { loadRecentActivity } from "../home-activity";

const DAY = 86_400_000;

describe("Recent activity on /home (#226)", () => {
  const suffix = `${process.pid}-${Date.now()}`;
  // Our events sit just in the future of every other test's, so "newest 8" can never crowd them out.
  const base = Date.now() + 600_000;
  const now = new Date(base + 60_000);
  const emails: string[] = [];
  const systemIds: string[] = [];
  const eventIds: Record<string, string> = {};
  const users = {} as Record<string, { id: string; role: UserRole }>;
  let unitId: string;

  async function makeUser(key: string, role: UserRole, extra: Record<string, unknown> = {}) {
    const email = `test-home-act-${key}-${suffix}@example.com`;
    emails.push(email);
    const user = await prisma.user.create({ data: { email, name: `Test Act ${key}`, role, ...extra } });
    users[key] = user;
    return user;
  }

  async function makeEvent(key: string, systemId: string | null, actorId: string, createdAt: Date, action: "SYSTEM_SUBMITTED" | "ORGANIZATION_IMPLEMENTATION_CHANGED" = "SYSTEM_SUBMITTED") {
    const event = await prisma.changeEvent.create({ data: { systemId, action, detail: `Test activity ${key} ${suffix}`, actorId, createdAt } });
    eventIds[key] = event.id;
  }

  const seen = async (key: string) =>
    (await loadRecentActivity(users[key], now)).filter((item) => Object.values(eventIds).includes(item.id)).map((item) => Object.keys(eventIds).find((k) => eventIds[k] === item.id));

  beforeAll(async () => {
    const unit = await prisma.businessUnit.create({ data: { name: `Test Act Unit ${suffix}` } });
    unitId = unit.id;
    const ownerA = await makeUser("ownerA", "SYSTEM_OWNER");
    const ownerB = await makeUser("ownerB", "SYSTEM_OWNER");
    await makeUser("viewer", "VIEWER");
    await makeUser("reviewer", "REVIEWER");
    await makeUser("admin", "ADMIN");
    await makeUser("manager", "COMPLIANCE_MANAGER");
    await makeUser("auditor", "INTERNAL_AUDITOR");
    await makeUser("bro", "BUSINESS_RISK_OWNER", { businessUnitScopes: { connect: [{ id: unit.id }] } });

    const mine = await prisma.system.create({ data: { name: `Test Act mine ${suffix}`, ownerId: ownerA.id } });
    const onboarded = await prisma.system.create({ data: { name: `Test Act onboarded ${suffix}`, ownerId: ownerB.id, status: "ONBOARDED" } });
    const hidden = await prisma.system.create({ data: { name: `Test Act hidden ${suffix}`, ownerId: ownerB.id, businessUnits: { connect: [{ id: unit.id }] } } });
    systemIds.push(mine.id, onboarded.id, hidden.id);

    await makeEvent("mine", mine.id, ownerA.id, new Date(base - 4000));
    await makeEvent("onboarded", onboarded.id, ownerB.id, new Date(base - 3000));
    await makeEvent("hidden", hidden.id, "system", new Date(base - 2000));
    await makeEvent("catalog", null, ownerB.id, new Date(base - 1000), "ORGANIZATION_IMPLEMENTATION_CHANGED");
    await makeEvent("old", onboarded.id, ownerB.id, new Date(now.getTime() - 20 * DAY));
  });

  afterAll(async () => {
    await prisma.changeEvent.deleteMany({ where: { detail: { contains: suffix } } });
    await prisma.system.deleteMany({ where: { id: { in: systemIds } } });
    await prisma.user.deleteMany({ where: { email: { in: emails } } });
    await prisma.businessUnit.deleteMany({ where: { id: unitId } });
  });

  it("shows a System Owner the events of the Systems it owns and of Onboarded ones, newest first, never the catalog's", async () => {
    expect(await seen("ownerA")).toEqual(["onboarded", "mine"]);
  });

  it("shows a Viewer only what is Onboarded", async () => {
    expect(await seen("viewer")).toEqual(["onboarded"]);
  });

  it("shows a Reviewer every System's events but not the System-less ones", async () => {
    expect(await seen("reviewer")).toEqual(["hidden", "onboarded", "mine"]);
  });

  it("shows a Business Risk Owner the Systems in its scope and the Onboarded ones", async () => {
    expect(await seen("bro")).toEqual(["hidden", "onboarded"]);
  });

  it.each(["admin", "manager", "auditor"])("shows the %s the System-less events too", async (key) => {
    expect(await seen(key)).toEqual(["catalog", "hidden", "onboarded", "mine"]);
  });

  it("leaves out events older than two weeks", async () => {
    for (const key of ["admin", "reviewer", "viewer"]) expect(await seen(key)).not.toContain("old");
  });

  it("names the actor, the action in words and the System with a link", async () => {
    const admin = (await loadRecentActivity(users.admin, now)).filter((item) => Object.values(eventIds).includes(item.id));
    const byId = (key: string) => admin.find((item) => item.id === eventIds[key])!;
    expect(byId("onboarded")).toMatchObject({ who: "Test Act ownerB", what: CHANGE_EVENT_ACTION_LABEL.SYSTEM_SUBMITTED, target: `Test Act onboarded ${suffix}`, days: 0 });
    expect(byId("onboarded").href).toMatch(/^\/systems\//);
    expect(byId("hidden").who).toBe("The system");
    expect(byId("catalog")).toMatchObject({ what: CHANGE_EVENT_ACTION_LABEL.ORGANIZATION_IMPLEMENTATION_CHANGED });
    expect(byId("catalog").target).toBeUndefined();
    const own = (await loadRecentActivity(users.ownerA, now)).find((item) => item.id === eventIds.mine);
    expect(own?.who).toBe("You");
  });

  it("returns at most eight", async () => {
    expect((await loadRecentActivity(users.admin, now)).length).toBeLessThanOrEqual(8);
  });
});
