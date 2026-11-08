import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ACTING_USER_COOKIE } from "@/lib/acting-user";
import { cleanupFixtureRequirements, createFixtureFramework, mapControlsToFramework } from "@/test/framework-fixtures";
import { PATCH as patchFramework } from "../[id]/route";
import { PUT as putFirstRound } from "../[id]/first-round-controls/[controlId]/route";
import { DELETE as deleteRequirement } from "../[id]/requirements/[requirementId]/route";
import { DELETE as deleteMapping } from "../[id]/requirements/[requirementId]/mappings/[mappingId]/route";

/**
 * The Framework Owner and the first-round marking (#319, PRD 0002 F-FO). Fixtures are created here (CI's database is
 * not seeded) on non-base fixture Frameworks, and removed in afterAll.
 */

const SUFFIX = `${process.pid}-${Date.now()}`;

function req(path: string, method: string, userId: string | null, body?: unknown) {
  const headers = new Headers({ "Content-Type": "application/json" });
  if (userId) headers.set("cookie", `${ACTING_USER_COOKIE}=${userId}`);
  return new NextRequest(`http://localhost${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
}
const params = (p: Record<string, string>) => ({ params: Promise.resolve(p) }) as never;

describe("Framework Owner and first-round Controls", () => {
  const users: Record<string, string> = {};
  const controlIds: string[] = [];
  let frameworkId: string;
  let otherFrameworkId: string;
  let c1: string;
  let c2: string;
  let unmapped: string;
  let req1: string; // maps c1
  let req2: string; // maps c2 and c1

  const patch = (userId: string | null, body: unknown, id = frameworkId) =>
    patchFramework(req(`/api/frameworks/${id}`, "PATCH", userId, body), params({ id }));
  const mark = (userId: string | null, controlId: string, firstRound: boolean | string = true, id = frameworkId) =>
    putFirstRound(req(`/api/frameworks/${id}/first-round-controls/${controlId}`, "PUT", userId, { firstRound }), params({ id, controlId }));
  const owner = async (id = frameworkId) => (await prisma.framework.findUniqueOrThrow({ where: { id }, select: { ownerId: true } })).ownerId;
  const marked = async (id = frameworkId) =>
    (await prisma.frameworkFirstRoundControl.findMany({ where: { frameworkId: id }, select: { controlId: true } })).map((m) => m.controlId).sort();
  const events = () => prisma.changeEvent.count({ where: { actorId: { in: Object.values(users) } } });

  async function makeControl(tag: string) {
    const control = await prisma.control.create({
      data: { code: `TEST-FO-${tag}-${SUFFIX}`, title: `Test FO ${tag}`, description: "d", category: "Test", applicability: "ORGANIZATIONAL", mandatory: false },
    });
    controlIds.push(control.id);
    return control.id;
  }

  beforeAll(async () => {
    const roles: Record<string, UserRole> = {
      cm: "COMPLIANCE_MANAGER",
      admin: "ADMIN",
      sysowner: "SYSTEM_OWNER",
      viewer: "VIEWER",
      fwowner: "VIEWER",
      auditor: "INTERNAL_AUDITOR",
    };
    for (const [key, role] of Object.entries(roles)) {
      users[key] = (await prisma.user.create({ data: { email: `test-fo-${key}-${SUFFIX}@example.com`, name: `Test fo ${key}`, role } })).id;
    }
    frameworkId = (await createFixtureFramework("Owner")).id;
    otherFrameworkId = (await createFixtureFramework("Other owner")).id;
    c1 = await makeControl("1");
    c2 = await makeControl("2");
    unmapped = await makeControl("3");
    req1 = await mapControlsToFramework(frameworkId, [c1]);
    req2 = await mapControlsToFramework(frameworkId, [c2, c1]);
    await mapControlsToFramework(otherFrameworkId, [unmapped]);
  });

  afterAll(async () => {
    await cleanupFixtureRequirements();
    await prisma.control.deleteMany({ where: { id: { in: controlIds } } });
    await prisma.user.deleteMany({ where: { id: { in: Object.values(users) } } });
  });

  describe("assigning the owner", () => {
    it("lets a Compliance Manager and an Admin assign, change and clear it, whatever the owner's role", async () => {
      expect((await patch(users.cm, { ownerId: users.fwowner })).status).toBe(200);
      expect(await owner()).toBe(users.fwowner);
      expect((await patch(users.admin, { ownerId: users.sysowner })).status).toBe(200);
      expect(await owner()).toBe(users.sysowner);
      expect((await patch(users.cm, { ownerId: null })).status).toBe(200);
      expect(await owner()).toBeNull();
      // A write that leaves it out leaves it alone.
      await patch(users.cm, { ownerId: users.fwowner });
      expect((await patch(users.cm, { description: "Edited" })).status).toBe(200);
      expect(await owner()).toBe(users.fwowner);
      await patch(users.cm, { ownerId: null });
    });

    it("refuses everyone else and an anonymous caller, and changes nothing", async () => {
      await patch(users.cm, { ownerId: users.fwowner });
      for (const userId of [users.sysowner, users.viewer, users.fwowner, users.auditor]) {
        expect((await patch(userId, { ownerId: users.sysowner })).status).toBe(403);
        expect((await patch(userId, { ownerId: null })).status).toBe(403);
      }
      expect((await patch(null, { ownerId: null })).status).toBe(401);
      expect(await owner()).toBe(users.fwowner);
      await patch(users.cm, { ownerId: null });
    });

    it("refuses an unknown User, a read-only role and a malformed body, and changes nothing", async () => {
      expect((await patch(users.cm, { ownerId: "no-such-user" })).status).toBe(400);
      expect((await patch(users.cm, { ownerId: users.auditor })).status).toBe(400);
      expect((await patch(users.cm, { ownerId: "" })).status).toBe(400);
      expect((await patch(users.cm, { ownerId: 5 })).status).toBe(400);
      expect(await owner()).toBeNull();
    });

    it("writes no Change Event, and leaves the Framework unowned when the owner's User is deleted", async () => {
      const before = await events();
      const temp = await prisma.user.create({ data: { email: `test-fo-temp-${SUFFIX}@example.com`, name: "Test fo temp", role: "VIEWER" } });
      expect((await patch(users.cm, { ownerId: temp.id })).status).toBe(200);
      expect(await events()).toBe(before);
      await prisma.user.delete({ where: { id: temp.id } });
      expect(await owner()).toBeNull();
    });
  });

  describe("marking first-round Controls", () => {
    it("lets the Framework's owner, a Compliance Manager and an Admin mark and unmark a mapped Control", async () => {
      await patch(users.cm, { ownerId: users.fwowner });
      const before = await events();
      expect((await mark(users.fwowner, c1)).status).toBe(200);
      expect(await marked()).toEqual([c1]);
      expect((await mark(users.cm, c2)).status).toBe(200);
      expect(await marked()).toEqual([c1, c2].sort());
      // Idempotent.
      expect((await mark(users.admin, c2)).status).toBe(200);
      expect(await marked()).toEqual([c1, c2].sort());
      expect((await mark(users.admin, c2, false)).status).toBe(200);
      expect((await mark(users.fwowner, c1, false)).status).toBe(200);
      expect(await marked()).toEqual([]);
      expect(await events()).toBe(before);
      await patch(users.cm, { ownerId: null });
    });

    it("refuses a non-owner (even a System Owner), another Framework's owner and an anonymous caller, and changes nothing", async () => {
      await patch(users.cm, { ownerId: users.fwowner });
      await patch(users.cm, { ownerId: users.sysowner }, otherFrameworkId);
      expect((await mark(users.fwowner, c1)).status).toBe(200);
      for (const userId of [users.sysowner, users.viewer, users.auditor]) {
        expect((await mark(userId, c2)).status).toBe(403);
        expect((await mark(userId, c1, false)).status).toBe(403);
      }
      expect((await mark(null, c2)).status).toBe(401);
      expect(await marked()).toEqual([c1]);
      await mark(users.cm, c1, false);
      await patch(users.cm, { ownerId: null });
      await patch(users.cm, { ownerId: null }, otherFrameworkId);
    });

    it("refuses a Control not mapped to this Framework (even one mapped to another), and writes nothing", async () => {
      expect((await mark(users.cm, unmapped)).status).toBe(409);
      expect((await mark(users.cm, "no-such-control")).status).toBe(404);
      expect((await mark(users.cm, c1, "yes")).status).toBe(400);
      expect(await marked()).toEqual([]);
      expect(await marked(otherFrameworkId)).toEqual([]);
    });

    it("is a 404 for an unknown Framework and for a Draft to someone who can't see Drafts", async () => {
      const draft = await prisma.framework.create({ data: { name: `Test FO Draft ${SUFFIX}`, version: "1", status: "DRAFT", ownerId: users.fwowner } });
      try {
        await prisma.requirement.create({
          data: { frameworkId: draft.id, code: "FO-1", section: "T", title: "t", text: "t", mappings: { create: [{ controlId: c1, coverage: "FULL" }] } },
        });
        expect((await mark(users.fwowner, c1, true, draft.id)).status).toBe(404);
        expect(await marked(draft.id)).toEqual([]);
        expect((await mark(users.cm, c1, true, draft.id)).status).toBe(200);
        expect(await marked(draft.id)).toEqual([c1]);
        expect((await mark(users.cm, c1, true, "no-such-framework")).status).toBe(404);
      } finally {
        await prisma.framework.delete({ where: { id: draft.id } });
      }
    });
  });

  describe("a removed mapping drops the marking", () => {
    const mappingOf = (requirementId: string, controlId: string) => prisma.controlMapping.findFirstOrThrow({ where: { requirementId, controlId } });
    const dropMapping = (fwId: string, requirementId: string, mappingId: string) =>
      deleteMapping(
        req(`/api/frameworks/${fwId}/requirements/${requirementId}/mappings/${mappingId}`, "DELETE", users.cm),
        params({ id: fwId, requirementId, mappingId }),
      );

    it("keeps it while another Requirement still maps the Control, drops it with the last mapping", async () => {
      await mark(users.cm, c1);
      expect((await dropMapping(frameworkId, req1, (await mappingOf(req1, c1)).id)).status).toBe(204);
      expect(await marked()).toEqual([c1]); // still mapped through req2
      expect((await dropMapping(frameworkId, req2, (await mappingOf(req2, c1)).id)).status).toBe(204);
      expect(await marked()).toEqual([]);
    });

    it("drops the markings of Controls whose last mapping went with a deleted Requirement, and no others", async () => {
      await mark(users.cm, c2);
      // c1 has no mapping left (above); map it again through a new Requirement, mark it, and keep that Requirement.
      await mapControlsToFramework(frameworkId, [c1]);
      await mark(users.cm, c1);
      expect(await marked()).toEqual([c1, c2].sort());
      const res = await deleteRequirement(
        req(`/api/frameworks/${frameworkId}/requirements/${req2}`, "DELETE", users.cm),
        params({ id: frameworkId, requirementId: req2 }),
      );
      expect(res.status).toBe(204);
      expect(await marked()).toEqual([c1]); // c2 lost its only mapping, c1 is still mapped through the new one
    });

    it("does not touch another Framework's marking of the same Control", async () => {
      const otherReq = await mapControlsToFramework(otherFrameworkId, [c1]);
      await prisma.frameworkFirstRoundControl.create({ data: { frameworkId: otherFrameworkId, controlId: c1 } });
      expect((await dropMapping(otherFrameworkId, otherReq, (await mappingOf(otherReq, c1)).id)).status).toBe(204);
      expect(await marked(otherFrameworkId)).toEqual([]);
      expect(await marked()).toEqual([c1]);
    });
  });
});
