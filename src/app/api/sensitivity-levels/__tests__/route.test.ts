import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { ACTING_USER_COOKIE } from "@/lib/acting-user";
import { GET, PATCH } from "../route";

/**
 * /api/sensitivity-levels (#291), against real Postgres. The five levels are shared rows that other test files read,
 * so the originals are read first and put back in `afterAll`, and the one successful save is changed and restored at once.
 * Refused writes assert the rows are exactly as they were.
 */
const URL = "http://localhost/api/sensitivity-levels";
const suffix = `${process.pid}-${Date.now()}`;
const select = { level: true, label: true, description: true, textColor: true, backgroundColor: true } as const;
const levelRows = () => prisma.sensitivityLevel.findMany({ orderBy: { level: "asc" }, select });

describe("/api/sensitivity-levels", () => {
  let adminId: string;
  let viewerId: string;
  let managerId: string;
  let original: Awaited<ReturnType<typeof levelRows>>;

  beforeAll(async () => {
    original = await levelRows();
    adminId = (await prisma.user.create({ data: { email: `test-sens-admin-${suffix}@example.com`, name: "Test Sens Admin", role: "ADMIN" } })).id;
    viewerId = (await prisma.user.create({ data: { email: `test-sens-viewer-${suffix}@example.com`, name: "Test Sens Viewer", role: "VIEWER" } })).id;
    managerId = (await prisma.user.create({ data: { email: `test-sens-manager-${suffix}@example.com`, name: "Test Sens Manager", role: "COMPLIANCE_MANAGER" } })).id;
  });

  afterAll(async () => {
    for (const row of original) await prisma.sensitivityLevel.update({ where: { level: row.level }, data: row });
    await prisma.user.deleteMany({ where: { id: { in: [adminId, viewerId, managerId] } } });
  });

  function requestAs(userId: string | null, init?: { method?: string; body?: string }) {
    const headers = new Headers();
    if (userId) headers.set("cookie", `${ACTING_USER_COOKIE}=${userId}`);
    return new NextRequest(URL, { ...init, headers });
  }
  const patch = (userId: string | null, body: unknown) =>
    PATCH(requestAs(userId, { method: "PATCH", body: typeof body === "string" ? body : JSON.stringify(body) }));
  const edit = (level: number, patchFields: Record<string, unknown> = {}) => ({ ...original[level - 1], ...patchFields });
  const expectNothingChanged = async () => expect(await levelRows()).toEqual(original);

  it("GET: 401 without a user, 200 with the five levels in order for any signed-in role", async () => {
    expect((await GET(requestAs(null))).status).toBe(401);
    for (const id of [viewerId, managerId, adminId]) {
      const response = await GET(requestAs(id));
      expect(response.status).toBe(200);
      const { levels } = await response.json();
      expect(levels.map((l: { level: number }) => l.level)).toEqual([1, 2, 3, 4, 5]);
      expect(levels[0]).toEqual(original[0]);
    }
  });

  it("PATCH: 401 without a user and 403 for a non-Admin, with nothing written", async () => {
    const body = edit(2, { label: "Test Renamed" });
    expect((await patch(null, body)).status).toBe(401);
    expect((await patch(viewerId, body)).status).toBe(403);
    expect((await patch(managerId, body)).status).toBe(403);
    await expectNothingChanged();
  });

  it("PATCH: refuses a bad body, label, description, colour, level, low contrast and a duplicate label, changing nothing", async () => {
    const refused: [string, unknown, RegExp?][] = [
      ["not JSON", "nope"],
      ["no body fields", {}],
      ["empty label", edit(2, { label: "   " }), /label/i],
      ["long label", edit(2, { label: "x".repeat(41) }), /40/],
      ["empty description", edit(2, { description: "" }), /description/i],
      ["bad text colour", edit(2, { textColor: "blue" }), /Text colour/],
      ["short background", edit(2, { backgroundColor: "#FFF" }), /Background colour/],
      ["CSS in a colour", edit(2, { textColor: "#000000;}body{display:none" }), /Text colour/],
      ["level 0", edit(2, { level: 0 })],
      ["level 6", edit(2, { level: 6 })],
      ["low contrast", edit(2, { textColor: "#BBBBBB", backgroundColor: "#FFFFFF" }), new RegExp(`^${original[1].label}: contrast is 1\\.`)],
      ["duplicate label", edit(2, { label: original[0].label.toUpperCase() }), /already has this label/],
    ];
    for (const [name, body, message] of refused) {
      const response = await patch(adminId, body);
      expect(response.status, name).toBe(400);
      const json = await response.json();
      if (message) expect(json.error, name).toMatch(message);
    }
    await expectNothingChanged();
  });

  it("PATCH: an Admin saves a level (colours upper-cased, text trimmed) and records no Change Event, then it is restored", async () => {
    const eventsBefore = await prisma.changeEvent.count({ where: { actorId: adminId } });
    const response = await patch(adminId, edit(2, { label: " Test Internal ", description: " Test description ", textColor: "#1d4ed8", backgroundColor: "#dbeafe" }));
    expect(response.status).toBe(200);
    expect((await response.json()).level).toEqual({ level: 2, label: "Test Internal", description: "Test description", textColor: "#1D4ED8", backgroundColor: "#DBEAFE" });
    expect((await levelRows())[1]).toMatchObject({ label: "Test Internal", backgroundColor: "#DBEAFE" });
    expect(await prisma.changeEvent.count({ where: { actorId: adminId } })).toBe(eventsBefore);

    // Saving a level under its own label is not a duplicate.
    expect((await patch(adminId, edit(2, { label: "Test Internal", textColor: "#1D4ED8", backgroundColor: "#DBEAFE" }))).status).toBe(200);

    expect((await patch(adminId, original[1])).status).toBe(200);
    await expectNothingChanged();
  });
});
