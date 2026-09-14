import { NextRequest } from "next/server";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { ACTING_USER_COOKIE } from "@/lib/acting-user";
import { DELETE, PATCH } from "../route";

const ADMIN_EMAIL = "test-deployment-facet-edit-admin@example.com";
const VIEWER_EMAIL = "test-deployment-facet-edit-viewer@example.com";

function urlFor(id: string) {
  return `http://localhost/api/deployment-facets/${id}`;
}

function requestAs(id: string, userId: string | null, init?: { method?: string; body?: string }) {
  const headers = new Headers();
  if (userId) headers.set("cookie", `${ACTING_USER_COOKIE}=${userId}`);
  return new NextRequest(urlFor(id), { ...init, headers });
}

function ctxFor(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe("PATCH /api/deployment-facets/[id]", () => {
  let adminId: string;
  let viewerId: string;
  let deploymentFacetId: string;

  beforeAll(async () => {
    const admin = await prisma.user.upsert({
      where: { email: ADMIN_EMAIL },
      update: {},
      create: { email: ADMIN_EMAIL, name: "Deployment Facet Edit Admin", role: "ADMIN" },
    });
    const viewer = await prisma.user.upsert({
      where: { email: VIEWER_EMAIL },
      update: {},
      create: { email: VIEWER_EMAIL, name: "Deployment Facet Edit Viewer", role: "VIEWER" },
    });
    adminId = admin.id;
    viewerId = viewer.id;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { in: [ADMIN_EMAIL, VIEWER_EMAIL] } } });
  });

  beforeEach(async () => {
    const deploymentFacet = await prisma.deploymentFacet.create({
      data: { name: `Test Edit Target ${Date.now()}`, description: "Before edit" },
    });
    deploymentFacetId = deploymentFacet.id;
  });

  afterEach(async () => {
    await prisma.deploymentFacet.deleteMany({ where: { id: deploymentFacetId } });
  });

  it("rejects a non-admin", async () => {
    const response = await PATCH(
      requestAs(deploymentFacetId, viewerId, {
        method: "PATCH",
        body: JSON.stringify({ description: "After edit" }),
      }),
      ctxFor(deploymentFacetId),
    );
    expect(response.status).toBe(403);
  });

  it("lets an admin edit the description", async () => {
    const response = await PATCH(
      requestAs(deploymentFacetId, adminId, {
        method: "PATCH",
        body: JSON.stringify({ description: "After edit" }),
      }),
      ctxFor(deploymentFacetId),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.deploymentFacet).toMatchObject({ id: deploymentFacetId, description: "After edit" });
  });

  it("returns 404 for a Deployment Facet that doesn't exist", async () => {
    const response = await PATCH(
      requestAs("does-not-exist", adminId, {
        method: "PATCH",
        body: JSON.stringify({ description: "Doesn't matter" }),
      }),
      ctxFor("does-not-exist"),
    );
    expect(response.status).toBe(404);
  });

  it("rejects an empty update body", async () => {
    const response = await PATCH(
      requestAs(deploymentFacetId, adminId, { method: "PATCH", body: JSON.stringify({}) }),
      ctxFor(deploymentFacetId),
    );
    expect(response.status).toBe(400);
  });

  it("lets an admin clear the description by setting it to null", async () => {
    const response = await PATCH(
      requestAs(deploymentFacetId, adminId, {
        method: "PATCH",
        body: JSON.stringify({ description: null }),
      }),
      ctxFor(deploymentFacetId),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.deploymentFacet).toMatchObject({ id: deploymentFacetId, description: null });
  });
});

describe("DELETE /api/deployment-facets/[id]", () => {
  const OWNER_EMAIL = "test-deployment-facet-delete-owner@example.com";
  let adminId: string;
  let ownerId: string;
  let deploymentFacetId: string;

  beforeAll(async () => {
    const admin = await prisma.user.upsert({
      where: { email: ADMIN_EMAIL },
      update: {},
      create: { email: ADMIN_EMAIL, name: "Deployment Facet Delete Admin", role: "ADMIN" },
    });
    const owner = await prisma.user.upsert({
      where: { email: OWNER_EMAIL },
      update: {},
      create: { email: OWNER_EMAIL, name: "Deployment Facet Delete Owner", role: "SYSTEM_OWNER" },
    });
    adminId = admin.id;
    ownerId = owner.id;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { in: [ADMIN_EMAIL, OWNER_EMAIL] } } });
  });

  beforeEach(async () => {
    const deploymentFacet = await prisma.deploymentFacet.create({
      data: { name: `Test Delete Target ${Date.now()}` },
    });
    deploymentFacetId = deploymentFacet.id;
  });

  afterEach(async () => {
    await prisma.deploymentFacet.deleteMany({ where: { id: deploymentFacetId } });
  });

  it("rejects a non-admin", async () => {
    const response = await DELETE(
      requestAs(deploymentFacetId, ownerId, { method: "DELETE" }),
      ctxFor(deploymentFacetId),
    );
    expect(response.status).toBe(403);
  });

  it("lets an admin retire an unused Deployment Facet", async () => {
    const response = await DELETE(
      requestAs(deploymentFacetId, adminId, { method: "DELETE" }),
      ctxFor(deploymentFacetId),
    );
    expect(response.status).toBe(204);

    const found = await prisma.deploymentFacet.findUnique({ where: { id: deploymentFacetId } });
    expect(found).toBeNull();
  });

  it("returns 404 for a Deployment Facet that doesn't exist", async () => {
    const response = await DELETE(
      requestAs("does-not-exist", adminId, { method: "DELETE" }),
      ctxFor("does-not-exist"),
    );
    expect(response.status).toBe(404);
  });

  it("blocks retiring a Deployment Facet still assigned to a System", async () => {
    const system = await prisma.system.create({
      data: {
        name: "Uses The Facet",
        deploymentFacets: { connect: [{ id: deploymentFacetId }] },
        ownerId,
        status: "DRAFT",
      },
    });

    const response = await DELETE(
      requestAs(deploymentFacetId, adminId, { method: "DELETE" }),
      ctxFor(deploymentFacetId),
    );
    expect(response.status).toBe(409);

    await prisma.system.delete({ where: { id: system.id } });
  });
});
