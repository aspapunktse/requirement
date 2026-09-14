import { NextRequest } from "next/server";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { ACTING_USER_COOKIE } from "@/lib/acting-user";
import { POST } from "../route";
import { DELETE } from "../[capabilityId]/route";

const OWNER_EMAIL = "test-cap-fulfillment-owner@example.com";

function postUrlFor(id: string) {
  return `http://localhost/api/systems/${id}/capabilities`;
}

function deleteUrlFor(id: string, capabilityId: string) {
  return `http://localhost/api/systems/${id}/capabilities/${capabilityId}`;
}

function postAs(id: string, userId: string, capabilityId: string) {
  return new NextRequest(postUrlFor(id), {
    method: "POST",
    headers: new Headers({ "Content-Type": "application/json", cookie: `${ACTING_USER_COOKIE}=${userId}` }),
    body: JSON.stringify({ capabilityId }),
  });
}

function deleteAs(id: string, userId: string, capabilityId: string) {
  return new NextRequest(deleteUrlFor(id, capabilityId), {
    method: "DELETE",
    headers: new Headers({ cookie: `${ACTING_USER_COOKIE}=${userId}` }),
  });
}

function postCtxFor(id: string) {
  return { params: Promise.resolve({ id }) };
}

function deleteCtxFor(id: string, capabilityId: string) {
  return { params: Promise.resolve({ id, capabilityId }) };
}

