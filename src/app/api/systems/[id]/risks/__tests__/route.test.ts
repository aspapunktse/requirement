import { NextRequest } from "next/server";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { ACTING_USER_COOKIE } from "@/lib/acting-user";
import { GET, POST } from "../route";

const OWNER_EMAIL = "test-risks-owner@example.com";
const OTHER_OWNER_EMAIL = "test-risks-other-owner@example.com";
const RISK_OWNER_EMAIL = "test-risks-risk-owner@example.com";
const VIEWER_EMAIL = "test-risks-viewer@example.com";

function urlFor(id: string) {
  return `http://localhost/api/systems/${id}/risks`;
}

function requestAs(id: string, userId: string | null, init?: { method?: string; body?: unknown }) {
  const headers = new Headers({ "Content-Type": "application/json" });
  if (userId) headers.set("cookie", `${ACTING_USER_COOKIE}=${userId}`);
  return new NextRequest(urlFor(id), {
    method: init?.method,
    headers,
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
}

function ctxFor(id: string) {
  return { params: Promise.resolve({ id }) };
}

const RISK_BODY = { title: "Test Risk", description: "Something bad", severity: "HIGH", likelihood: "MEDIUM" };

describe("/api/systems/[id]/risks", () => {
  let ownerId: string;
  let otherOwnerId: string;
  let riskOwnerId: string;
  let viewerId: string;
  let systemTypeId: string;
  let systemId: string;
  let onboardedSystemId: string;
  const createdRiskIds: string[] = [];

  beforeAll(async () => {
    const owner = await prisma.user.upsert({
      where: { email: OWNER_EMAIL },
      update: {},
      create: { email: OWNER_EMAIL, name: "Risks Owner", role: "SYSTEM_OWNER" },
    });
    const otherOwner = await prisma.user.upsert({
      where: { email: OTHER_OWNER_EMAIL },
      update: {},
      create: { email: OTHER_OWNER_EMAIL, name: "Risks Other Owner", role: "SYSTEM_OWNER" },
    });
    const riskOwner = await prisma.user.upsert({
      where: { email: RISK_OWNER_EMAIL },
      update: {},
      create: { email: RISK_OWNER_EMAIL, name: "Risks Risk Owner", role: "RISK_OWNER" },
    });
    const viewer = await prisma.user.upsert({
      where: { email: VIEWER_EMAIL },
      update: {},
      create: { email: VIEWER_EMAIL, name: "Risks Viewer", role: "VIEWER" },
    });
    ownerId = owner.id;
    otherOwnerId = otherOwner.id;
    riskOwnerId = riskOwner.id;
    viewerId = viewer.id;

    const systemType = await prisma.deploymentFacet.create({
      data: { name: `Test Risks Type ${Date.now()}` },
    });
    systemTypeId = systemType.id;

    const system = await prisma.system.create({
      data: { name: "Risks Test System", deploymentFacets: { connect: [{ id: systemTypeId }] }, ownerId, status: "DRAFT" },
    });
    systemId = system.id;

    const onboardedSystem = await prisma.system.create({
      data: { name: "Risks Onboarded System", deploymentFacets: { connect: [{ id: systemTypeId }] }, ownerId, status: "ONBOARDED" },
    });
    onboardedSystemId = onboardedSystem.id;
  });

  afterAll(async () => {
    await prisma.risk.deleteMany({ where: { systemId: { in: [systemId, onboardedSystemId] } } });
    await prisma.system.deleteMany({ where: { id: { in: [systemId, onboardedSystemId] } } });
    await prisma.deploymentFacet.deleteMany({ where: { id: systemTypeId } });
    await prisma.user.deleteMany({
      where: { email: { in: [OWNER_EMAIL, OTHER_OWNER_EMAIL, RISK_OWNER_EMAIL, VIEWER_EMAIL] } },
    });
  });

  afterEach(async () => {
    await prisma.risk.deleteMany({ where: { id: { in: createdRiskIds } } });
    createdRiskIds.length = 0;
  });

  it("GET rejects an unauthenticated request", async () => {
    const response = await GET(requestAs(systemId, null), ctxFor(systemId));
    expect(response.status).toBe(401);
  });

  it("GET returns 404 for a System the acting user cannot see", async () => {
    const response = await GET(requestAs(systemId, viewerId), ctxFor(systemId));
    expect(response.status).toBe(404);
  });

  it("POST lets the owning SYSTEM_OWNER log a Risk", async () => {
    const response = await POST(
      requestAs(systemId, ownerId, { method: "POST", body: RISK_BODY }),
      ctxFor(systemId),
    );
    const body = await response.json();
    if (response.status === 201) createdRiskIds.push(body.risk.id);

    expect(response.status).toBe(201);
    expect(body.risk).toMatchObject({ title: "Test Risk", status: "OPEN", controlAssessment: null });
  });

  it("POST forbids a SYSTEM_OWNER who doesn't own this System (but can see it)", async () => {
    const response = await POST(
      requestAs(onboardedSystemId, otherOwnerId, { method: "POST", body: RISK_BODY }),
      ctxFor(onboardedSystemId),
    );
    expect(response.status).toBe(403);
  });

  it("POST lets a RISK_OWNER log a Risk on any System", async () => {
    const response = await POST(
      requestAs(systemId, riskOwnerId, { method: "POST", body: RISK_BODY }),
      ctxFor(systemId),
    );
    const body = await response.json();
    if (response.status === 201) createdRiskIds.push(body.risk.id);

    expect(response.status).toBe(201);
  });

  it("POST forbids a VIEWER (even on a System they can see)", async () => {
    const response = await POST(
      requestAs(onboardedSystemId, viewerId, { method: "POST", body: RISK_BODY }),
      ctxFor(onboardedSystemId),
    );
    expect(response.status).toBe(403);
  });

  it("POST rejects an invalid body", async () => {
    const response = await POST(
      requestAs(systemId, ownerId, { method: "POST", body: { title: "" } }),
      ctxFor(systemId),
    );
    expect(response.status).toBe(400);
  });

  it("GET lists logged Risks", async () => {
    const created = await prisma.risk.create({
      data: { systemId, title: "Listed Risk", description: "desc", severity: "LOW", likelihood: "LOW" },
    });
    createdRiskIds.push(created.id);

    const response = await GET(requestAs(systemId, ownerId), ctxFor(systemId));
    const body = await response.json();
    const ids = body.risks.map((r: { id: string }) => r.id);

    expect(ids).toContain(created.id);
  });
});
