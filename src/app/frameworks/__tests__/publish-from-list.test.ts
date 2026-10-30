import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ACTING_USER_COOKIE } from "@/lib/acting-user";
import { POST as publish } from "@/app/api/frameworks/[id]/publish/route";
import { POST as create } from "@/app/api/frameworks/route";
import { loadFrameworksView } from "../frameworks-data";

/**
 * What the Framework list's Publish dialog and the New Framework page call (#266): the existing publish and
 * create routes. A role other than Compliance Manager or Admin is refused and nothing changes in the database.
 */
const suffix = `${process.pid}-${Date.now()}`;
const users: Record<string, string> = {};
const frameworkIds: string[] = [];
let draftId: string;

const request = (path: string, userId: string | null, body?: unknown) => {
  const headers = new Headers({ "Content-Type": "application/json" });
  if (userId) headers.set("cookie", `${ACTING_USER_COOKIE}=${userId}`);
  return new NextRequest(`http://localhost${path}`, { method: "POST", headers, body: body === undefined ? undefined : JSON.stringify(body) });
};
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const statusOf = async () => (await prisma.framework.findUniqueOrThrow({ where: { id: draftId } })).status;
const eventCount = () => prisma.changeEvent.count({ where: { action: "FRAMEWORK_PUBLISHED", detail: { contains: `Test 266 publish ${suffix}` } } });

beforeAll(async () => {
  for (const [key, role] of [["cm", "COMPLIANCE_MANAGER"], ["viewer", "VIEWER"], ["owner", "SYSTEM_OWNER"], ["auditor", "INTERNAL_AUDITOR"]] as [string, UserRole][]) {
    users[key] = (await prisma.user.create({ data: { email: `test-266-pub-${key}-${suffix}@example.com`, name: `Test 266 ${key}`, role } })).id;
  }
  const draft = await prisma.framework.create({ data: { name: `Test 266 publish ${suffix}`, version: "1", status: "DRAFT" } });
  draftId = draft.id;
  frameworkIds.push(draft.id);
});

afterAll(async () => {
  await prisma.changeEvent.deleteMany({ where: { detail: { contains: `Test 266 publish ${suffix}` } } });
  for (const id of frameworkIds) await prisma.framework.delete({ where: { id } });
  await prisma.user.deleteMany({ where: { id: { in: Object.values(users) } } });
});

describe("Publish from the list", () => {
  it("refuses every role but Compliance Manager and Admin, and changes nothing", async () => {
    for (const key of ["viewer", "owner", "auditor"]) {
      const response = await publish(request(`/api/frameworks/${draftId}/publish`, users[key]), ctx(draftId));
      expect(response.status).toBe(403);
    }
    expect((await publish(request(`/api/frameworks/${draftId}/publish`, null), ctx(draftId))).status).toBe(401);
    expect(await statusOf()).toBe("DRAFT");
    expect(await eventCount()).toBe(0);
  });

  it("publishes for a Compliance Manager, and the list then shows the Framework as Published with a Systems count", async () => {
    const before = (await loadFrameworksView({ id: users.cm, role: "COMPLIANCE_MANAGER" })).rows.find((row) => row.id === draftId)!;
    expect(before).toMatchObject({ status: "DRAFT", systems: null });

    const response = await publish(request(`/api/frameworks/${draftId}/publish`, users.cm), ctx(draftId));
    expect(response.status).toBe(200);
    expect(await statusOf()).toBe("PUBLISHED");
    expect(await eventCount()).toBe(1);

    const after = (await loadFrameworksView({ id: users.cm, role: "COMPLIANCE_MANAGER" })).rows.find((row) => row.id === draftId)!;
    expect(after).toMatchObject({ status: "PUBLISHED", systems: 0 });
  });

  it("answers 409 for a Framework that is already Published, with no second Change Event", async () => {
    const response = await publish(request(`/api/frameworks/${draftId}/publish`, users.cm), ctx(draftId));
    expect(response.status).toBe(409);
    expect(await eventCount()).toBe(1);
  });
});

describe("Create from the New Framework page", () => {
  const body = { name: `Test 266 created ${suffix}`, version: "1" };
  const count = () => prisma.framework.count({ where: { name: { contains: `Test 266 created ${suffix}` } } });

  it("is refused for a role that cannot manage the requirement database, and creates nothing", async () => {
    for (const key of ["viewer", "owner"]) {
      expect((await create(request("/api/frameworks", users[key], body))).status).toBe(403);
    }
    expect(await count()).toBe(0);
  });

  it("creates a Draft for a Compliance Manager and answers with its id, which the page opens", async () => {
    const response = await create(request("/api/frameworks", users.cm, { ...body, description: "d", licensing: "QUOTABLE", strictComplianceRequired: true, supersedesId: draftId }));
    expect(response.status).toBe(201);
    const { framework } = await response.json();
    frameworkIds.unshift(framework.id);
    expect(framework).toMatchObject({ name: body.name, status: "DRAFT", licensing: "QUOTABLE", strictComplianceRequired: true, supersedesId: draftId, isBase: false });
  });

  it("answers 409 for a name and version that already exist, creating no second one", async () => {
    expect((await create(request("/api/frameworks", users.cm, body))).status).toBe(409);
    expect(await count()).toBe(1);
  });

  it("answers 400 for a blank name or version", async () => {
    expect((await create(request("/api/frameworks", users.cm, { name: "", version: "1" }))).status).toBe(400);
    expect((await create(request("/api/frameworks", users.cm, { name: "Test 266 blank", version: "" }))).status).toBe(400);
    expect(await prisma.framework.count({ where: { name: "Test 266 blank" } })).toBe(0);
  });
});