describe("Capability declare/undeclare auto-fulfillment", () => {
  let ownerId: string;
  let systemTypeId: string;
  let systemId: string;
  let capabilityAId: string;
  let capabilityBId: string;
  let mappedRequirementId: string;
  let unmappedRequirementId: string;

  beforeAll(async () => {
    const owner = await prisma.user.upsert({
      where: { email: OWNER_EMAIL },
      update: {},
      create: { email: OWNER_EMAIL, name: "Cap Fulfillment Owner", role: "SYSTEM_OWNER" },
    });
    ownerId = owner.id;

    const systemType = await prisma.deploymentFacet.create({
      data: { name: `Test Cap Fulfillment Type ${Date.now()}` },
    });
    systemTypeId = systemType.id;

    const suffix = Date.now();
    const capabilityA = await prisma.capability.create({ data: { name: `Active Directory ${suffix}` } });
    const capabilityB = await prisma.capability.create({ data: { name: `Central IAM ${suffix}` } });
    capabilityAId = capabilityA.id;
    capabilityBId = capabilityB.id;

    const mapped = await prisma.requirement.create({
      data: {
        code: `CAP-FUL-${suffix}`,
        title: "Fulfilled by Capability",
        description: "desc",
        category: "Security",
        applicability: "PER_SYSTEM",
        mandatory: true,
        capabilities: { connect: [{ id: capabilityAId }, { id: capabilityBId }] },
      },
    });
    const unmapped = await prisma.requirement.create({
      data: {
        code: `CAP-UNM-${suffix}`,
        title: "Not mapped to any Capability",
        description: "desc",
        category: "Security",
        applicability: "PER_SYSTEM",
      },
    });
    mappedRequirementId = mapped.id;
    unmappedRequirementId = unmapped.id;
  });

  afterAll(async () => {
    await prisma.requirementAssessment.deleteMany({ where: { systemId } });
    await prisma.system.deleteMany({ where: { id: systemId } });
    await prisma.requirement.deleteMany({ where: { id: { in: [mappedRequirementId, unmappedRequirementId] } } });
    await prisma.capability.deleteMany({ where: { id: { in: [capabilityAId, capabilityBId] } } });
    await prisma.deploymentFacet.deleteMany({ where: { id: systemTypeId } });
    await prisma.user.deleteMany({ where: { email: OWNER_EMAIL } });
  });

  beforeEach(async () => {
    const system = await prisma.system.create({
      data: { name: "Cap Fulfillment System", deploymentFacets: { connect: [{ id: systemTypeId }] }, ownerId, status: "DRAFT" },
    });
    systemId = system.id;
  });

  afterEach(async () => {
    await prisma.requirementAssessment.deleteMany({ where: { systemId } });
    await prisma.system.deleteMany({ where: { id: systemId } });
  });

  it("declaring a mapped Capability auto-fulfills the Requirement with an identifying note", async () => {
    await POST(postAs(systemId, ownerId, capabilityAId), postCtxFor(systemId));

    const assessment = await prisma.requirementAssessment.findUnique({
      where: { systemId_requirementId: { systemId, requirementId: mappedRequirementId } },
    });
    expect(assessment).toMatchObject({
      status: "FULFILLED",
      fulfilledByCapabilityId: capabilityAId,
    });
    expect(assessment?.notes).toContain("Active Directory");
    expect(assessment?.assessedById).toBeNull();
  });

  it("does not touch Requirements the Capability isn't mapped to", async () => {
    await POST(postAs(systemId, ownerId, capabilityAId), postCtxFor(systemId));

    const assessment = await prisma.requirementAssessment.findUnique({
      where: { systemId_requirementId: { systemId, requirementId: unmappedRequirementId } },
    });
    expect(assessment).toBeNull();
  });

  it("un-declaring the Capability reverts the auto-fulfilled Assessment to Not Started", async () => {
    await POST(postAs(systemId, ownerId, capabilityAId), postCtxFor(systemId));
    await DELETE(deleteAs(systemId, ownerId, capabilityAId), deleteCtxFor(systemId, capabilityAId));

    const assessment = await prisma.requirementAssessment.findUnique({
      where: { systemId_requirementId: { systemId, requirementId: mappedRequirementId } },
    });
    expect(assessment).toMatchObject({
      status: "NOT_STARTED",
      notes: null,
      fulfilledByCapabilityId: null,
    });
  });

  it("does not revert an Assessment a human has manually touched since auto-fulfillment", async () => {
    await POST(postAs(systemId, ownerId, capabilityAId), postCtxFor(systemId));

    // Human manually edits it (e.g. adds evidence), which should clear the auto-fulfillment marker.
    await prisma.requirementAssessment.update({
      where: { systemId_requirementId: { systemId, requirementId: mappedRequirementId } },
      data: { assessedById: ownerId, assessedAt: new Date(), fulfilledByCapabilityId: null },
    });

    await DELETE(deleteAs(systemId, ownerId, capabilityAId), deleteCtxFor(systemId, capabilityAId));

    const assessment = await prisma.requirementAssessment.findUnique({
      where: { systemId_requirementId: { systemId, requirementId: mappedRequirementId } },
    });
    expect(assessment?.status).toBe("FULFILLED");
  });

  it("keeps a Requirement Fulfilled, re-attributed, when a second mapped Capability is still declared", async () => {
    await POST(postAs(systemId, ownerId, capabilityAId), postCtxFor(systemId));
    await POST(postAs(systemId, ownerId, capabilityBId), postCtxFor(systemId));

    await DELETE(deleteAs(systemId, ownerId, capabilityAId), deleteCtxFor(systemId, capabilityAId));

    const assessment = await prisma.requirementAssessment.findUnique({
      where: { systemId_requirementId: { systemId, requirementId: mappedRequirementId } },
    });
    expect(assessment).toMatchObject({ status: "FULFILLED", fulfilledByCapabilityId: capabilityBId });
    expect(assessment?.notes).toContain("Central IAM");
  });

  it("a manual PATCH clears the auto-fulfillment marker, making the Assessment immune to reversion", async () => {
    await POST(postAs(systemId, ownerId, capabilityAId), postCtxFor(systemId));

    const { PATCH } = await import("../../assessments/[requirementId]/route");
    await PATCH(
      new NextRequest(`http://localhost/api/systems/${systemId}/assessments/${mappedRequirementId}`, {
        method: "PATCH",
        headers: new Headers({
          "Content-Type": "application/json",
          cookie: `${ACTING_USER_COOKIE}=${ownerId}`,
        }),
        body: JSON.stringify({ status: "FULFILLED", evidence: "manually confirmed" }),
      }),
      { params: Promise.resolve({ id: systemId, requirementId: mappedRequirementId }) },
    );

    await DELETE(deleteAs(systemId, ownerId, capabilityAId), deleteCtxFor(systemId, capabilityAId));

    const assessment = await prisma.requirementAssessment.findUnique({
      where: { systemId_requirementId: { systemId, requirementId: mappedRequirementId } },
    });
    expect(assessment).toMatchObject({ status: "FULFILLED", fulfilledByCapabilityId: null });
    expect(assessment?.evidence).toBe("manually confirmed");
  });
});
