import { NextRequest } from "next/server";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { mapControlsToBase, cleanupFixtureRequirements } from "@/test/framework-fixtures";
import { ACTING_USER_COOKIE } from "@/lib/acting-user";
import { PATCH } from "../route";

const OWNER_EMAIL = "test-facet-change-owner@example.com";
const OTHER_OWNER_EMAIL = "test-facet-change-other-owner@example.com";
const ADMIN_EMAIL = "test-facet-change-admin@example.com";

function urlFor(id: string) {
  return `http://localhost/api/systems/${id}`;
}

function requestAs(id: string, userId: string | null, body?: unknown) {
  const headers = new Headers({ "Content-Type": "application/json" });
  if (userId) headers.set("cookie", `${ACTING_USER_COOKIE}=${userId}`);
  return new NextRequest(urlFor(id), {
    method: "PATCH",
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

function ctxFor(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe("PATCH /api/systems/[id] (Deployment Facet change)", () => {
  let ownerId: string;
  let otherOwnerId: string;
  let adminId: string;
  let typeAId: string;
  let typeBId: string;
  let systemId: string;

  // Control applicable only to Facet A
  let onlyAId: string;
  // Control applicable only to Facet B
  let onlyBId: string;
  // Facet the "true union" test bootstraps the System onto
  let bootstrapFacetId: string;
  // Control applicable on every Facet this file uses (not unscoped: that would reach other files' Systems, #231)
  let bothId: string;

  beforeAll(async () => {
    const owner = await prisma.user.upsert({
      where: { email: OWNER_EMAIL },
      update: {},
      create: { email: OWNER_EMAIL, name: "Facet Change Owner", role: "SYSTEM_OWNER" },
    });
    const otherOwner = await prisma.user.upsert({
      where: { email: OTHER_OWNER_EMAIL },
      update: {},
      create: { email: OTHER_OWNER_EMAIL, name: "Facet Change Other Owner", role: "SYSTEM_OWNER" },
    });
    const admin = await prisma.user.upsert({
      where: { email: ADMIN_EMAIL },
      update: {},
      create: { email: ADMIN_EMAIL, name: "Facet Change Admin", role: "ADMIN" },
    });
    ownerId = owner.id;
    otherOwnerId = otherOwner.id;
    adminId = admin.id;

    const suffix = Date.now();
    const typeA = await prisma.deploymentFacet.create({ data: { name: `Facet A ${suffix}` } });
    const typeB = await prisma.deploymentFacet.create({ data: { name: `Facet B ${suffix}` } });
    typeAId = typeA.id;
    typeBId = typeB.id;
    bootstrapFacetId = (await prisma.deploymentFacet.create({ data: { name: `Facet Bootstrap ${suffix}` } })).id;

    const onlyA = await prisma.control.create({
      data: {
        code: `TC-A-${suffix}`,
        title: "Only for Facet A",
        description: "desc",
        category: "Security",
        applicability: "PER_SYSTEM",
        deploymentFacets: { connect: [{ id: typeAId }] },
      },
    });
    const onlyB = await prisma.control.create({
      data: {
        code: `TC-B-${suffix}`,
        title: "Only for Facet B",
        description: "desc",
        category: "Security",
        applicability: "PER_SYSTEM",
        deploymentFacets: { connect: [{ id: typeBId }] },
      },
    });
    const both = await prisma.control.create({
      data: {
        code: `TC-BOTH-${suffix}`,
        title: "Applies on every facet here",
        description: "desc",
        category: "Security",
        applicability: "PER_SYSTEM",
        deploymentFacets: { connect: [{ id: typeAId }, { id: typeBId }, { id: bootstrapFacetId }] },
      },
    });
    onlyAId = onlyA.id;
    onlyBId = onlyB.id;
    bothId = both.id;
    await mapControlsToBase([onlyAId, onlyBId, bothId]);
  });

  afterAll(async () => {
    await cleanupFixtureRequirements(); // before the Controls, so no fixture base Requirement is left unmapped (#231)
    await prisma.system.deleteMany({ where: { id: systemId } });
    await prisma.control.deleteMany({ where: { id: { in: [onlyAId, onlyBId, bothId] } } });
    await prisma.deploymentFacet.deleteMany({ where: { id: { in: [typeAId, typeBId, bootstrapFacetId] } } });
    await prisma.user.deleteMany({ where: { email: { in: [OWNER_EMAIL, OTHER_OWNER_EMAIL, ADMIN_EMAIL] } } });
  });

  beforeEach(async () => {
    const system = await prisma.system.create({
      data: { name: "Facet Change System", deploymentFacets: { connect: [{ id: typeAId }] }, ownerId, status: "DRAFT" },
    });
    systemId = system.id;
  });

  afterEach(async () => {
    await prisma.controlAssessment.deleteMany({ where: { systemId } });
    await prisma.system.deleteMany({ where: { id: systemId } });
  });

  it("rejects an unauthenticated request", async () => {
    const response = await PATCH(
      requestAs(systemId, null, { deploymentFacetIds: [typeBId] }),
      ctxFor(systemId),
    );
    expect(response.status).toBe(401);
  });

  it("forbids a SYSTEM_OWNER who doesn't own this System", async () => {
    await prisma.system.update({ where: { id: systemId }, data: { status: "ONBOARDED" } });
    const response = await PATCH(
      requestAs(systemId, otherOwnerId, { deploymentFacetIds: [typeBId] }),
      ctxFor(systemId),
    );
    expect(response.status).toBe(403);
  });

  // ADR 0006 removed the Draft-only lock (#51): classification changes at any lifecycle stage, and never moves the status.
  it.each(["IN_REVIEW", "APPROVED", "ONBOARDED"] as const)(
    "lets the owner change Facets on a %s System: the Assessments recompute and the status is unchanged",
    async (status) => {
      await prisma.system.update({ where: { id: systemId }, data: { status } });
      await prisma.controlAssessment.create({ data: { systemId, controlId: onlyAId } });
      const response = await PATCH(
        requestAs(systemId, ownerId, { deploymentFacetIds: [typeBId] }),
        ctxFor(systemId),
      );
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ added: 1, removed: 1 });
      expect((await prisma.system.findUniqueOrThrow({ where: { id: systemId } })).status).toBe(status);
      const controlIds = (await prisma.controlAssessment.findMany({ where: { systemId } })).map((a) => a.controlId);
      expect(controlIds).toEqual([onlyBId]);
    },
  );

  it("lets an ADMIN change Facets on an Onboarded System they don't own", async () => {
    await prisma.system.update({ where: { id: systemId }, data: { status: "ONBOARDED" } });
    const response = await PATCH(requestAs(systemId, adminId, { deploymentFacetIds: [typeBId] }), ctxFor(systemId));
    expect(response.status).toBe(200);
    expect((await prisma.system.findUniqueOrThrow({ where: { id: systemId } })).status).toBe("ONBOARDED");
  });

  it("rejects an empty deploymentFacetIds array", async () => {
    const response = await PATCH(requestAs(systemId, ownerId, { deploymentFacetIds: [] }), ctxFor(systemId));
    expect(response.status).toBe(400);
  });

  it("rejects an unknown deploymentFacetId", async () => {
    const response = await PATCH(
      requestAs(systemId, ownerId, { deploymentFacetIds: ["does-not-exist"] }),
      ctxFor(systemId),
    );
    expect(response.status).toBe(400);
  });

  it("creates NOT_STARTED rows for newly-applicable Controls and removes untouched no-longer-applicable ones", async () => {
    const response = await PATCH(
      requestAs(systemId, ownerId, { deploymentFacetIds: [typeBId] }),
      ctxFor(systemId),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.system.deploymentFacets.map((f: { id: string }) => f.id)).toEqual([typeBId]);
    expect(body.added).toBe(1);
    expect(body.removed).toBe(0);

    const onlyBAssessment = await prisma.controlAssessment.findUnique({
      where: { systemId_controlId: { systemId, controlId: onlyBId } },
    });
    expect(onlyBAssessment).toMatchObject({ status: "NOT_STARTED", assessedById: null });

    const onlyAAssessment = await prisma.controlAssessment.findUnique({
      where: { systemId_controlId: { systemId, controlId: onlyAId } },
    });
    expect(onlyAAssessment).toBeNull();

    const event = await prisma.changeEvent.findFirst({
      where: { systemId, action: "CLASSIFICATION_CHANGED" },
      orderBy: { createdAt: "desc" },
    });
    expect(event?.actorId).toBe(ownerId);
  });

  it("leaves a manually-touched no-longer-applicable Assessment in place instead of deleting it", async () => {
    await prisma.controlAssessment.create({
      data: {
        systemId,
        controlId: onlyAId,
        status: "FULFILLED",
        assessedById: ownerId,
        assessedAt: new Date(),
      },
    });

    const response = await PATCH(
      requestAs(systemId, ownerId, { deploymentFacetIds: [typeBId] }),
      ctxFor(systemId),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.removed).toBe(0);

    const stillThere = await prisma.controlAssessment.findUnique({
      where: { systemId_controlId: { systemId, controlId: onlyAId } },
    });
    expect(stillThere).not.toBeNull();
    expect(stillThere?.status).toBe("FULFILLED");
  });

  it("does not touch an Assessment for a Control applicable regardless of facet", async () => {
    await prisma.controlAssessment.create({
      data: { systemId, controlId: bothId, status: "IN_PROGRESS" },
    });

    await PATCH(requestAs(systemId, ownerId, { deploymentFacetIds: [typeBId] }), ctxFor(systemId));

    const stillThere = await prisma.controlAssessment.findUnique({
      where: { systemId_controlId: { systemId, controlId: bothId } },
    });
    expect(stillThere?.status).toBe("IN_PROGRESS");
  });

  it("lets an ADMIN change any Draft System's Facets", async () => {
    const response = await PATCH(
      requestAs(systemId, adminId, { deploymentFacetIds: [typeBId] }),
      ctxFor(systemId),
    );
    expect(response.status).toBe(200);
  });

  it("declaring both Facets (Hybrid) gets the union of what each requires", async () => {
    // Started with only Facet A declared (via beforeEach's direct prisma
    // create, so no Assessments exist yet at all — none have been computed
    // for this System before this PATCH). Adding Facet B should pull in
    // everything either Facet requires: onlyA (already in scope via A),
    // onlyB (newly in scope via B), and both (always in scope).
    const response = await PATCH(
      requestAs(systemId, ownerId, { deploymentFacetIds: [typeAId, typeBId] }),
      ctxFor(systemId),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.system.deploymentFacets.map((f: { id: string }) => f.id).sort()).toEqual(
      [typeAId, typeBId].sort(),
    );
    // Only onlyB is *newly* applicable — onlyA was already covered by the
    // System's existing Facet A, so it's not part of this diff (and never
    // got an Assessment row in the first place, since beforeEach creates
    // the System directly rather than through a recompute-triggering path).
    expect(body.added).toBe(1);
    expect(body.removed).toBe(0);

    const onlyBAssessment = await prisma.controlAssessment.findUnique({
      where: { systemId_controlId: { systemId, controlId: onlyBId } },
    });
    expect(onlyBAssessment).toMatchObject({ status: "NOT_STARTED" });
  });

  it("recomputes as a true union: a facet-only System first, then Hybrid, ends up with every Control either Facet requires", async () => {
    // Bootstrap: PATCH to a *different* single Facet first, forcing a real
    // recompute against an empty starting Assessment set, then add the
    // second Facet — proving the union covers every already-applicable
    // Control too, not just the newly-added Facet's.
    const other = { id: bootstrapFacetId };
    await PATCH(requestAs(systemId, ownerId, { deploymentFacetIds: [other.id] }), ctxFor(systemId));

    const response = await PATCH(
      requestAs(systemId, ownerId, { deploymentFacetIds: [other.id, typeAId, typeBId] }),
      ctxFor(systemId),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.added).toBe(2); // onlyA and onlyB both newly applicable

    const [onlyAAssessment, onlyBAssessment] = await Promise.all([
      prisma.controlAssessment.findUnique({
        where: { systemId_controlId: { systemId, controlId: onlyAId } },
      }),
      prisma.controlAssessment.findUnique({
        where: { systemId_controlId: { systemId, controlId: onlyBId } },
      }),
    ]);
    expect(onlyAAssessment).toMatchObject({ status: "NOT_STARTED" });
    expect(onlyBAssessment).toMatchObject({ status: "NOT_STARTED" });
  });
});
