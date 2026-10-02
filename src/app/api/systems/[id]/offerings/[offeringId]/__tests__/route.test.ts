import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { patchSystemClassification, requestAs, setupProviderFixtures } from "@/test/provider-fixtures";
import { PATCH as markProvider } from "../../../provider/route";
import { DELETE, PATCH } from "../route";

/**
 * Changing and removing a Provider's Control Offerings (#123, F-IN.2). Self-contained fixtures (CI's
 * DB is migrated, not seeded); every System is Onboarded unless a test says otherwise.
 */

const f = setupProviderFixtures("PrvEdit");

const ctxFor = (id: string, offeringId: string) => ({ params: Promise.resolve({ id, offeringId }) });
const change = (systemId: string, offeringId: string, userId: string | null, body: unknown) =>
  PATCH(requestAs(`/api/systems/${systemId}/offerings/${offeringId}`, userId, "PATCH", body), ctxFor(systemId, offeringId));
const remove = (systemId: string, offeringId: string, userId: string | null) =>
  DELETE(requestAs(`/api/systems/${systemId}/offerings/${offeringId}`, userId, "DELETE"), ctxFor(systemId, offeringId));

const stored = (offeringId: string) => prisma.controlOffering.findUnique({ where: { id: offeringId } });
const events = (systemId: string) => prisma.changeEvent.findMany({ where: { systemId }, orderBy: { createdAt: "asc" } });

/** A Provider with one Offering of `perSystem`. */
async function providerWith(
  type: "FULL" | "SHARED",
  customerResponsibility: string | null = null,
  options: Parameters<typeof f.makeSystem>[0] = {},
) {
  const providerId = await f.makeSystem({ isProvider: true, ...options });
  const offering = await f.offer(providerId, f.controls.perSystem.id, type, customerResponsibility);
  return { providerId, offeringId: offering.id };
}

