import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ACTING_USER_COOKIE } from "@/lib/acting-user";
import { createFixtureFramework, getBaseFramework } from "@/test/framework-fixtures";
import { DELETE, PUT } from "../[id]/review-group/route";
import { PATCH as patchFramework } from "../[id]/route";

// Tying and untying a Review Group to a Framework (#197).
const SUFFIX = `${process.pid}-${Date.now()}`;
const ROLES: UserRole[] = [
  "ADMIN",
  "COMPLIANCE_MANAGER",
  "INTERNAL_AUDITOR",
  "REVIEWER",
  "RISK_OWNER",
  "SYSTEM_OWNER",
  "VIEWER",
  "BUSINESS_RISK_OWNER",
];
const CANNOT_TIE = ROLES.filter((role) => role !== "ADMIN" && role !== "COMPLIANCE_MANAGER");
const email = (role: string) => `test-197-tie-${role.toLowerCase()}-${SUFFIX}@example.com`;

function requestAs(userId: string | null, method: string, body?: unknown) {
  const headers = new Headers();
  if (userId) headers.set("cookie", `${ACTING_USER_COOKIE}=${userId}`);
  return new NextRequest("http://localhost/api/frameworks/x/review-group", {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const ctxFor = (id: string) => ({ params: Promise.resolve({ id }) });

describe("/api/frameworks/[id]/review-group", () => {
  const userIds = {} as Record<UserRole, string>;
  const groupIds: string[] = [];

  async function newGroup() {
    const group = await prisma.reviewGroup.create({ data: { name: `Test 197 Tie Group ${SUFFIX}-${groupIds.length}` } });
    groupIds.push(group.id);
    return group;
  }

  const reviewGroupIdOf = async (frameworkId: string) =>
    (await prisma.framework.findUniqueOrThrow({ where: { id: frameworkId } })).reviewGroupId;

  beforeAll(async () => {
    for (const role of ROLES) {
      userIds[role] = (await prisma.user.create({ data: { email: email(role), name: `Test 197 tie ${role}`, role } })).id;
    }
  });

  afterAll(async () => {
    await prisma.framework.updateMany({ where: { reviewGroupId: { in: groupIds } }, data: { reviewGroupId: null } });
    await prisma.reviewGroup.deleteMany({ where: { id: { in: groupIds } } });
    await prisma.user.deleteMany({ where: { email: { in: ROLES.map(email) } } });
  });

  it.each(["ADMIN", "COMPLIANCE_MANAGER"] as const)("lets %s tie and untie a non-base Framework", async (role) => {
    const group = await newGroup();
    const framework = await createFixtureFramework("197 tie");

    const tied = await PUT(requestAs(userIds[role], "PUT", { reviewGroupId: group.id }), ctxFor(framework.id));
    expect(tied.status).toBe(200);
    expect((await tied.json()).framework.reviewGroup).toEqual({ id: group.id, name: group.name });
    expect(await reviewGroupIdOf(framework.id)).toBe(group.id);

    const untied = await DELETE(requestAs(userIds[role], "DELETE"), ctxFor(framework.id));
    expect(untied.status).toBe(200);
    expect((await untied.json()).framework.reviewGroup).toBeNull();
    expect(await reviewGroupIdOf(framework.id)).toBeNull();
  });

  it("ties one group to several Frameworks, and tying the same group again changes nothing", async () => {
    const group = await newGroup();
    const a = await createFixtureFramework("197 many a");
    const b = await createFixtureFramework("197 many b");
    for (const framework of [a, b, a]) {
      const response = await PUT(requestAs(userIds.ADMIN, "PUT", { reviewGroupId: group.id }), ctxFor(framework.id));
      expect(response.status).toBe(200);
    }
    expect(await prisma.framework.count({ where: { reviewGroupId: group.id } })).toBe(2);
  });

  it.each(CANNOT_TIE)("refuses %s with 403 and changes nothing", async (role) => {
    const group = await newGroup();
    const framework = await createFixtureFramework("197 forbidden");
    const other = await newGroup();
    await prisma.framework.update({ where: { id: framework.id }, data: { reviewGroupId: other.id } });
    const untied = await createFixtureFramework("197 forbidden untied");

    const tie = await PUT(requestAs(userIds[role], "PUT", { reviewGroupId: group.id }), ctxFor(untied.id));
    const untie = await DELETE(requestAs(userIds[role], "DELETE"), ctxFor(framework.id));
    expect(tie.status).toBe(403);
    expect(untie.status).toBe(403);
    expect(await reviewGroupIdOf(untied.id)).toBeNull();
    expect(await reviewGroupIdOf(framework.id)).toBe(other.id);
  });

  it("answers 401 with no acting user", async () => {
    const group = await newGroup();
    const framework = await createFixtureFramework("197 anon");
    expect((await PUT(requestAs(null, "PUT", { reviewGroupId: group.id }), ctxFor(framework.id))).status).toBe(401);
    expect(await reviewGroupIdOf(framework.id)).toBeNull();
  });

  it("refuses a second, different group with 409 and keeps the first", async () => {
    const first = await newGroup();
    const second = await newGroup();
    const framework = await createFixtureFramework("197 second");
    expect((await PUT(requestAs(userIds.ADMIN, "PUT", { reviewGroupId: first.id }), ctxFor(framework.id))).status).toBe(200);

    const refused = await PUT(requestAs(userIds.COMPLIANCE_MANAGER, "PUT", { reviewGroupId: second.id }), ctxFor(framework.id));
    expect(refused.status).toBe(409);
    expect(await reviewGroupIdOf(framework.id)).toBe(first.id);

    // Untying first makes room for the other group.
    expect((await DELETE(requestAs(userIds.ADMIN, "DELETE"), ctxFor(framework.id))).status).toBe(200);
    expect((await PUT(requestAs(userIds.ADMIN, "PUT", { reviewGroupId: second.id }), ctxFor(framework.id))).status).toBe(200);
    expect(await reviewGroupIdOf(framework.id)).toBe(second.id);
  });

  it("refuses the base Framework with 400 and changes nothing", async () => {
    const group = await newGroup();
    const base = await getBaseFramework();
    const response = await PUT(requestAs(userIds.ADMIN, "PUT", { reviewGroupId: group.id }), ctxFor(base.id));
    expect(response.status).toBe(400);
    expect(await reviewGroupIdOf(base.id)).toBeNull();
  });

  it("refuses a missing body, an unknown group (400) and an unknown Framework (404)", async () => {
    const group = await newGroup();
    const framework = await createFixtureFramework("197 unknown");
    expect((await PUT(requestAs(userIds.ADMIN, "PUT", {}), ctxFor(framework.id))).status).toBe(400);
    expect((await PUT(requestAs(userIds.ADMIN, "PUT", { reviewGroupId: "nope" }), ctxFor(framework.id))).status).toBe(400);
    expect((await PUT(requestAs(userIds.ADMIN, "PUT", { reviewGroupId: group.id }), ctxFor("nope"))).status).toBe(404);
    expect((await DELETE(requestAs(userIds.ADMIN, "DELETE"), ctxFor("nope"))).status).toBe(404);
    expect(await reviewGroupIdOf(framework.id)).toBeNull();
  });

  it("is not settable through the general Framework PATCH", async () => {
    const group = await newGroup();
    const framework = await createFixtureFramework("197 patch");
    const response = await patchFramework(
      requestAs(userIds.ADMIN, "PATCH", { description: "x", reviewGroupId: group.id }),
      ctxFor(framework.id),
    );
    expect(response.status).toBe(200);
    expect(await reviewGroupIdOf(framework.id)).toBeNull();
  });

  it("refuses making a tied Framework the base Framework with 409", async () => {
    const group = await newGroup();
    const framework = await createFixtureFramework("197 base flip");
    await PUT(requestAs(userIds.ADMIN, "PUT", { reviewGroupId: group.id }), ctxFor(framework.id));
    const response = await patchFramework(requestAs(userIds.ADMIN, "PATCH", { isBase: true }), ctxFor(framework.id));
    expect(response.status).toBe(409);
    expect((await prisma.framework.findUniqueOrThrow({ where: { id: framework.id } })).isBase).toBe(false);
  });
});
