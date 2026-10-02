import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { requestAs, setupProviderFixtures } from "@/test/provider-fixtures";
import { PATCH } from "../route";

/**
 * Marking and unmarking a System as a Provider (#123, F-IN.2). Self-contained fixtures (CI's DB is
 * migrated, not seeded); every System is Onboarded unless a test says otherwise, so every role can
 * see it and the 403s are real 403s.
 */

const f = setupProviderFixtures("PrvMark");

const ctxFor = (id: string) => ({ params: Promise.resolve({ id }) });
const mark = (systemId: string, userId: string | null, body: unknown = { isProvider: true }) =>
  PATCH(requestAs(`/api/systems/${systemId}/provider`, userId, "PATCH", body), ctxFor(systemId));

const isProvider = async (systemId: string) =>
  (await prisma.system.findUniqueOrThrow({ where: { id: systemId }, select: { isProvider: true } })).isProvider;
const events = (systemId: string) => prisma.changeEvent.findMany({ where: { systemId }, orderBy: { createdAt: "asc" } });

describe("PATCH /api/systems/[id]/provider (#123)", { timeout: 30_000 }, () => {
  describe("who may mark and unmark", () => {
    it.each([
      ["owner", "owner"],
      ["owner who is a Risk Owner", "riskOwnerOwner"],
      ["owner who is a Viewer", "viewerOwner"],
      ["owner who is a Reviewer", "reviewerOwner"],
    ] as const)("lets the %s mark and unmark their System", async (_name, userKey) => {
      const systemId = await f.makeSystem({ ownerId: f.users[userKey] });

      const marked = await mark(systemId, f.users[userKey]);
      expect(marked.status).toBe(200);
      expect(await marked.json()).toEqual({ isProvider: true });
      expect(await isProvider(systemId)).toBe(true);

      const unmarked = await mark(systemId, f.users[userKey], { isProvider: false });
      expect(unmarked.status).toBe(200);
      expect(await unmarked.json()).toEqual({ isProvider: false });
      expect(await isProvider(systemId)).toBe(false);
    });

    it("lets an Admin who is not the owner mark and unmark", async () => {
      const systemId = await f.makeSystem();
      expect((await mark(systemId, f.users.admin)).status).toBe(200);
      expect(await isProvider(systemId)).toBe(true);
      expect((await mark(systemId, f.users.admin, { isProvider: false })).status).toBe(200);
      expect(await isProvider(systemId)).toBe(false);
    });

    it("works at any lifecycle stage, a Draft System included", async () => {
      const systemId = await f.makeSystem({ status: "DRAFT" });
      expect((await mark(systemId, f.users.owner)).status).toBe(200);
      expect(await isProvider(systemId)).toBe(true);
    });

    it.each(["otherOwner", "reviewer", "riskOwner", "viewer", "businessRiskOwner", "complianceManager"] as const)(
      "refuses a %s who is not the owner with 403 and changes nothing",
      async (userKey) => {
        const systemId = await f.makeSystem();

        const response = await mark(systemId, f.users[userKey]);

        expect(response.status).toBe(403);
        expect(await isProvider(systemId)).toBe(false);
        expect(await events(systemId)).toEqual([]);
      },
    );

    it("refuses a Compliance Manager recorded as the owner, and a non-owner trying to unmark", async () => {
      const systemId = await f.makeSystem({ ownerId: f.users.complianceManagerOwner });
      expect((await mark(systemId, f.users.complianceManagerOwner)).status).toBe(403);
      expect(await isProvider(systemId)).toBe(false);

      const provider = await f.makeSystem({ isProvider: true });
      expect((await mark(provider, f.users.otherOwner, { isProvider: false })).status).toBe(403);
      expect(await isProvider(provider)).toBe(true);
      expect(await events(provider)).toEqual([]);
    });

    it("answers 401 when nobody is signed in", async () => {
      const systemId = await f.makeSystem();
      expect((await mark(systemId, null)).status).toBe(401);
      expect(await isProvider(systemId)).toBe(false);
    });

    it("answers 404 for a System the user cannot see (a Draft owned by someone else), before any permission check", async () => {
      const systemId = await f.makeSystem({ status: "DRAFT" });
      expect((await mark(systemId, f.users.viewer)).status).toBe(404);
      expect((await mark(systemId, f.users.otherOwner)).status).toBe(404);
      expect((await mark("no-such-system", f.users.admin)).status).toBe(404);
      expect(await isProvider(systemId)).toBe(false);
    });

    it("answers 400 for a body without a boolean isProvider", async () => {
      const systemId = await f.makeSystem();
      for (const body of [{}, { isProvider: "yes" }, { isProvider: null }, null]) {
        expect((await mark(systemId, f.users.owner, body)).status).toBe(400);
      }
      expect(await isProvider(systemId)).toBe(false);
    });
  });

  describe("unmarking", () => {
    it("is refused with 409 while the System has Offerings, and changes nothing", async () => {
      const systemId = await f.makeSystem({ isProvider: true });
      await f.offer(systemId, f.controls.perSystem.id);

      const response = await mark(systemId, f.users.owner, { isProvider: false });

      expect(response.status).toBe(409);
      expect((await response.json()).error).toMatch(/Offerings/);
      expect(await isProvider(systemId)).toBe(true);
      expect(await prisma.controlOffering.count({ where: { providerId: systemId } })).toBe(1);
      expect(await events(systemId)).toEqual([]);
    });

    it("is allowed once the last Offering is gone", async () => {
      const systemId = await f.makeSystem({ isProvider: true });
      const offering = await f.offer(systemId, f.controls.perSystem.id);
      await prisma.controlOffering.delete({ where: { id: offering.id } });

      expect((await mark(systemId, f.users.owner, { isProvider: false })).status).toBe(200);
      expect(await isProvider(systemId)).toBe(false);
    });
  });

  describe("Change Events", () => {
    it("logs one CLASSIFICATION_CHANGED event per change, by the acting User", async () => {
      const systemId = await f.makeSystem();

      await mark(systemId, f.users.admin);
      await mark(systemId, f.users.owner, { isProvider: false });

      const logged = await events(systemId);
      expect(logged.map((event) => [event.action, event.detail, event.actorId])).toEqual([
        ["CLASSIFICATION_CHANGED", "Marked as a Provider", f.users.admin],
        ["CLASSIFICATION_CHANGED", "No longer a Provider", f.users.owner],
      ]);
    });

    it("is a no-op, writing nothing, when the System is already in that state", async () => {
      const notProvider = await f.makeSystem();
      const provider = await f.makeSystem({ isProvider: true });

      const unmarkAgain = await mark(notProvider, f.users.owner, { isProvider: false });
      const markAgain = await mark(provider, f.users.owner, { isProvider: true });

      expect(unmarkAgain.status).toBe(200);
      expect(await unmarkAgain.json()).toEqual({ isProvider: false });
      expect(markAgain.status).toBe(200);
      expect(await markAgain.json()).toEqual({ isProvider: true });
      expect(await events(notProvider)).toEqual([]);
      expect(await events(provider)).toEqual([]);
    });
  });

  it("changes nothing else: other Systems and the System's own Assessments stay as they were", async () => {
    const systemId = await f.makeSystem();
    const other = await f.makeSystem();
    await f.assess(systemId, f.controls.perSystem.id, "FULFILLED");
    const before = await prisma.controlAssessment.findMany({ where: { systemId: { in: [systemId, other] } }, orderBy: { id: "asc" } });

    await mark(systemId, f.users.owner);
    await mark(systemId, f.users.owner, { isProvider: false });

    expect(await prisma.controlAssessment.findMany({ where: { systemId: { in: [systemId, other] } }, orderBy: { id: "asc" } })).toEqual(before);
    expect(await events(other)).toEqual([]);
  });
});