describe("PATCH /api/systems/[id]/offerings/[offeringId] (#123)", { timeout: 30_000 }, () => {
  describe("who may change", () => {
    it.each([
      ["owner", "owner"],
      ["owner who is a Risk Owner", "riskOwnerOwner"],
      ["owner who is a Viewer", "viewerOwner"],
      ["owner who is a Reviewer", "reviewerOwner"],
      ["Admin who is not the owner", "admin"],
    ] as const)("lets the %s change an Offering", async (_name, userKey) => {
      const owner = userKey === "admin" ? f.users.owner : f.users[userKey];
      const { providerId, offeringId } = await providerWith("FULL", null, { ownerId: owner });

      const response = await change(providerId, offeringId, f.users[userKey], { type: "SHARED", customerResponsibility: "Keys" });

      expect(response.status).toBe(200);
      expect(await stored(offeringId)).toMatchObject({ type: "SHARED", customerResponsibility: "Keys" });
      expect((await events(providerId))[0].actorId).toBe(f.users[userKey]);
    });

    it.each(["otherOwner", "reviewer", "riskOwner", "viewer", "businessRiskOwner", "complianceManager"] as const)(
      "refuses a %s who is not the owner with 403 and changes nothing",
      async (userKey) => {
        const { providerId, offeringId } = await providerWith("SHARED", "Keys");
        const before = await stored(offeringId);

        const response = await change(providerId, offeringId, f.users[userKey], { type: "FULL" });

        expect(response.status).toBe(403);
        expect(await stored(offeringId)).toEqual(before);
        expect(await events(providerId)).toEqual([]);
      },
    );

    it("refuses a Compliance Manager recorded as the owner", async () => {
      const { providerId, offeringId } = await providerWith("FULL", null, { ownerId: f.users.complianceManagerOwner });
      const response = await change(providerId, offeringId, f.users.complianceManagerOwner, { type: "SHARED", customerResponsibility: "x" });
      expect(response.status).toBe(403);
      expect((await stored(offeringId))?.type).toBe("FULL");
    });

    it("answers 401 when nobody is signed in, and 404 for a System the user cannot see (before any 403)", async () => {
      const { providerId, offeringId } = await providerWith("FULL");
      expect((await change(providerId, offeringId, null, { type: "SHARED", customerResponsibility: "x" })).status).toBe(401);

      const draft = await providerWith("FULL", null, { status: "DRAFT" });
      expect((await change(draft.providerId, draft.offeringId, f.users.viewer, { type: "SHARED", customerResponsibility: "x" })).status).toBe(404);
      expect((await stored(draft.offeringId))?.type).toBe("FULL");
    });

    it("answers 404 for an Offering that is not this Provider's, even one that exists elsewhere", async () => {
      const mine = await providerWith("FULL");
      const theirs = await providerWith("FULL");

      expect((await change(mine.providerId, theirs.offeringId, f.users.owner, { type: "SHARED", customerResponsibility: "x" })).status).toBe(404);
      expect((await change(mine.providerId, "no-such-offering", f.users.owner, { type: "SHARED", customerResponsibility: "x" })).status).toBe(404);
      expect((await stored(theirs.offeringId))?.type).toBe("FULL");
    });
  });

  describe("the rules on the resulting values", () => {
    it("refuses Full to Shared without a text with 400", async () => {
      const { providerId, offeringId } = await providerWith("FULL");

      const response = await change(providerId, offeringId, f.users.owner, { type: "SHARED" });

      expect(response.status).toBe(400);
      expect((await response.json()).error).toMatch(/customer responsibility/);
      expect((await stored(offeringId))?.type).toBe("FULL");
      expect(await events(providerId)).toEqual([]);
    });

    it.each([
      ["an empty text", ""],
      ["a blank text", "   "],
      ["null", null],
    ])("refuses clearing a Shared Offering's text with %s (400), and keeps the old text", async (_name, text) => {
      const { providerId, offeringId } = await providerWith("SHARED", "Keys");

      const response = await change(providerId, offeringId, f.users.owner, { customerResponsibility: text });

      expect(response.status).toBe(400);
      expect(await stored(offeringId)).toMatchObject({ type: "SHARED", customerResponsibility: "Keys" });
      expect(await events(providerId)).toEqual([]);
    });

    it("changes only the text of a Shared Offering and keeps its type", async () => {
      const { providerId, offeringId } = await providerWith("SHARED", "Keys");

      const response = await change(providerId, offeringId, f.users.owner, { customerResponsibility: "  Keys and backups " });

      expect(response.status).toBe(200);
      expect((await response.json()).offering).toMatchObject({ id: offeringId, type: "SHARED", customerResponsibility: "Keys and backups" });
      expect(await stored(offeringId)).toMatchObject({ type: "SHARED", customerResponsibility: "Keys and backups" });
    });

    it("clears the text when a Shared Offering becomes Full, even if the old text is sent back", async () => {
      const { providerId, offeringId } = await providerWith("SHARED", "Keys");

      const response = await change(providerId, offeringId, f.users.owner, { type: "FULL", customerResponsibility: "Keys" });

      expect(response.status).toBe(200);
      expect((await response.json()).offering).toMatchObject({ type: "FULL", customerResponsibility: null });
      expect(await stored(offeringId)).toMatchObject({ type: "FULL", customerResponsibility: null });
    });

    it("ignores a text sent for a Full Offering", async () => {
      const { providerId, offeringId } = await providerWith("FULL");
      const response = await change(providerId, offeringId, f.users.owner, { customerResponsibility: "x" });
      expect(response.status).toBe(200);
      expect((await stored(offeringId))?.customerResponsibility).toBeNull();
      expect(await events(providerId)).toEqual([]);
    });

    it.each([
      ["no fields", {}],
      ["an unknown type", { type: "PARTIAL" }],
      ["a text of the wrong kind", { customerResponsibility: 5 }],
      ["not an object", null],
    ])("refuses %s with 400", async (_name, body) => {
      const { providerId, offeringId } = await providerWith("SHARED", "Keys");
      expect((await change(providerId, offeringId, f.users.owner, body)).status).toBe(400);
      expect(await stored(offeringId)).toMatchObject({ type: "SHARED", customerResponsibility: "Keys" });
    });
  });

  describe("Change Events", () => {
    it("logs one CONTROL_OFFERING_CHANGED event per change, naming the Control and what changed", async () => {
      const { providerId, offeringId } = await providerWith("FULL");
      const code = f.controls.perSystem.code;

      await change(providerId, offeringId, f.users.owner, { type: "SHARED", customerResponsibility: "Keys" });
      await change(providerId, offeringId, f.users.admin, { customerResponsibility: "Keys and backups" });
      await change(providerId, offeringId, f.users.owner, { type: "FULL" });

      expect((await events(providerId)).map((event) => [event.action, event.detail, event.actorId])).toEqual([
        ["CONTROL_OFFERING_CHANGED", `Control Offering for ${code} changed (Full → Shared)`, f.users.owner],
        ["CONTROL_OFFERING_CHANGED", `Control Offering for ${code} changed (customer responsibility updated)`, f.users.admin],
        ["CONTROL_OFFERING_CHANGED", `Control Offering for ${code} changed (Shared → Full)`, f.users.owner],
      ]);
    });

    it("writes nothing for a change that leaves the values as they are", async () => {
      const shared = await providerWith("SHARED", "Keys");
      const full = await providerWith("FULL");
      const before = await stored(shared.offeringId);

      const same = await change(shared.providerId, shared.offeringId, f.users.owner, { type: "SHARED", customerResponsibility: " Keys " });
      const alsoSame = await change(full.providerId, full.offeringId, f.users.owner, { type: "FULL" });

      expect(same.status).toBe(200);
      expect(alsoSame.status).toBe(200);
      expect(await stored(shared.offeringId)).toEqual(before); // updatedAt not bumped
      expect(await events(shared.providerId)).toEqual([]);
      expect(await events(full.providerId)).toEqual([]);
    });
  });

  it("still works when the Control no longer applies to the Provider", async () => {
    const providerId = await f.makeSystem({ isProvider: true });
    const offering = await f.offer(providerId, f.controls.stale.id, "FULL");
    await patchSystemClassification(providerId, f.users.owner, { deploymentFacetIds: [f.facets.live] });

    const response = await change(providerId, offering.id, f.users.owner, { type: "SHARED", customerResponsibility: "Keys" });

    expect(response.status).toBe(200);
    expect((await response.json()).offering).toMatchObject({ type: "SHARED", applies: false });
  });
});

