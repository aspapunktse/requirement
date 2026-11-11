import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { requestAs } from "@/test/provider-fixtures";
import { GET, POST } from "../route";
import { PATCH } from "../[id]/route";

/** The "Needs vendor details" flag on a Deployment Facet (#357). */

const suffix = `${process.pid}-${Date.now()}`;
const NAME = `Test 357 Facet ${suffix}`;
let adminId: string;
let viewerId: string;

beforeAll(async () => {
  adminId = (await prisma.user.create({ data: { email: `test-357-facet-admin-${suffix}@example.com`, name: "Test 357 facet admin", role: "ADMIN" } })).id;
  viewerId = (await prisma.user.create({ data: { email: `test-357-facet-viewer-${suffix}@example.com`, name: "Test 357 facet viewer", role: "VIEWER" } })).id;
});

afterAll(async () => {
  await prisma.deploymentFacet.deleteMany({ where: { name: NAME } });
  await prisma.user.deleteMany({ where: { id: { in: [adminId, viewerId] } } });
});

const facet = () => prisma.deploymentFacet.findFirstOrThrow({ where: { name: NAME } });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

describe("Deployment Facet requiresVendorDetails (#357)", { timeout: 30_000 }, () => {
  it("is off by default, can be set when creating, and is listed", async () => {
    const response = await POST(requestAs("/api/deployment-facets", adminId, "POST", { name: NAME }));
    expect(response.status).toBe(201);
    expect((await facet()).requiresVendorDetails).toBe(false);
    await prisma.deploymentFacet.deleteMany({ where: { name: NAME } });

    expect((await POST(requestAs("/api/deployment-facets", adminId, "POST", { name: NAME, requiresVendorDetails: true }))).status).toBe(201);
    expect((await facet()).requiresVendorDetails).toBe(true);

    const listed = (await (await GET(requestAs("/api/deployment-facets", viewerId, "GET"))).json()).deploymentFacets;
    expect(listed.find((f: { name: string }) => f.name === NAME)).toMatchObject({ requiresVendorDetails: true });
  });

  it("lets an Admin toggle it with PATCH, on its own", async () => {
    const id = (await facet()).id;
    const off = await PATCH(requestAs(`/api/deployment-facets/${id}`, adminId, "PATCH", { requiresVendorDetails: false }), ctx(id));
    expect(off.status).toBe(200);
    expect(await facet()).toMatchObject({ requiresVendorDetails: false, name: NAME });
    const on = await PATCH(requestAs(`/api/deployment-facets/${id}`, adminId, "PATCH", { requiresVendorDetails: true }), ctx(id));
    expect(on.status).toBe(200);
    expect((await facet()).requiresVendorDetails).toBe(true);
  });

  it("refuses a non-Admin and an unauthenticated request, changing nothing", async () => {
    const id = (await facet()).id;
    const body = { requiresVendorDetails: false };
    expect((await PATCH(requestAs(`/api/deployment-facets/${id}`, viewerId, "PATCH", body), ctx(id))).status).toBe(403);
    expect((await PATCH(requestAs(`/api/deployment-facets/${id}`, null, "PATCH", body), ctx(id))).status).toBe(401);
    expect((await facet()).requiresVendorDetails).toBe(true);
    expect((await POST(requestAs("/api/deployment-facets", viewerId, "POST", { name: `${NAME} b`, requiresVendorDetails: true }))).status).toBe(403);
    expect(await prisma.deploymentFacet.count({ where: { name: `${NAME} b` } })).toBe(0);
  });

  it("refuses a flag that is not a boolean and an empty PATCH", async () => {
    const id = (await facet()).id;
    expect((await PATCH(requestAs(`/api/deployment-facets/${id}`, adminId, "PATCH", { requiresVendorDetails: "yes" }), ctx(id))).status).toBe(400);
    expect((await PATCH(requestAs(`/api/deployment-facets/${id}`, adminId, "PATCH", {}), ctx(id))).status).toBe(400);
    expect((await facet()).requiresVendorDetails).toBe(true);
  });
});
