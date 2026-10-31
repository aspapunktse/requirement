import { NextRequest } from "next/server";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { ACTING_USER_COOKIE } from "@/lib/acting-user";
import { GET, PATCH } from "../route";

/**
 * /api/settings (#240), against real Postgres. A setting is global, so the only value ever committed here is
 * the stale-Draft age at 45 or 50 days, which changes no fixture of another test file's (they use 90-day and
 * fresh Drafts), and `afterEach` deletes the rows and these users' events.
 */
const URL = "http://localhost/api/settings";
const suffix = `${process.pid}-${Date.now()}`;
const KEY = "systems.staleDraftDays";
const PERCENT = "systems.underFulfilledPercent";
const ORG = "organization.name";

describe("/api/settings", () => {
  let adminId: string;
  let viewerId: string;
  let managerId: string;

  beforeAll(async () => {
    adminId = (await prisma.user.create({ data: { email: `test-settings-admin-${suffix}@example.com`, name: "Test Settings Admin", role: "ADMIN" } })).id;
    viewerId = (await prisma.user.create({ data: { email: `test-settings-viewer-${suffix}@example.com`, name: "Test Settings Viewer", role: "VIEWER" } })).id;
    managerId = (await prisma.user.create({ data: { email: `test-settings-manager-${suffix}@example.com`, name: "Test Settings Manager", role: "COMPLIANCE_MANAGER" } })).id;
  });

  const cleanup = async () => {
    await prisma.appSetting.deleteMany({ where: { key: { in: [KEY, PERCENT, ORG] } } });
    await prisma.changeEvent.deleteMany({ where: { actorId: { in: [adminId, viewerId, managerId] } } });
  };
  afterEach(cleanup);
  afterAll(async () => {
    await cleanup();
    await prisma.user.deleteMany({ where: { id: { in: [adminId, viewerId, managerId] } } });
  });

  function requestAs(userId: string | null, init?: { method?: string; body?: string }) {
    const headers = new Headers();
    if (userId) headers.set("cookie", `${ACTING_USER_COOKIE}=${userId}`);
    return new NextRequest(URL, { ...init, headers });
  }
  const patch = (userId: string | null, body: unknown) =>
    PATCH(requestAs(userId, { method: "PATCH", body: typeof body === "string" ? body : JSON.stringify(body) }));
  const events = () => prisma.changeEvent.findMany({ where: { action: "APP_SETTING_CHANGED", actorId: { in: [adminId, viewerId, managerId] } } });
  const rows = () => prisma.appSetting.findMany({ where: { key: { in: [KEY, PERCENT, ORG] } } });
  const expectNothingChanged = async () => {
    expect(await rows()).toEqual([]);
    expect(await events()).toEqual([]);
  };

  it("GET: 401 without a user, 403 for a non-Admin, 200 with every setting for an Admin", async () => {
    expect((await GET(requestAs(null))).status).toBe(401);
    expect((await GET(requestAs(viewerId))).status).toBe(403);
    expect((await GET(requestAs(managerId))).status).toBe(403);
    const response = await GET(requestAs(adminId));
    expect(response.status).toBe(200);
    const { settings } = await response.json();
    expect(settings.map((s: { key: string }) => s.key)).toEqual([KEY, PERCENT, ORG]);
    expect(settings.find((s: { key: string }) => s.key === PERCENT)).toMatchObject({ value: 70, isDefault: true, updatedAt: null });
  });

  it("PATCH: 401 without a user and 403 for a non-Admin, with nothing written", async () => {
    expect((await patch(null, { key: KEY, value: 45 })).status).toBe(401);
    expect((await patch(viewerId, { key: KEY, value: 45 })).status).toBe(403);
    expect((await patch(managerId, { key: KEY, value: 45 })).status).toBe(403);
    await expectNothingChanged();
  });

  it("PATCH: an unknown key is 400 and writes nothing", async () => {
    const response = await patch(adminId, { key: "systems.nope", value: 45 });
    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(/Unknown setting/);
    await expectNothingChanged();
  });

  it.each([
    [KEY, 0],
    [KEY, 366],
    [KEY, -5],
    [KEY, 30.5],
    [KEY, "45"],
    [KEY, null],
    [PERCENT, 0],
    [PERCENT, 101],
    [PERCENT, 70.5],
  ])("PATCH: %s = %j is 400 and writes nothing", async (key, value) => {
    expect((await patch(adminId, { key, value })).status).toBe(400);
    await expectNothingChanged();
  });

  it("PATCH: the Organization name is saved trimmed, can be cleared, and writes a Change Event with the old and new text", async () => {
    const response = await patch(adminId, { key: ORG, value: "  Test Org AB  " });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ changed: true, setting: { key: ORG, value: "Test Org AB", isDefault: false } });
    expect(await rows()).toMatchObject([{ key: ORG, value: "Test Org AB", updatedById: adminId }]);
    expect((await patch(adminId, { key: ORG, value: "Test Org AB" })).status).toBe(200);
    expect(await events()).toHaveLength(1);

    const cleared = await patch(adminId, { key: ORG, value: "   " });
    expect((await cleared.json()).setting).toMatchObject({ value: "" });
    const details = (await events()).map((event) => event.detail);
    expect(details).toHaveLength(2);
    expect(details.some((d) => d.includes('from "" to "Test Org AB"'))).toBe(true);
    expect(details.some((d) => d.includes('from "Test Org AB" to ""'))).toBe(true);
  });

  it("PATCH: an Organization name over 200 characters, or not text, is 400 and writes nothing", async () => {
    expect((await patch(adminId, { key: ORG, value: "x".repeat(201) })).status).toBe(400);
    expect((await patch(adminId, { key: ORG, value: 5 })).status).toBe(400);
    expect((await patch(adminId, { key: ORG, value: null })).status).toBe(400);
    await expectNothingChanged();
    expect((await patch(adminId, { key: ORG, value: "x".repeat(200) })).status).toBe(200);
    expect(await rows()).toHaveLength(1);
  });

  it("PATCH: a non-Admin cannot set the Organization name, and nothing is written", async () => {
    expect((await patch(managerId, { key: ORG, value: "Test Org AB" })).status).toBe(403);
    expect((await patch(null, { key: ORG, value: "Test Org AB" })).status).toBe(401);
    await expectNothingChanged();
  });

  it("PATCH: a body that is not JSON or lacks a key is 400", async () => {
    expect((await patch(adminId, "not json")).status).toBe(400);
    expect((await patch(adminId, { value: 45 })).status).toBe(400);
    await expectNothingChanged();
  });

  it("PATCH: the ranges include both ends", async () => {
    const { schemaOf, definitionOf } = await import("@/lib/app-settings");
    for (const [key, ok, bad] of [
      [KEY, [1, 365], [0, 366]],
      [PERCENT, [1, 100], [0, 101]],
    ] as const) {
      const schema = schemaOf(definitionOf(key));
      for (const value of ok) expect(schema.safeParse(value).success).toBe(true);
      for (const value of bad) expect(schema.safeParse(value).success).toBe(false);
    }
  });

  it("PATCH: an Admin's save stores the value, who and when, and writes one System-less Change Event with the old and new value", async () => {
    const response = await patch(adminId, { key: KEY, value: 45 });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ changed: true, setting: { key: KEY, value: 45, isDefault: false, updatedByName: "Test Settings Admin" } });
    expect(await rows()).toMatchObject([{ key: KEY, value: 45, updatedById: adminId }]);
    const written = await events();
    expect(written).toHaveLength(1);
    expect(written[0]).toMatchObject({ systemId: null, actorId: adminId });
    expect(written[0].detail).toContain(KEY);
    expect(written[0].detail).toContain("from 60 to 45");

    const again = await GET(requestAs(adminId));
    expect((await again.json()).settings.find((s: { key: string }) => s.key === KEY)).toMatchObject({
      value: 45,
      isDefault: false,
      updatedByName: "Test Settings Admin",
    });
  });

  it("PATCH: a second change names the value it replaced; saving the same value again changes nothing and writes no event", async () => {
    await patch(adminId, { key: KEY, value: 45 });
    await patch(adminId, { key: KEY, value: 50 });
    const same = await patch(adminId, { key: KEY, value: 50 });
    expect(same.status).toBe(200);
    expect((await same.json()).changed).toBe(false);
    const details = (await events()).map((event) => event.detail);
    expect(details).toHaveLength(2);
    expect(details.some((d) => d.includes("from 45 to 50"))).toBe(true);
  });

  it("PATCH: saving the default while no row exists changes nothing", async () => {
    const response = await patch(adminId, { key: KEY, value: 60 });
    expect(response.status).toBe(200);
    expect((await response.json()).changed).toBe(false);
    await expectNothingChanged();
  });
});
