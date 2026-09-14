import { NextRequest } from "next/server";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { ACTING_USER_COOKIE } from "@/lib/acting-user";
import { GET, POST } from "../route";

const URL = "http://localhost/api/deployment-facets";
const ADMIN_EMAIL = "test-deployment-facets-admin@example.com";
const VIEWER_EMAIL = "test-deployment-facets-viewer@example.com";

describe("/api/deployment-facets", () => {
  let adminId: string;
  let viewerId: string;
  const createdNames: string[] = [];

  beforeAll(async () => {
    const admin = await prisma.user.upsert({
      where: { email: ADMIN_EMAIL },
      update: {},
      create: { email: ADMIN_EMAIL, name: "Deployment Facets Admin", role: "ADMIN" },
    });
    const viewer = await prisma.user.upsert({
      where: { email: VIEWER_EMAIL },
      update: {},
      create: { email: VIEWER_EMAIL, name: "Deployment Facets Viewer", role: "VIEWER" },
    });
    adminId = admin.id;
    viewerId = viewer.id;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { in: [ADMIN_EMAIL, VIEWER_EMAIL] } } });
  });

  afterEach(async () => {
    await prisma.deploymentFacet.deleteMany({ where: { name: { in: createdNames } } });
    createdNames.length = 0;
  });

  function requestAs(userId: string | null, init?: { method?: string; body?: string }) {
    const headers = new Headers();
    if (userId) headers.set("cookie", `${ACTING_USER_COOKIE}=${userId}`);
    return new NextRequest(URL, { ...init, headers });
  }

  it("GET rejects an unauthenticated request", async () => {
    const response = await GET(requestAs(null));
    expect(response.status).toBe(401);
  });

  it("GET allows any authenticated role", async () => {
    const response = await GET(requestAs(viewerId));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(Array.isArray(body.deploymentFacets)).toBe(true);
  });

  it("POST rejects a non-admin", async () => {
    const response = await POST(
      requestAs(viewerId, { method: "POST", body: JSON.stringify({ name: "Should Fail" }) }),
    );
    expect(response.status).toBe(403);
  });

  it("POST rejects an unauthenticated request", async () => {
    const response = await POST(
      requestAs(null, { method: "POST", body: JSON.stringify({ name: "Should Fail Too" }) }),
    );
    expect(response.status).toBe(401);
  });

  it("POST allows an admin to create a Deployment Facet", async () => {
    const name = "Test On-Premises Datacenter";
    createdNames.push(name);

    const response = await POST(
      requestAs(adminId, {
        method: "POST",
        body: JSON.stringify({ name, description: "Hosted in our own datacenter" }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.deploymentFacet).toMatchObject({ name, description: "Hosted in our own datacenter" });

    const listResponse = await GET(requestAs(adminId));
    const listBody = await listResponse.json();
    expect(listBody.deploymentFacets.some((t: { name: string }) => t.name === name)).toBe(true);
  });

  it("POST rejects a duplicate name", async () => {
    const name = "Test Duplicate Facet";
    createdNames.push(name);

    await POST(requestAs(adminId, { method: "POST", body: JSON.stringify({ name }) }));
    const response = await POST(
      requestAs(adminId, { method: "POST", body: JSON.stringify({ name }) }),
    );
    expect(response.status).toBe(409);
  });
});