describe("DELETE /api/systems/[id]/offerings/[offeringId] (#123)", { timeout: 30_000 }, () => {
  it.each([
    ["owner", "owner"],
    ["owner who is a Risk Owner", "riskOwnerOwner"],
    ["Admin who is not the owner", "admin"],
  ] as const)("lets the %s remove an Offering", async (_name, userKey) => {
    const owner = userKey === "admin" ? f.users.owner : f.users[userKey];
    const { providerId, offeringId } = await providerWith("SHARED", "Keys", { ownerId: owner });

    const response = await remove(providerId, offeringId, f.users[userKey]);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ id: offeringId });
    expect(await stored(offeringId)).toBeNull();
  });

  it.each(["otherOwner", "reviewer", "riskOwner", "viewer", "businessRiskOwner", "complianceManager"] as const)(
    "refuses a %s who is not the owner with 403 and changes nothing",
    async (userKey) => {
      const { providerId, offeringId } = await providerWith("FULL");

      const response = await remove(providerId, offeringId, f.users[userKey]);

      expect(response.status).toBe(403);
      expect(await stored(offeringId)).not.toBeNull();
      expect(await events(providerId)).toEqual([]);
    },
  );

  it("refuses a Compliance Manager recorded as the owner", async () => {
    const { providerId, offeringId } = await providerWith("FULL", null, { ownerId: f.users.complianceManagerOwner });
    expect((await remove(providerId, offeringId, f.users.complianceManagerOwner)).status).toBe(403);
    expect(await stored(offeringId)).not.toBeNull();
  });

  it("answers 401, 404 for an invisible System, and 404 for an Offering that is not this Provider's", async () => {
    const mine = await providerWith("FULL");
    const theirs = await providerWith("FULL");
    const draft = await providerWith("FULL", null, { status: "DRAFT" });

    expect((await remove(mine.providerId, mine.offeringId, null)).status).toBe(401);
    expect((await remove(draft.providerId, draft.offeringId, f.users.viewer)).status).toBe(404);
    expect((await remove(mine.providerId, theirs.offeringId, f.users.owner)).status).toBe(404);
    expect((await remove(mine.providerId, "no-such-offering", f.users.owner)).status).toBe(404);
    expect(await stored(mine.offeringId)).not.toBeNull();
    expect(await stored(theirs.offeringId)).not.toBeNull();
    expect(await stored(draft.offeringId)).not.toBeNull();
  });

  it("logs one CONTROL_OFFERING_CHANGED event recording what the Offering was, in the same step", async () => {
    const shared = await providerWith("SHARED", "Keys");
    const full = await providerWith("FULL");
    const code = f.controls.perSystem.code;

    await remove(shared.providerId, shared.offeringId, f.users.owner);
    await remove(full.providerId, full.offeringId, f.users.admin);

    expect((await events(shared.providerId)).map((event) => [event.action, event.detail, event.actorId])).toEqual([
      ["CONTROL_OFFERING_CHANGED", `Control Offering for ${code} removed (was Shared)`, f.users.owner],
    ]);
    expect((await events(full.providerId)).map((event) => [event.action, event.detail, event.actorId])).toEqual([
      ["CONTROL_OFFERING_CHANGED", `Control Offering for ${code} removed (was Full)`, f.users.admin],
    ]);
  });

  it("still works when the Control no longer applies to the Provider, and leaves the Provider's Assessment alone", async () => {
    const providerId = await f.makeSystem({ isProvider: true });
    await f.assess(providerId, f.controls.stale.id, "FULFILLED");
    const offering = await f.offer(providerId, f.controls.stale.id);
    await patchSystemClassification(providerId, f.users.owner, { deploymentFacetIds: [f.facets.live] });

    expect((await remove(providerId, offering.id, f.users.owner)).status).toBe(200);

    expect(await stored(offering.id)).toBeNull();
    expect((await prisma.controlAssessment.findMany({ where: { systemId: providerId, controlId: f.controls.stale.id } })).length).toBe(1);
  });

  it("lets the Provider be unmarked afterwards", async () => {
    const { providerId, offeringId } = await providerWith("FULL");
    await remove(providerId, offeringId, f.users.owner);

    const response = await markProvider(requestAs(`/api/systems/${providerId}/provider`, f.users.owner, "PATCH", { isProvider: false }), {
      params: Promise.resolve({ id: providerId }),
    });

    expect(response.status).toBe(200);
  });
});
