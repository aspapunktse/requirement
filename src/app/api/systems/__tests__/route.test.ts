import type { UserRole } from "@prisma/client";
import { NextRequest } from "next/server";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { ACTING_USER_COOKIE } from "@/lib/acting-user";
import { GET, POST } from "../route";

const URL = "http://localhost/api/systems";

const OWNER_EMAIL = "test-systems-owner@example.com";
const OTHER_OWNER_EMAIL = "test-systems-other-owner@example.com";
const VIEWER_EMAIL = "test-systems-viewer@example.com";

const FULL_VISIBILITY_ROLES: { role: UserRole; email: string }[] = [
  { role: "ADMIN", email: "test-systems-admin@example.com" },
  { role: "RISK_OWNER", email: "test-systems-risk-owner@example.com" },
  { role: "REVIEWER", email: "test-systems-reviewer@example.com" },
];

function requestAs(userId: string | null, init?: { method?: string; body?: string }) {
  const headers = new Headers();
  if (userId) headers.set("cookie", `${ACTING_USER_COOKIE}=${userId}`);
  return new NextRequest(URL, { ...init, headers });
}

describe("/api/systems", () => {
  let ownerId: string;
  let otherOwnerId: string;
  let viewerId: string;
  let systemTypeId: string;
  const fullVisibilityUserIds: Record<UserRole, string> = {} as Record<UserRole, string>;
  const createdSystemIds: string[] = [];

  beforeAll(async () => {
    const owner = await prisma.user.upsert({
      where: { email: OWNER_EMAIL },
      update: {},
      create: { email: OWNER_EMAIL, name: "Systems Owner", role: "SYSTEM_OWNER" },
    });
    const otherOwner = await prisma.user.upsert({
      where: { email: OTHER_OWNER_EMAIL },
      update: {},
      create: { email: OTHER_OWNER_EMAIL, name: "Systems Other Owner", role: "SYSTEM_OWNER" },
    });
    const viewer = await prisma.user.upsert({
      where: { email: VIEWER_EMAIL },
      update: {},
      create: { email: VIEWER_EMAIL, name: "Systems Viewer", role: "VIEWER" },
    });
    ownerId = owner.id;
    otherOwnerId = otherOwner.id;
    viewerId = viewer.id;

    for (const { role, email } of FULL_VISIBILITY_ROLES) {
      const user = await prisma.user.upsert({
        where: { email },
        update: {},
        create: { email, name: `Systems ${role}`, role },
      });
      fullVisibilityUserIds[role] = user.id;
    }

    const systemType = await prisma.deploymentFacet.create({
      data: { name: `Test Systems Route Type ${Date.now()}` },
    });
    systemTypeId = systemType.id;
  });

  afterAll(async () => {
    await prisma.system.deleteMany({ where: { id: { in: createdSystemIds } } });
    await prisma.deploymentFacet.deleteMany({ where: { id: systemTypeId } });
    await prisma.user.deleteMany({
      where: {
        email: {
          in: [
            OWNER_EMAIL,
            OTHER_OWNER_EMAIL,
            VIEWER_EMAIL,
            ...FULL_VISIBILITY_ROLES.map((r) => r.email),
          ],
        },
      },
    });
  });

  afterEach(async () => {
    await prisma.system.deleteMany({ where: { id: { in: createdSystemIds } } });
    createdSystemIds.length = 0;
  });

  it("GET rejects an unauthenticated request", async () => {
    const response = await GET(requestAs(null));
    expect(response.status).toBe(401);
  });

  it("POST rejects a request without any deploymentFacetIds", async () => {
    const response = await POST(
      requestAs(ownerId, { method: "POST", body: JSON.stringify({ name: "No Facet System" }) }),
    );
    expect(response.status).toBe(400);
  });

  it("POST rejects an empty deploymentFacetIds array", async () => {
    const response = await POST(
      requestAs(ownerId, {
        method: "POST",
        body: JSON.stringify({ name: "No Facet System", deploymentFacetIds: [] }),
      }),
    );
    expect(response.status).toBe(400);
  });

  it("POST rejects an unknown deploymentFacetId", async () => {
    const response = await POST(
      requestAs(ownerId, {
        method: "POST",
        body: JSON.stringify({ name: "Bad Facet System", deploymentFacetIds: ["does-not-exist"] }),
      }),
    );
    expect(response.status).toBe(400);
  });

  it("POST creates a Draft System owned by the acting user", async () => {
    const response = await POST(
      requestAs(ownerId, {
        method: "POST",
        body: JSON.stringify({ name: "Test System A", deploymentFacetIds: [systemTypeId] }),
      }),
    );
    const body = await response.json();
    createdSystemIds.push(body.system.id);

    expect(response.status).toBe(201);
    expect(body.system).toMatchObject({
      name: "Test System A",
      status: "DRAFT",
      ownerId,
    });
    expect(body.system.deploymentFacets.map((f: { id: string }) => f.id)).toEqual([systemTypeId]);
  });

  it("POST creates a Hybrid System when multiple Deployment Facets are declared", async () => {
    const other = await prisma.deploymentFacet.create({
      data: { name: `Test Systems Route Other Type ${Date.now()}` },
    });

    const response = await POST(
      requestAs(ownerId, {
        method: "POST",
        body: JSON.stringify({ name: "Hybrid System", deploymentFacetIds: [systemTypeId, other.id] }),
      }),
    );
    const body = await response.json();
    createdSystemIds.push(body.system.id);

    expect(response.status).toBe(201);
    expect(body.system.deploymentFacets.map((f: { id: string }) => f.id).sort()).toEqual(
      [systemTypeId, other.id].sort(),
    );

    await prisma.deploymentFacet.delete({ where: { id: other.id } });
  });

  it("a SYSTEM_OWNER sees their own Systems in any status but not another owner's Draft System", async () => {
    const own = await prisma.system.create({
      data: { name: "Owner's Draft", deploymentFacets: { connect: [{ id: systemTypeId }] }, ownerId, status: "DRAFT" },
    });
    const othersDraft = await prisma.system.create({
      data: { name: "Other's Draft", deploymentFacets: { connect: [{ id: systemTypeId }] }, ownerId: otherOwnerId, status: "DRAFT" },
    });
    const othersOnboarded = await prisma.system.create({
      data: { name: "Other's Onboarded", deploymentFacets: { connect: [{ id: systemTypeId }] }, ownerId: otherOwnerId, status: "ONBOARDED" },
    });
    createdSystemIds.push(own.id, othersDraft.id, othersOnboarded.id);

    const response = await GET(requestAs(ownerId));
    const body = await response.json();
    const ids = body.systems.map((s: { id: string }) => s.id);

    expect(ids).toContain(own.id);
    expect(ids).toContain(othersOnboarded.id);
    expect(ids).not.toContain(othersDraft.id);
  });

  it.each(FULL_VISIBILITY_ROLES)(
    "$role sees every System regardless of owner or status",
    async ({ role }) => {
      const othersDraft = await prisma.system.create({
        data: {
          name: `${role} Visible Draft`,
          deploymentFacets: { connect: [{ id: systemTypeId }] },
          ownerId: otherOwnerId,
          status: "DRAFT",
        },
      });
      createdSystemIds.push(othersDraft.id);

      const response = await GET(requestAs(fullVisibilityUserIds[role]));
      const body = await response.json();
      const ids = body.systems.map((s: { id: string }) => s.id);

      expect(ids).toContain(othersDraft.id);
    },
  );

  it("a VIEWER only sees ONBOARDED Systems", async () => {
    const draft = await prisma.system.create({
      data: { name: "Viewer Hidden Draft", deploymentFacets: { connect: [{ id: systemTypeId }] }, ownerId, status: "DRAFT" },
    });
    const onboarded = await prisma.system.create({
      data: { name: "Viewer Visible Onboarded", deploymentFacets: { connect: [{ id: systemTypeId }] }, ownerId, status: "ONBOARDED" },
    });
    createdSystemIds.push(draft.id, onboarded.id);

    const response = await GET(requestAs(viewerId));
    const body = await response.json();
    const ids = body.systems.map((s: { id: string }) => s.id);

    expect(ids).toContain(onboarded.id);
    expect(ids).not.toContain(draft.id);
  });
});
