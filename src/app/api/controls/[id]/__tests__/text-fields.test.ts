import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ACTING_USER_COOKIE } from "@/lib/acting-user";
import { PATCH } from "../route";

/**
 * The text fields of `PATCH /api/controls/[id]`, which the single-Control editor of #314 sends: description,
 * category, mandatory, Self-Assessment Question, Intent and Examples (the title and the owner have tests of their
 * own). They are catalog curation: no Change Event, no applicability recompute.
 */
describe("PATCH /api/controls/[id] text fields (#314)", () => {
  const suffix = `${process.pid}-${Date.now()}`;
  const users: Partial<Record<UserRole, string>> = {};
  let controlId = "";

  const patch = (userId: string | null, body: unknown) => {
    const headers = new Headers();
    if (userId) headers.set("cookie", `${ACTING_USER_COOKIE}=${userId}`);
    return PATCH(new NextRequest(`http://localhost/api/controls/${controlId}`, { method: "PATCH", headers, body: JSON.stringify(body) }), {
      params: Promise.resolve({ id: controlId }),
    });
  };
  const read = () => prisma.control.findUniqueOrThrow({ where: { id: controlId } });
  const eventCount = () => prisma.changeEvent.count({ where: { detail: { contains: `TEST-314-TEXT-${suffix}` } } });

  beforeAll(async () => {
    for (const role of ["ADMIN", "COMPLIANCE_MANAGER", "SYSTEM_OWNER", "VIEWER"] as const) {
      users[role] = (await prisma.user.create({ data: { email: `test-314-text-${role}-${suffix}@example.com`, name: `Test 314 text ${role}`, role } })).id;
    }
  });

  afterAll(async () => {
    await prisma.control.deleteMany({ where: { id: controlId } });
    await prisma.user.deleteMany({ where: { email: { endsWith: `-${suffix}@example.com` } } });
  });

  async function freshControl() {
    if (controlId) await prisma.control.deleteMany({ where: { id: controlId } });
    controlId = (
      await prisma.control.create({
        data: {
          code: `TEST-314-TEXT-${suffix}`,
          title: "Test 314 text",
          description: "Original description",
          category: "Original",
          mandatory: true,
          applicability: "PER_SYSTEM",
          question: "Original question?",
          intent: "Original intent",
          examples: ["one"],
        },
      })
    ).id;
  }

  it.each(["ADMIN", "COMPLIANCE_MANAGER"] as const)("lets a %s edit every text field at once and returns the Control", async (role) => {
    await freshControl();
    const response = await patch(users[role]!, {
      description: "New description",
      category: "New category",
      mandatory: false,
      question: "New question?",
      intent: "New intent",
      examples: ["a", "b"],
    });
    expect(response.status).toBe(200);
    expect(await read()).toMatchObject({
      description: "New description",
      category: "New category",
      mandatory: false,
      question: "New question?",
      intent: "New intent",
      examples: ["a", "b"],
    });
  });

  it("clears the question, the intent and the examples with null and an empty list, and leaves other fields alone", async () => {
    await freshControl();
    const response = await patch(users.ADMIN!, { question: null, intent: null, examples: [] });
    expect(response.status).toBe(200);
    expect(await read()).toMatchObject({ question: null, intent: null, examples: [], description: "Original description", category: "Original", mandatory: true });
  });

  it("refuses an empty description or category and changes nothing", async () => {
    await freshControl();
    const before = await read();
    expect((await patch(users.ADMIN!, { description: "" })).status).toBe(400);
    expect((await patch(users.ADMIN!, { category: "" })).status).toBe(400);
    expect(await read()).toEqual(before);
  });

  it("writes no Change Event and keeps the Control's updatedness to the fields sent", async () => {
    await freshControl();
    const events = await prisma.changeEvent.count();
    await patch(users.ADMIN!, { description: "Edited" });
    expect(await prisma.changeEvent.count()).toBe(events);
    expect(await eventCount()).toBe(0);
  });

  it.each([["SYSTEM_OWNER"], ["VIEWER"], [null]] as const)("refuses %s with 401/403 and changes nothing", async (role) => {
    await freshControl();
    const before = await read();
    const response = await patch(role ? users[role]! : null, { title: "Hijacked", description: "Hijacked", category: "x", mandatory: false, question: "x", intent: "x", examples: ["x"] });
    expect(response.status).toBe(role ? 403 : 401);
    expect(await read()).toEqual(before);
  });
});
