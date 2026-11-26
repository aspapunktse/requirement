import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ACTING_USER_COOKIE } from "@/lib/acting-user";
import { PATCH } from "../route";

/** The evidence validity period (months) of `PATCH /api/controls/[id]` (#455): a whole number 1..600, or null for evidence that doesn't expire. */
describe("PATCH /api/controls/[id] evidenceValidityMonths (#455)", () => {
  const suffix = `${process.pid}-${Date.now()}`;
  const users: Partial<Record<UserRole, string>> = {};
  let controlId = "";

  const patch = (userId: string, body: unknown) =>
    PATCH(
      new NextRequest(`http://localhost/api/controls/${controlId}`, {
        method: "PATCH",
        headers: new Headers({ cookie: `${ACTING_USER_COOKIE}=${userId}` }),
        body: JSON.stringify(body),
      }),
      { params: Promise.resolve({ id: controlId }) },
    );
  const months = async () => (await prisma.control.findUniqueOrThrow({ where: { id: controlId } })).evidenceValidityMonths;

  beforeAll(async () => {
    for (const role of ["ADMIN", "SYSTEM_OWNER"] as const) {
      users[role] = (await prisma.user.create({ data: { email: `test-455-validity-${role}-${suffix}@example.com`, name: `Test 455 validity ${role}`, role } })).id;
    }
    controlId = (
      await prisma.control.create({
        data: { code: `TEST-455-VALIDITY-${suffix}`, title: "Test 455 validity", description: "d", category: "c", mandatory: true, applicability: "PER_SYSTEM" },
      })
    ).id;
  });

  afterAll(async () => {
    await prisma.control.deleteMany({ where: { id: controlId } });
    await prisma.user.deleteMany({ where: { email: { endsWith: `-${suffix}@example.com` } } });
  });

  it("sets, changes and clears the period", async () => {
    expect(await months()).toBeNull();
    expect((await patch(users.ADMIN!, { evidenceValidityMonths: 12 })).status).toBe(200);
    expect(await months()).toBe(12);
    expect((await patch(users.ADMIN!, { evidenceValidityMonths: 600 })).status).toBe(200);
    expect(await months()).toBe(600);
    expect((await patch(users.ADMIN!, { evidenceValidityMonths: null })).status).toBe(200);
    expect(await months()).toBeNull();
  });

  it("leaves the period alone when the field is not sent", async () => {
    await patch(users.ADMIN!, { evidenceValidityMonths: 6 });
    expect((await patch(users.ADMIN!, { mandatory: false })).status).toBe(200);
    expect(await months()).toBe(6);
  });

  it.each([0, 601, -3, 1.5, "12"])("refuses %s and changes nothing", async (value) => {
    await patch(users.ADMIN!, { evidenceValidityMonths: 6 });
    expect((await patch(users.ADMIN!, { evidenceValidityMonths: value })).status).toBe(400);
    expect(await months()).toBe(6);
  });

  it("refuses a System Owner and changes nothing", async () => {
    await patch(users.ADMIN!, { evidenceValidityMonths: 6 });
    const response = await patch(users.SYSTEM_OWNER!, { evidenceValidityMonths: 24 });
    expect([401, 403]).toContain(response.status);
    expect(await months()).toBe(6);
  });
});
