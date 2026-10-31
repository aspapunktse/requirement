import { NextRequest } from "next/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { ACTING_USER_COOKIE } from "@/lib/acting-user";
import * as listRoute from "../route";
import * as itemRoute from "../[id]/route";

/**
 * #279: a Control read nests mappings -> requirement -> framework, which Prisma runs as several
 * statements. Outside one REPEATABLE READ snapshot a Requirement deleted in between makes it throw
 * "Inconsistent query result". These tests pin that the routes read inside such a transaction
 * (racing deletes would be timing-dependent, so the isolation level is asserted instead).
 */
describe("Control reads run in a REPEATABLE READ snapshot (#279)", () => {
  const suffix = `${process.pid}-${Date.now()}`;
  const email = `test-279-admin-${suffix}@example.com`;
  let adminId: string;
  let controlId: string;

  beforeAll(async () => {
    adminId = (await prisma.user.create({ data: { email, name: "Test #279 Admin", role: "ADMIN" } })).id;
    controlId = (
      await prisma.control.create({
        data: {
          code: `TEST-279-${suffix}`,
          title: "Test #279 Control",
          description: "d",
          category: "Test",
          applicability: "ORGANIZATIONAL",
        },
      })
    ).id;
  });

  // One spy for the file that calls through with the client as `this` (a bare spy loses it on Prisma's
  // client proxy, and restoring it mid-file removes the property), cleared before each test.
  let spy: { mock: { calls: unknown[][] }; mockClear(): unknown };
  beforeAll(() => {
    const original = prisma.$transaction.bind(prisma) as (...args: unknown[]) => unknown;
    spy = vi.spyOn(prisma, "$transaction").mockImplementation(((...args: unknown[]) => original(...args)) as never);
  });
  beforeEach(() => {
    spy.mockClear();
  });

  afterAll(async () => {
    await prisma.control.deleteMany({ where: { id: controlId } });
    await prisma.user.deleteMany({ where: { id: adminId } });
  });

  function request(method: string, url: string, body?: unknown) {
    const headers = new Headers({ cookie: `${ACTING_USER_COOKIE}=${adminId}` });
    return new NextRequest(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  }

  function isolationLevels(spy: { mock: { calls: unknown[][] } }) {
    return spy.mock.calls.map((call) => (call[1] as { isolationLevel?: string } | undefined)?.isolationLevel);
  }

  it("GET /api/controls", async () => {
    const response = await listRoute.GET(request("GET", "http://localhost/api/controls"));
    expect(response.status).toBe(200);
    expect(isolationLevels(spy)).toEqual(["RepeatableRead"]);
  });

  it("GET /api/controls/[id]", async () => {
    const response = await itemRoute.GET(request("GET", `http://localhost/api/controls/${controlId}`), {
      params: Promise.resolve({ id: controlId }),
    });
    expect(response.status).toBe(200);
    expect(isolationLevels(spy)).toEqual(["RepeatableRead"]);
  });

  it("PATCH /api/controls/[id] returns the Control as read in a snapshot after the write", async () => {
    const response = await itemRoute.PATCH(
      request("PATCH", `http://localhost/api/controls/${controlId}`, { title: "Test #279 Control edited" }),
      { params: Promise.resolve({ id: controlId }) },
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.control.title).toBe("Test #279 Control edited");
    expect(body.control.mappings).toEqual([]);
    expect(isolationLevels(spy)).toContain("RepeatableRead");
  });
});
