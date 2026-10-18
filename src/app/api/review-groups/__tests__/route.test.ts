import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ACTING_USER_COOKIE } from "@/lib/acting-user";
import { createFixtureFramework } from "@/test/framework-fixtures";
import { GET as listGroups, POST as createGroup } from "../route";
import { DELETE as deleteGroup, GET as getGroup, PATCH as patchGroup } from "../[id]/route";
import { POST as addMember } from "../[id]/members/route";
import { DELETE as removeMember } from "../[id]/members/[userId]/route";
import { PUT as tieFramework } from "../../frameworks/[id]/review-group/route";

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
const NOT_ADMIN = ROLES.filter((role) => role !== "ADMIN");
const email = (role: string) => `test-197-rg-${role.toLowerCase()}-${SUFFIX}@example.com`;

function requestAs(userId: string | null, init?: { method?: string; body?: unknown }) {
  const headers = new Headers();
  if (userId) headers.set("cookie", `${ACTING_USER_COOKIE}=${userId}`);
  return new NextRequest("http://localhost/api/review-groups", {
    method: init?.method,
    headers,
    body: init?.body === undefined ? undefined : JSON.stringify(init.body),
  });
}

function ctxFor(params: Record<string, string>) {
  return { params: Promise.resolve(params) };
}

describe("/api/review-groups", () => {
  const userIds = {} as Record<UserRole, string>;
  const groupIds: string[] = [];

  async function newGroup(name = `Test 197 Group ${SUFFIX}-${groupIds.length}`) {
    const group = await prisma.reviewGroup.create({ data: { name } });
    groupIds.push(group.id);
    return group;
  }

  async function snapshot() {
    const groups = await prisma.reviewGroup.findMany({
      where: { id: { in: groupIds } },
      include: { members: { select: { id: true } }, frameworks: { select: { id: true } } },
      orderBy: { id: "asc" },
    });
    return JSON.stringify(groups);
  }

  beforeAll(async () => {
    for (const role of ROLES) {
      const user = await prisma.user.create({ data: { email: email(role), name: `Test 197 ${role}`, role } });
      userIds[role] = user.id;
    }
  });

  afterAll(async () => {
    await prisma.framework.updateMany({ where: { reviewGroupId: { in: groupIds } }, data: { reviewGroupId: null } });
    await prisma.reviewGroup.deleteMany({ where: { id: { in: groupIds } } });
    await prisma.reviewGroup.deleteMany({ where: { name: { startsWith: "Test 197 Created" } } });
    await prisma.user.deleteMany({ where: { email: { in: ROLES.map(email) } } });
  });

  describe("create and list", () => {
    it("lets an Admin create a Review Group, trimming the name", async () => {
      const response = await createGroup(
        requestAs(userIds.ADMIN, { method: "POST", body: { name: `  Test 197 Created ${SUFFIX}  `, description: " About " } }),
      );
      expect(response.status).toBe(201);
      const { reviewGroup } = await response.json();
      expect(reviewGroup).toMatchObject({ name: `Test 197 Created ${SUFFIX}`, description: "About", members: [], frameworks: [] });
      groupIds.push(reviewGroup.id);
    });

    it.each(NOT_ADMIN)("refuses %s with 403 and creates nothing", async (role) => {
      const name = `Test 197 Created refused ${role} ${SUFFIX}`;
      const response = await createGroup(requestAs(userIds[role], { method: "POST", body: { name } }));
      expect(response.status).toBe(403);
      expect(await prisma.reviewGroup.count({ where: { name } })).toBe(0);
    });

    it("answers 401 with no acting user", async () => {
      const response = await createGroup(requestAs(null, { method: "POST", body: { name: "Test 197 Created anon" } }));
      expect(response.status).toBe(401);
      expect(await prisma.reviewGroup.count({ where: { name: "Test 197 Created anon" } })).toBe(0);
    });

    it("rejects a blank name with 400", async () => {
      const before = await prisma.reviewGroup.count();
      const response = await createGroup(requestAs(userIds.ADMIN, { method: "POST", body: { name: "   " } }));
      expect(response.status).toBe(400);
      expect(await prisma.reviewGroup.count()).toBe(before);
    });

    it("rejects a duplicate name with 409, also when only whitespace differs", async () => {
      const group = await newGroup();
      const before = await prisma.reviewGroup.count();
      for (const name of [group.name, ` ${group.name} `]) {
        const response = await createGroup(requestAs(userIds.ADMIN, { method: "POST", body: { name } }));
        expect(response.status).toBe(409);
      }
      expect(await prisma.reviewGroup.count()).toBe(before);
    });

    it.each(["ADMIN", "COMPLIANCE_MANAGER"] as const)("lets %s list groups with members and Frameworks", async (role) => {
      const group = await newGroup();
      const response = await listGroups(requestAs(userIds[role]));
      expect(response.status).toBe(200);
      const { reviewGroups } = await response.json();
      expect(reviewGroups.find((g: { id: string }) => g.id === group.id)).toMatchObject({ members: [], frameworks: [] });
    });

    it.each(["REVIEWER", "VIEWER", "INTERNAL_AUDITOR"] as const)("refuses %s the list and a single group with 403", async (role) => {
      const group = await newGroup();
      expect((await listGroups(requestAs(userIds[role]))).status).toBe(403);
      expect((await getGroup(requestAs(userIds[role]), ctxFor({ id: group.id }))).status).toBe(403);
    });

    it("answers 404 for an unknown group", async () => {
      expect((await getGroup(requestAs(userIds.ADMIN), ctxFor({ id: "nope" }))).status).toBe(404);
    });
  });

  describe("rename", () => {
    it("lets an Admin rename and change the description", async () => {
      const group = await newGroup();
      const response = await patchGroup(
        requestAs(userIds.ADMIN, { method: "PATCH", body: { name: `${group.name} renamed`, description: "New text" } }),
        ctxFor({ id: group.id }),
      );
      expect(response.status).toBe(200);
      expect(await prisma.reviewGroup.findUniqueOrThrow({ where: { id: group.id } })).toMatchObject({
        name: `${group.name} renamed`,
        description: "New text",
      });
    });

    it.each(NOT_ADMIN)("refuses %s with 403 and changes nothing", async (role) => {
      const group = await newGroup();
      const before = await snapshot();
      const response = await patchGroup(
        requestAs(userIds[role], { method: "PATCH", body: { name: "Test 197 hijacked" } }),
        ctxFor({ id: group.id }),
      );
      expect(response.status).toBe(403);
      expect(await snapshot()).toBe(before);
    });

    it("refuses a name another group has with 409", async () => {
      const a = await newGroup();
      const b = await newGroup();
      const before = await snapshot();
      const response = await patchGroup(
        requestAs(userIds.ADMIN, { method: "PATCH", body: { name: a.name } }),
        ctxFor({ id: b.id }),
      );
      expect(response.status).toBe(409);
      expect(await snapshot()).toBe(before);
    });

    it("answers 404 for an unknown group", async () => {
      const response = await patchGroup(requestAs(userIds.ADMIN, { method: "PATCH", body: { name: "x" } }), ctxFor({ id: "nope" }));
      expect(response.status).toBe(404);
    });
  });

  describe("members", () => {
    it("lets an Admin add members of any role but Internal Auditor, and remove them", async () => {
      const group = await newGroup();
      for (const role of ["REVIEWER", "SYSTEM_OWNER", "COMPLIANCE_MANAGER", "VIEWER", "ADMIN"] as const) {
        const response = await addMember(
          requestAs(userIds.ADMIN, { method: "POST", body: { userId: userIds[role] } }),
          ctxFor({ id: group.id }),
        );
        expect(response.status).toBe(201);
      }
      const members = await prisma.reviewGroup.findUniqueOrThrow({ where: { id: group.id }, include: { members: true } });
      expect(members.members).toHaveLength(5);

      // Adding someone twice changes nothing.
      const again = await addMember(
        requestAs(userIds.ADMIN, { method: "POST", body: { userId: userIds.REVIEWER } }),
        ctxFor({ id: group.id }),
      );
      expect(again.status).toBe(201);
      expect(await prisma.user.count({ where: { reviewGroups: { some: { id: group.id } } } })).toBe(5);

      const removed = await removeMember(
        requestAs(userIds.ADMIN, { method: "DELETE" }),
        ctxFor({ id: group.id, userId: userIds.REVIEWER }),
      );
      expect(removed.status).toBe(200);
      expect(await prisma.user.count({ where: { reviewGroups: { some: { id: group.id } } } })).toBe(4);
    });

    it("refuses an Internal Auditor as a member with 400 and changes nothing", async () => {
      const group = await newGroup();
      const before = await snapshot();
      const response = await addMember(
        requestAs(userIds.ADMIN, { method: "POST", body: { userId: userIds.INTERNAL_AUDITOR } }),
        ctxFor({ id: group.id }),
      );
      expect(response.status).toBe(400);
      expect((await response.json()).error).toMatch(/Internal Auditor/);
      expect(await snapshot()).toBe(before);
    });

    it("refuses an unknown user with 400 and an unknown group with 404", async () => {
      const group = await newGroup();
      const before = await snapshot();
      const unknownUser = await addMember(
        requestAs(userIds.ADMIN, { method: "POST", body: { userId: "nope" } }),
        ctxFor({ id: group.id }),
      );
      expect(unknownUser.status).toBe(400);
      const unknownGroup = await addMember(
        requestAs(userIds.ADMIN, { method: "POST", body: { userId: userIds.REVIEWER } }),
        ctxFor({ id: "nope" }),
      );
      expect(unknownGroup.status).toBe(404);
      expect(await snapshot()).toBe(before);
    });

    it.each(NOT_ADMIN)("refuses %s adding or removing a member with 403 and changes nothing", async (role) => {
      const group = await newGroup();
      await prisma.reviewGroup.update({ where: { id: group.id }, data: { members: { connect: { id: userIds.VIEWER } } } });
      const before = await snapshot();

      const add = await addMember(
        requestAs(userIds[role], { method: "POST", body: { userId: userIds.REVIEWER } }),
        ctxFor({ id: group.id }),
      );
      const remove = await removeMember(
        requestAs(userIds[role], { method: "DELETE" }),
        ctxFor({ id: group.id, userId: userIds.VIEWER }),
      );
      expect(add.status).toBe(403);
      expect(remove.status).toBe(403);
      expect(await snapshot()).toBe(before);
    });

    it("lets the last member be removed even while the group is tied", async () => {
      const group = await newGroup();
      const framework = await createFixtureFramework("197 last member");
      await prisma.reviewGroup.update({ where: { id: group.id }, data: { members: { connect: { id: userIds.REVIEWER } } } });
      await prisma.framework.update({ where: { id: framework.id }, data: { reviewGroupId: group.id } });

      const response = await removeMember(
        requestAs(userIds.ADMIN, { method: "DELETE" }),
        ctxFor({ id: group.id, userId: userIds.REVIEWER }),
      );
      expect(response.status).toBe(200);
      const { reviewGroup } = await response.json();
      expect(reviewGroup.members).toEqual([]);
      expect(reviewGroup.frameworks).toHaveLength(1);
    });
  });

  describe("delete", () => {
    it("refuses a tied group with 409 and changes nothing; once untied it deletes", async () => {
      const group = await newGroup();
      const framework = await createFixtureFramework("197 delete");
      const tie = await tieFramework(
        requestAs(userIds.COMPLIANCE_MANAGER, { method: "PUT", body: { reviewGroupId: group.id } }),
        ctxFor({ id: framework.id }),
      );
      expect(tie.status).toBe(200);
      const before = await snapshot();

      const refused = await deleteGroup(requestAs(userIds.ADMIN, { method: "DELETE" }), ctxFor({ id: group.id }));
      expect(refused.status).toBe(409);
      expect(await snapshot()).toBe(before);

      await prisma.framework.update({ where: { id: framework.id }, data: { reviewGroupId: null } });
      const deleted = await deleteGroup(requestAs(userIds.ADMIN, { method: "DELETE" }), ctxFor({ id: group.id }));
      expect(deleted.status).toBe(204);
      expect(await prisma.reviewGroup.count({ where: { id: group.id } })).toBe(0);
    });

    it("deletes an untied group together with its memberships, leaving the Users", async () => {
      const group = await newGroup();
      await prisma.reviewGroup.update({ where: { id: group.id }, data: { members: { connect: { id: userIds.REVIEWER } } } });
      const response = await deleteGroup(requestAs(userIds.ADMIN, { method: "DELETE" }), ctxFor({ id: group.id }));
      expect(response.status).toBe(204);
      expect(await prisma.user.count({ where: { id: userIds.REVIEWER } })).toBe(1);
    });

    it.each(NOT_ADMIN)("refuses %s with 403 and deletes nothing", async (role) => {
      const group = await newGroup();
      const before = await snapshot();
      const response = await deleteGroup(requestAs(userIds[role], { method: "DELETE" }), ctxFor({ id: group.id }));
      expect(response.status).toBe(403);
      expect(await snapshot()).toBe(before);
    });

    it("answers 404 for an unknown group", async () => {
      expect((await deleteGroup(requestAs(userIds.ADMIN, { method: "DELETE" }), ctxFor({ id: "nope" }))).status).toBe(404);
    });
  });
});
